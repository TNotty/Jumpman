// プレイヤー強化画面(全画面DOMオーバーレイ)。app層専用。core(upgrades.ts)の純粋な経済ロジックを
// 呼び出し、結果をセーブデータへ即座に反映する。core/renderへの依存は読み取り専用
// (drawTerrainShapePreviewを地形形状プレビューに再利用する)。
import { JUMP_VELOCITY } from '../../core/constants';
import {
  MAX_UPGRADE_LEVEL,
  UPGRADE_KEYS,
  decreaseUpgrade,
  derivePlayerStats,
  increaseUpgrade,
  isTerrainUnlocked,
  unlockTerrain,
} from '../../core/upgrades';
import type { PlayerStats, UpgradeKey, UpgradeLevels } from '../../core/upgrades';
import type { TerrainDefinition } from '../../core/types';
import { drawTerrainShapePreview } from '../../render/renderer';
import type { Loadout, SaveData } from '../../data/saveData';
import { LOADOUT_SIZE } from '../../data/saveData';

export interface UpgradeScreenDeps {
  /** 同梱/カスタムを問わず、地形マスタの全エントリ(解放カタログ全体) */
  fullTerrainMaster: readonly TerrainDefinition[];
  /** 常に最新のセーブデータを返す(main.ts側のクロージャ変数を参照する想定) */
  getSave: () => SaveData;
  /** セーブデータを更新する(呼ぶと即座にlocalStorageへ保存される想定。main.ts側で実装) */
  setSave: (next: SaveData) => void;
}

export interface UpgradeScreenHandles {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

// devOverlay/createGameUiOverlayの GAME_UI_BUTTON_STYLE と同じ見た目の値をあえて再定義している
// (main.tsからのimportは循環参照になるため。値は意図的に同じにしてある)。
const BUTTON_STYLE =
  'background:rgba(0,0,0,0.55); color:#fff; padding:8px 12px; border-radius:4px; ' +
  'border:1px solid rgba(255,255,255,0.35); font-family:sans-serif; font-size:13px; cursor:pointer; ' +
  'min-height:44px; min-width:44px;';
const SMALL_BUTTON_STYLE =
  'background:rgba(0,0,0,0.55); color:#fff; padding:6px 10px; border-radius:4px; ' +
  'border:1px solid rgba(255,255,255,0.35); font-family:sans-serif; font-size:13px; cursor:pointer; ' +
  'min-height:44px; min-width:44px;';

const UPGRADE_LABELS: Record<UpgradeKey, string> = {
  hp: '最大HP',
  speed: '走行速度',
  jump: 'ジャンプ力',
  manaRegen: 'マナ回復速度',
  manaMax: 'マナ上限',
};

/** 指定キーの効果を、そのキーだけ指定レベルに差し替えたPlayerStatsから読みやすい文字列にする */
function formatEffect(key: UpgradeKey, levels: UpgradeLevels, level: number): string {
  const stats: PlayerStats = derivePlayerStats({ ...levels, [key]: level });
  switch (key) {
    case 'hp':
      return `HP ${stats.maxHp}`;
    case 'speed':
      return `${stats.runSpeed.toFixed(1)} タイル/秒`;
    case 'jump':
      return `${Math.round((stats.jumpVelocity / JUMP_VELOCITY) * 100)}%`;
    case 'manaRegen':
      return `${Math.round(stats.manaRegenMultiplier * 100)}%`;
    case 'manaMax':
      return `基本+${stats.manaMaxBonus}`;
    default:
      return '';
  }
}

function setDisabled(el: HTMLButtonElement, disabled: boolean): void {
  el.disabled = disabled;
  el.style.opacity = disabled ? '0.4' : '1';
  el.style.cursor = disabled ? 'default' : 'pointer';
}

/**
 * 強化画面を1度だけ生成する(closeで隠すだけで、DOM自体は使い回す)。
 * 単一ページ統合ビルド(all.html)でもDOM生成はJS側(このファイル)が行うため、
 * all.html側のtemplateに追加のマークアップは不要(生成されたDOMはdocument.bodyへ
 * そのまま追加され、hashchangeでのlocation.reload時に他モードのテンプレートと一緒に
 * 破棄される=通常のゲーム用DOMと同じライフサイクルになる)。
 */
export function createUpgradeScreen(deps: UpgradeScreenDeps): UpgradeScreenHandles {
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed; inset:0; z-index:2000; background:rgba(10,10,16,0.94); overflow-y:auto; ' +
    'display:none; box-sizing:border-box; padding:20px; font-family:sans-serif; color:#fff; ' +
    '-webkit-overflow-scrolling:touch;';

  const inner = document.createElement('div');
  inner.style.cssText = 'max-width:900px; margin:0 auto; display:flex; flex-direction:column; gap:16px;';
  overlay.appendChild(inner);

  const title = document.createElement('h1');
  title.textContent = 'プレイヤー強化';
  title.style.cssText = 'font-size:22px; margin:0;';
  inner.appendChild(title);

  const walletEl = document.createElement('div');
  walletEl.style.cssText = 'font-size:16px; color:#f1c40f;';
  inner.appendChild(walletEl);

  const upgradesHeading = document.createElement('h2');
  upgradesHeading.textContent = '強化';
  upgradesHeading.style.cssText = 'font-size:16px; margin:8px 0 0; border-bottom:1px solid #444; padding-bottom:4px;';
  inner.appendChild(upgradesHeading);

  const upgradesRowsEl = document.createElement('div');
  upgradesRowsEl.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
  inner.appendChild(upgradesRowsEl);

  const terrainHeading = document.createElement('h2');
  terrainHeading.textContent = '地形解放';
  terrainHeading.style.cssText = 'font-size:16px; margin:8px 0 0; border-bottom:1px solid #444; padding-bottom:4px;';
  inner.appendChild(terrainHeading);

  const terrainListEl = document.createElement('div');
  terrainListEl.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
  inner.appendChild(terrainListEl);

  const loadoutHeading = document.createElement('h2');
  loadoutHeading.textContent = 'ロードアウト編集(8枠)';
  loadoutHeading.style.cssText = 'font-size:16px; margin:8px 0 0; border-bottom:1px solid #444; padding-bottom:4px;';
  inner.appendChild(loadoutHeading);

  const loadoutGridEl = document.createElement('div');
  loadoutGridEl.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:8px;';
  inner.appendChild(loadoutGridEl);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '閉じる';
  closeButton.style.cssText = `${BUTTON_STYLE} align-self:flex-end; margin-top:8px;`;
  inner.appendChild(closeButton);

  document.body.appendChild(overlay);

  // --- 強化行の描画 -----------------------------------------------------------------

  function renderUpgradeRows(): void {
    const save = deps.getSave();
    upgradesRowsEl.innerHTML = '';

    for (const key of UPGRADE_KEYS) {
      const level = save.upgrades[key];
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:rgba(255,255,255,0.05); ' +
        'padding:8px; border-radius:6px;';

      const label = document.createElement('div');
      label.style.cssText = 'min-width:120px; font-size:14px;';
      label.textContent = `${UPGRADE_LABELS[key]} (${level}/${MAX_UPGRADE_LEVEL})`;
      row.appendChild(label);

      const effect = document.createElement('div');
      effect.style.cssText = 'flex:1; min-width:160px; font-size:13px; color:#ccc;';
      const currentText = formatEffect(key, save.upgrades, level);
      const nextText = level < MAX_UPGRADE_LEVEL ? formatEffect(key, save.upgrades, level + 1) : null;
      effect.textContent = nextText ? `${currentText} → ${nextText}` : `${currentText}(最大)`;
      row.appendChild(effect);

      const costText = document.createElement('div');
      costText.style.cssText = 'min-width:70px; font-size:13px; color:#f1c40f; text-align:right;';
      costText.textContent = level < MAX_UPGRADE_LEVEL ? `次:${level + 1}枚` : '上限';
      row.appendChild(costText);

      const minusButton = document.createElement('button');
      minusButton.type = 'button';
      minusButton.textContent = '−';
      minusButton.style.cssText = SMALL_BUTTON_STYLE;
      const minusResult = decreaseUpgrade(save.upgrades, key);
      setDisabled(minusButton, !minusResult.ok);
      minusButton.addEventListener('click', () => {
        const current = deps.getSave();
        const result = decreaseUpgrade(current.upgrades, key);
        if (!result.ok) return;
        deps.setSave({ ...current, wallet: current.wallet + result.walletDelta, upgrades: result.levels });
        renderAll();
      });
      row.appendChild(minusButton);

      const plusButton = document.createElement('button');
      plusButton.type = 'button';
      plusButton.textContent = '+';
      plusButton.style.cssText = SMALL_BUTTON_STYLE;
      const plusResult = increaseUpgrade(save.upgrades, key, save.wallet);
      setDisabled(plusButton, !plusResult.ok);
      plusButton.addEventListener('click', () => {
        const current = deps.getSave();
        const result = increaseUpgrade(current.upgrades, key, current.wallet);
        if (!result.ok) return;
        deps.setSave({ ...current, wallet: current.wallet + result.walletDelta, upgrades: result.levels });
        renderAll();
      });
      row.appendChild(plusButton);

      upgradesRowsEl.appendChild(row);
    }
  }

  // --- 地形解放リストの描画 -----------------------------------------------------------

  function renderTerrainList(): void {
    const save = deps.getSave();
    terrainListEl.innerHTML = '';

    for (const terrain of deps.fullTerrainMaster) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:rgba(255,255,255,0.05); ' +
        'padding:8px; border-radius:6px;';

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = 56;
      previewCanvas.height = 56;
      previewCanvas.style.cssText = 'background:#111; border-radius:4px; flex:0 0 auto;';
      const previewCtx = previewCanvas.getContext('2d');
      if (previewCtx) {
        drawTerrainShapePreview(previewCtx, terrain, 2, 2, previewCanvas.width - 4, previewCanvas.height - 4);
      }
      row.appendChild(previewCanvas);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1; min-width:160px; font-size:13px;';
      info.textContent = `${terrain.name}(マナ${terrain.cost})`;
      row.appendChild(info);

      const unlocked = isTerrainUnlocked(terrain, save.unlockedTerrainIds);
      if (unlocked) {
        const doneLabel = document.createElement('div');
        doneLabel.style.cssText = 'font-size:13px; color:#8ecb8e; min-width:90px; text-align:right;';
        doneLabel.textContent = '解放済み';
        row.appendChild(doneLabel);
      } else {
        const unlockButton = document.createElement('button');
        unlockButton.type = 'button';
        unlockButton.textContent = `解放(${terrain.unlockCost}枚)`;
        unlockButton.style.cssText = SMALL_BUTTON_STYLE;
        setDisabled(unlockButton, save.wallet < terrain.unlockCost);
        unlockButton.addEventListener('click', () => {
          const current = deps.getSave();
          const result = unlockTerrain(current.wallet, current.unlockedTerrainIds, terrain.id, terrain.unlockCost);
          if (!result.ok) return;
          deps.setSave({ ...current, wallet: result.wallet, unlockedTerrainIds: result.unlockedTerrainIds });
          renderAll();
        });
        row.appendChild(unlockButton);
      }

      terrainListEl.appendChild(row);
    }
  }

  // --- ロードアウト編集の描画 ---------------------------------------------------------

  function renderLoadoutGrid(): void {
    const save = deps.getSave();
    loadoutGridEl.innerHTML = '';

    const unlockedTerrains = deps.fullTerrainMaster.filter((t) => isTerrainUnlocked(t, save.unlockedTerrainIds));

    for (let slotIndex = 0; slotIndex < LOADOUT_SIZE; slotIndex++) {
      const cell = document.createElement('div');
      cell.style.cssText =
        'display:flex; flex-direction:column; gap:4px; background:rgba(255,255,255,0.05); ' +
        'padding:8px; border-radius:6px;';

      const slotLabel = document.createElement('div');
      slotLabel.style.cssText = 'font-size:12px; color:#aaa;';
      slotLabel.textContent = `枠 ${slotIndex + 1}`;
      cell.appendChild(slotLabel);

      const select = document.createElement('select');
      select.style.cssText =
        'min-height:44px; font-size:13px; background:#1a1a1a; color:#fff; border:1px solid #555; ' +
        'border-radius:4px; padding:4px;';

      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '(空にする)';
      select.appendChild(emptyOption);

      for (const terrain of unlockedTerrains) {
        const option = document.createElement('option');
        option.value = terrain.id;
        option.textContent = terrain.name;
        select.appendChild(option);
      }

      select.value = save.loadout[slotIndex] ?? '';
      select.addEventListener('change', () => {
        const current = deps.getSave();
        const nextLoadout: Loadout = [...current.loadout];
        nextLoadout[slotIndex] = select.value === '' ? null : select.value;
        deps.setSave({ ...current, loadout: nextLoadout });
        renderAll();
      });

      cell.appendChild(select);
      loadoutGridEl.appendChild(cell);
    }
  }

  function renderAll(): void {
    const save = deps.getSave();
    walletEl.textContent = `所持コイン: ${save.wallet}枚`;
    renderUpgradeRows();
    renderTerrainList();
    renderLoadoutGrid();
  }

  let open = false;
  closeButton.addEventListener('click', () => {
    overlay.style.display = 'none';
    open = false;
  });

  return {
    open: () => {
      renderAll();
      overlay.style.display = 'block';
      open = true;
    },
    close: () => {
      overlay.style.display = 'none';
      open = false;
    },
    isOpen: () => open,
  };
}
