// ゲーム本体のエントリポイント(index.html から読み込まれる)。
// core(純ロジック)・render・input・platform を接続する唯一の場所。
// シーン遷移(タイトル→ステージ選択→プレイ→クリア)はここで管理する(coreはシーンを知らない)。
import { GAME_AREA_HEIGHT, JUMPMAN_HEIGHT, JUMPMAN_WIDTH, LOGICAL_HEIGHT, LOGICAL_WIDTH, TILE_SIZE } from '../../core/constants';
import { createGameState, update as updateGame } from '../../core/game';
import type { GameState } from '../../core/game';
import { GameStatus } from '../../core/types';
import type { StageData, TerrainDefinition } from '../../core/types';
import { derivePlayerStats } from '../../core/upgrades';
import { validateStage, validateTerrainMaster } from '../../data/schema';
import { loadSaveData, saveSaveData } from '../../data/saveData';
import stage01Raw from '../../data/stages/stage01.json';
import stage02Raw from '../../data/stages/stage02.json';
import stage03Raw from '../../data/stages/stage03.json';
import stage04Raw from '../../data/stages/stage04.json';
import stage05Raw from '../../data/stages/stage05.json';
import stage06Raw from '../../data/stages/stage06.json';
import stage07Raw from '../../data/stages/stage07.json';
import stage08Raw from '../../data/stages/stage08.json';
import stage09Raw from '../../data/stages/stage09.json';
import stage10Raw from '../../data/stages/stage10.json';
import terrainMasterRaw from '../../data/terrainMaster.json';
import { resolveLoadoutPalette } from './loadout';
import {
  advanceTransition,
  beginFadeOut,
  computeFadeAlpha,
  createIdleTransition,
  isTransitioning,
} from './sceneTransition';
import type { Transition } from './sceneTransition';
import { applyStageCleared, isStageSelectable } from './stageUnlock';
import { AssetStore, loadAssets } from '../../render/assets';
import { createBackgroundLayers } from '../../render/background';
import type { BackgroundLayers } from '../../render/background';
import { createCamera, updateCamera } from '../../render/camera';
import type { CameraState } from '../../render/camera';
import { createEffectsManager } from '../../render/effects';
import { renderGame } from '../../render/renderer';
import {
  clearNextButtonRect,
  clearTitleButtonRect,
  drawClearButtons,
  drawStageSelectScreen,
  drawTitleScreen,
  pointInRect,
  stageSelectBoxRect,
} from '../../render/screens';
import type { StageMeta } from '../../render/screens';
import { InputManager } from '../../input/input';
import { openEditor, openTerrainEditor } from '../../platform/navigation';
import { loadJSON, saveJSON } from '../../platform/storage';
import { createLoop } from '../loop';
import { createUpgradeScreen } from './upgradeScreen';

/** マップエディタ(Phase C)がテストプレイ用のdraftステージを書き込むキー */
export const DRAFT_STAGE_STORAGE_KEY = 'jumpman:draftStage';
/** 地形マスタエディタ(Phase C)がカスタム地形マスタを書き込むキー。存在すれば同梱JSONより優先する */
export const TERRAIN_MASTER_STORAGE_KEY = 'jumpman:terrainMaster';
/**
 * プレイ中に「エディタで開く」を押した際、ゲーム側がそのステージの元StageData
 * (プレイヤーが地形生成/消去で変化させたグリッドではない、プレイ開始時点のもの)を
 * 書き込むキー。editor.html はこのキーを検査し、あれば読み込んでからキーを削除する。
 */
export const EDIT_REQUEST_STORAGE_KEY = 'jumpman:editRequest';

interface StageEntry {
  id: string;
  data: StageData;
}

type Scene =
  | { kind: 'title' }
  | { kind: 'stageSelect' }
  | { kind: 'playing'; stageIndex: number; stageData: StageData; game: GameState; camera: CameraState }
  /** clearedAt: このシーンに切り替わった時点のanimTime。クリア画面のコイン数カウントアップの
   * 経過時間計算(animTime - clearedAt)に使う。 */
  | { kind: 'clear'; stageIndex: number; game: GameState; camera: CameraState; clearedAt: number };

interface DevOverlayHandles {
  titleLinksEl: HTMLDivElement;
  playingButton: HTMLButtonElement;
  /** シーン切替時のみDOMのstyleを書き換える(同じシーン種別なら何もしない) */
  sync: (sceneKind: Scene['kind']) => void;
}

const DEV_OVERLAY_LINK_STYLE =
  'background:rgba(0,0,0,0.55); color:#fff; padding:4px 8px; border-radius:4px; ' +
  'text-decoration:none; border:1px solid rgba(255,255,255,0.35); font-family:sans-serif; font-size:12px;';

/**
 * 開発限定のDOMオーバーレイ(タイトルのエディタリンク・プレイ中の「エディタで開く」ボタン)を
 * 1度だけ生成する。canvas内描画ではなくDOM要素にすることで、canvasのヒットテストを複雑化させない。
 * 呼び出し元(main())が import.meta.env.DEV でガードするため、本番ビルドではこの関数自体が
 * 呼ばれない(=生成されない)。
 */
function createDevOverlay(): DevOverlayHandles {
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed; top:8px; right:8px; z-index:1000; display:flex; flex-direction:column; ' +
    'align-items:flex-end; gap:4px; pointer-events:none;';

  const titleLinksEl = document.createElement('div');
  titleLinksEl.style.cssText = 'display:none; gap:6px; pointer-events:auto;';

  // 単一ページ統合ビルド(all.html)では実在するeditor.html/terrain.htmlが無いため、
  // <a href>ではなくplatform/navigationのハッシュ切替関数を呼ぶボタンにする。
  const editorLink = document.createElement('button');
  editorLink.type = 'button';
  editorLink.textContent = 'マップエディタ';
  editorLink.style.cssText = `${DEV_OVERLAY_LINK_STYLE} cursor:pointer;`;
  editorLink.addEventListener('click', () => openEditor());

  const terrainLink = document.createElement('button');
  terrainLink.type = 'button';
  terrainLink.textContent = '地形エディタ';
  terrainLink.style.cssText = `${DEV_OVERLAY_LINK_STYLE} cursor:pointer;`;
  terrainLink.addEventListener('click', () => openTerrainEditor());

  titleLinksEl.append(editorLink, terrainLink);

  const playingButton = document.createElement('button');
  playingButton.type = 'button';
  playingButton.textContent = 'エディタで開く';
  playingButton.style.cssText = `${DEV_OVERLAY_LINK_STYLE} display:none; cursor:pointer; pointer-events:auto;`;

  container.append(titleLinksEl, playingButton);
  document.body.appendChild(container);

  let lastSceneKind: Scene['kind'] | null = null;
  const sync = (sceneKind: Scene['kind']): void => {
    if (sceneKind === lastSceneKind) return;
    lastSceneKind = sceneKind;
    titleLinksEl.style.display = sceneKind === 'title' ? 'flex' : 'none';
    playingButton.style.display = sceneKind === 'playing' ? 'inline-block' : 'none';
  };

  return { titleLinksEl, playingButton, sync };
}

const GAME_UI_BUTTON_STYLE =
  'background:rgba(0,0,0,0.55); color:#fff; padding:6px 10px; border-radius:4px; ' +
  'border:1px solid rgba(255,255,255,0.35); font-family:sans-serif; font-size:12px; cursor:pointer; pointer-events:auto;';

/**
 * 常時表示の製品UI(開発限定ではない): 全画面切替ボタン・タッチ生成アンカー(指の左右どちらに
 * 生成するか)切替ボタン。canvas内描画ではなくDOM要素にする(devOverlayと同じ理由:
 * canvasのヒットテストを複雑化させない)。画面左上隅に配置し、devOverlay(右上)やパレット(下部)と
 * 重ならないようにする。
 */
function createGameUiOverlay(input: InputManager): void {
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed; top:8px; left:8px; z-index:1000; display:flex; flex-direction:column; ' +
    'align-items:flex-start; gap:4px; pointer-events:none;';

  // Fullscreen API非対応環境(iOS Safari等)ではボタン自体を出さない
  // (document.documentElement.requestFullscreen の存在有無で判定)。
  if (document.documentElement.requestFullscreen) {
    const fullscreenButton = document.createElement('button');
    fullscreenButton.type = 'button';
    fullscreenButton.textContent = '全画面';
    fullscreenButton.style.cssText = GAME_UI_BUTTON_STYLE;
    fullscreenButton.addEventListener('click', () => {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void document.documentElement.requestFullscreen();
      }
    });
    document.addEventListener('fullscreenchange', () => {
      fullscreenButton.textContent = document.fullscreenElement ? '全画面解除' : '全画面';
    });
    container.appendChild(fullscreenButton);
  }

  // タッチ時の生成基準(指の左/右どちらに生成するか)の切替。設定はInputManager経由でlocalStorageへ永続化される。
  const anchorButton = document.createElement('button');
  anchorButton.type = 'button';
  anchorButton.style.cssText = GAME_UI_BUTTON_STYLE;
  const syncAnchorLabel = (): void => {
    anchorButton.textContent = input.getTouchAnchorSide() === 'left' ? '生成←指' : '指→生成';
  };
  syncAnchorLabel();
  anchorButton.addEventListener('click', () => {
    input.toggleTouchAnchorSide();
    syncAnchorLabel();
  });
  container.appendChild(anchorButton);

  document.body.appendChild(container);
}

interface UpgradeEntryHandles {
  /** シーン切替時のみDOMのstyleを書き換える(devOverlay.syncと同じパターン) */
  sync: (sceneKind: Scene['kind']) => void;
}

/**
 * 「プレイヤー強化」画面への常時表示の入口ボタン(開発限定ではない製品UI)。
 * タイトル/ステージ選択画面でのみ表示し、プレイ中/クリア画面では隠す
 * (devOverlayのsyncパターンをそのまま踏襲: シーン種別が変わった時だけstyleを書き換える)。
 * gameUiOverlay(左上)・devOverlay(右上、DEV限定)と重ならないよう右下隅に配置する。
 */
function createUpgradeEntryButton(onOpen: () => void): UpgradeEntryHandles {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'プレイヤー強化';
  button.style.cssText =
    'position:fixed; bottom:8px; right:8px; z-index:900; display:none; ' +
    `${GAME_UI_BUTTON_STYLE} padding:10px 14px; font-size:14px; min-height:44px;`;
  button.addEventListener('click', () => onOpen());
  document.body.appendChild(button);

  let lastSceneKind: Scene['kind'] | null = null;
  const sync = (sceneKind: Scene['kind']): void => {
    if (sceneKind === lastSceneKind) return;
    lastSceneKind = sceneKind;
    button.style.display = sceneKind === 'title' || sceneKind === 'stageSelect' ? 'block' : 'none';
  };

  return { sync };
}

function getCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('#game-canvas が見つかりません');
  }
  return canvas;
}

function drawLoadingScreen(ctx: CanvasRenderingContext2D, message: string): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
}

function requireValidStage(raw: unknown, label: string): StageData {
  const result = validateStage(raw);
  if (!result.ok) {
    throw new Error(`${label} のスキーマ検証に失敗しました: ${result.errors.join(', ')}`);
  }
  return result.value;
}

async function main(): Promise<void> {
  const canvas = getCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D描画コンテキストの取得に失敗しました');
  }

  drawLoadingScreen(ctx, '読み込み中...');

  let stages: StageEntry[];
  try {
    stages = [
      { id: 'stage01', data: requireValidStage(stage01Raw, 'stage01.json') },
      { id: 'stage02', data: requireValidStage(stage02Raw, 'stage02.json') },
      { id: 'stage03', data: requireValidStage(stage03Raw, 'stage03.json') },
      { id: 'stage04', data: requireValidStage(stage04Raw, 'stage04.json') },
      { id: 'stage05', data: requireValidStage(stage05Raw, 'stage05.json') },
      { id: 'stage06', data: requireValidStage(stage06Raw, 'stage06.json') },
      { id: 'stage07', data: requireValidStage(stage07Raw, 'stage07.json') },
      { id: 'stage08', data: requireValidStage(stage08Raw, 'stage08.json') },
      { id: 'stage09', data: requireValidStage(stage09Raw, 'stage09.json') },
      { id: 'stage10', data: requireValidStage(stage10Raw, 'stage10.json') },
    ];
  } catch (error) {
    drawLoadingScreen(ctx, 'ステージデータが不正です');
    console.error(error);
    return;
  }

  // 地形マスタエディタ(Phase C)が保存したカスタム地形マスタがあれば優先し、無ければ同梱JSONを使う。
  let terrainMaster: TerrainDefinition[];
  const customTerrainMasterRaw = loadJSON<unknown>(TERRAIN_MASTER_STORAGE_KEY);
  const customTerrainMasterResult = customTerrainMasterRaw !== null ? validateTerrainMaster(customTerrainMasterRaw) : null;
  if (customTerrainMasterResult && customTerrainMasterResult.ok) {
    terrainMaster = customTerrainMasterResult.value.terrains;
  } else {
    if (customTerrainMasterResult && !customTerrainMasterResult.ok) {
      console.warn('カスタム地形マスタの検証に失敗したため、同梱の地形マスタを使用します', customTerrainMasterResult.errors);
    }
    const terrainMasterResult = validateTerrainMaster(terrainMasterRaw);
    if (terrainMasterResult.ok) {
      terrainMaster = terrainMasterResult.value.terrains;
    } else {
      console.error('terrainMaster.json validation errors:', terrainMasterResult.errors);
      terrainMaster = [];
    }
  }

  let assets: AssetStore;
  try {
    assets = await loadAssets();
  } catch (error) {
    drawLoadingScreen(ctx, 'アセットの読み込みに失敗しました');
    console.error(error);
    return;
  }

  // セーブデータ(wallet・コイン取得状況・強化・loadout)を読み込む。壊れていても既定値に
  // フォールバックする(saveData.ts参照)ため、ここでは常に有効な値が得られる。
  // save は取得コイン反映のたびに再代入する(以降の全クロージャが同じ変数を参照するため、
  // 再代入は自動的にHUD/ステージ選択画面の再描画にも反映される)。
  let save = loadSaveData();

  // ゲームのパレットは「セーブのloadout配列(8枠、地形IDまたは空枠null)」を地形マスタ(同梱/
  // カスタム)から解決した結果を表示する。v5-2で強化画面からloadoutを編集できるようになった
  // ため、let にして startPlaying() のたびに最新のセーブから再計算する(空枠はInputManager/
  // game.ts側で選択不可として扱われる=null安全)。
  let paletteTerrains = resolveLoadoutPalette(save.loadout, terrainMaster, save.unlockedTerrainIds);

  /** 今回のプレイでtakenThisSessionのうち、既にセーブへ反映済みの件数(先頭からの累積) */
  let lastPersistedTakenCount = 0;

  // input は startPlaying() 内から setTerrainMaster() を呼ぶため、startPlaying() より前に
  // 生成しておく必要がある(下のdraftステージ連携がstartPlaying()を呼ぶより前)。
  const input = new InputManager(
    canvas,
    () => (scene.kind === 'playing' ? scene.camera : createCamera()),
    paletteTerrains,
  );

  // パーティクル+画面演出(EffectsManager)。startPlaying()内からreset()するため、
  // input同様にstartPlaying()より前に生成しておく。
  const effects = createEffectsManager();

  // 多層パララックス背景(テーマごとの層をプリレンダしたもの)。テーマ切替のたびに1回だけ
  // 作り直す(=startPlaying()のたびに再生成。playing中のシーンは同じインスタンスを使い回す)。
  // title/stageSelectシーンではrenderGame自体を呼ばないため、最初のstartPlaying()より前は
  // 未使用(undefinedのまま=renderGame側のフォールバック描画に委ねる)でよい。
  let backgroundLayers: BackgroundLayers | undefined;

  // タイトル/ステージ選択画面用のパララックス背景(草原固定、静止表示でよい)。ステージテーマに
  // 依存しないため1度だけ作って使い回す(resetや再生成は不要)。
  const menuBackgroundLayers = createBackgroundLayers('grass');

  function startPlaying(stageData: StageData, stageIndex: number): Scene {
    lastPersistedTakenCount = 0;
    // 前回のプレイの余韻(振動・ビネット・紙吹雪・パーティクル)を持ち越さない。
    effects.reset();
    backgroundLayers = createBackgroundLayers(stageData.theme);
    // プレイ開始時点の最新セーブから、強化(PlayerStats)とloadoutパレットを毎回作り直す
    // (既にプレイ中のゲームには影響しなくてよい、という要件どおり再計算はここでのみ行う)。
    paletteTerrains = resolveLoadoutPalette(save.loadout, terrainMaster, save.unlockedTerrainIds);
    input.setTerrainMaster(paletteTerrains);
    const playerStats = derivePlayerStats(save.upgrades);
    const collectedCoinIndices = new Set(save.collected[stageData.id] ?? []);
    // stageDataはプレイ開始時点の元データをそのまま保持する(gridは生成/消去で変化するが
    // stageDataは不変のまま=「エディタで開く」機能がプレイヤーの変更を巻き戻さず、
    // 常に元のステージ定義を渡せるようにするため)。
    return {
      kind: 'playing',
      stageIndex,
      stageData,
      game: createGameState(stageData, paletteTerrains, collectedCoinIndices, playerStats),
      camera: createCamera(),
    };
  }

  /**
   * GameState.takenThisSession の増分をセーブデータへ反映する(walletを加算し、
   * collected[stageId]へindexを追加して即保存)。permanentlyCollectedだったコインの
   * indexはcore側で最初からtakenThisSessionに入らないため、ここに現れるのは常に
   * 「新規に取得すべきもの」だけであり、二重加算の心配はない。
   */
  function persistNewlyCollectedCoins(stageId: string, takenThisSession: readonly number[]): void {
    if (takenThisSession.length <= lastPersistedTakenCount) return;
    const newIndices = takenThisSession.slice(lastPersistedTakenCount);
    lastPersistedTakenCount = takenThisSession.length;

    const existing = new Set(save.collected[stageId] ?? []);
    let addedCoins = 0;
    for (const index of newIndices) {
      if (!existing.has(index)) {
        existing.add(index);
        addedCoins += 1;
      }
    }
    if (addedCoins === 0) return;

    save = {
      ...save,
      wallet: save.wallet + addedCoins,
      collected: { ...save.collected, [stageId]: Array.from(existing).sort((a, b) => a - b) },
    };
    saveSaveData(save);
  }

  /**
   * ゴール到達(GameStatus.Cleared)時にステージIDをclearedStageIdsへ追加して即保存する
   * (未クリアなら追加、既にクリア済みなら何もしない=何度クリアしても増えない)。
   * ?stage=draft(stageIndex=-1、マップエディタのテストプレイ)はステージ選択の対象外なので
   * clearedStageIdsに記録しない。
   */
  function persistStageCleared(stageId: string, stageIndex: number): void {
    if (stageIndex < 0) return;
    if (save.clearedStageIds.includes(stageId)) return;
    save = { ...save, clearedStageIds: applyStageCleared(save.clearedStageIds, stageId) };
    saveSaveData(save);
  }

  function hasNextStage(stageIndex: number): boolean {
    return stageIndex >= 0 && stageIndex + 1 < stages.length;
  }

  // ?stage=draft: マップエディタ(Phase C)からのテストプレイ連携。
  // localStorageに保存されたdraftステージがあれば、タイトル/選択をスキップして直接プレイする。
  // 単一ページ統合ビルド(all.html)では ?stage=draft の代わりに #game-draft ハッシュを使う
  // (platform/navigation.ts の openGameDraft() 参照)。
  let scene: Scene = { kind: 'title' };
  const params = new URLSearchParams(window.location.search);
  if (params.get('stage') === 'draft' || window.location.hash === '#game-draft') {
    const draftRaw = loadJSON<unknown>(DRAFT_STAGE_STORAGE_KEY);
    const draftResult = draftRaw !== null ? validateStage(draftRaw) : null;
    if (draftResult && draftResult.ok) {
      scene = startPlaying(draftResult.value, -1);
    } else {
      console.warn(
        'draftステージの読込に失敗したため、タイトル画面を表示します',
        draftResult && !draftResult.ok ? draftResult.errors : '(localStorageにdraftが見つかりません)',
      );
    }
  }

  let animTime = 0;

  // シーン切替の短い黒フェード(0.25秒程度、往復で約0.5秒)。純粋な状態機械はsceneTransition.tsに
  // 切り出してある。pendingSceneFactoryは「フェードアウトが完了した瞬間に呼ぶシーン構築処理」を
  // 保持する(呼ぶタイミングを遅らせることで、真っ黒な瞬間の裏でシーンが切り替わるようにする)。
  let transition: Transition = createIdleTransition();
  let pendingSceneFactory: (() => Scene) | null = null;

  function requestSceneChange(factory: () => Scene): void {
    if (isTransitioning(transition)) return; // 遷移中の多重発火を防ぐ
    pendingSceneFactory = factory;
    transition = beginFadeOut();
  }

  // ステージ選択画面でマウスホバー中のカードindex(タッチ操作では使われない=常にnullのまま)。
  let hoveredStageIndex: number | null = null;

  // 常時表示の製品UI(全画面切替・タッチ生成アンカー切替)。devOverlayと異なりDEV限定ではない。
  createGameUiOverlay(input);

  // 強化画面(プレイヤー強化+地形解放+ロードアウト編集)。setSaveはpersistNewlyCollectedCoinsと
  // 同じ「saveクロージャ変数を再代入してsaveSaveData()する」パターンを踏襲する。
  const upgradeScreen = createUpgradeScreen({
    fullTerrainMaster: terrainMaster,
    getSave: () => save,
    setSave: (next) => {
      save = next;
      saveSaveData(save);
    },
  });
  const upgradeEntry = createUpgradeEntryButton(() => upgradeScreen.open());

  // 開発限定UI(タイトルのエディタリンク・プレイ中の「エディタで開く」ボタン)。
  // import.meta.env.DEV は `vite build` の本番ビルドでは静的に false になるため、
  // このブロックごと実行されない(=DOM要素も生成されない)。
  // VITE_ENABLE_EDITOR=1 でビルドした場合(テスト版リリースビルド)は本番ビルドでも有効にする。
  let devOverlay: DevOverlayHandles | null = null;
  if (import.meta.env.DEV || import.meta.env.VITE_ENABLE_EDITOR === '1') {
    devOverlay = createDevOverlay();
    devOverlay.playingButton.addEventListener('click', () => {
      if (scene.kind !== 'playing') return;
      // プレイ開始時点の元StageData(グリッドの変化を含まない)をそのまま渡す。
      saveJSON(EDIT_REQUEST_STORAGE_KEY, scene.stageData);
      openEditor();
    });
  }

  // タイトル/ステージ選択/クリア画面のタップ・クリック共通処理。
  // scene.kind === 'playing' のときは InputManager の mousedown/touchend が地形生成/消去を処理する。
  // シーン切替は即座に行わず requestSceneChange() 経由でフェードを挟む。遷移中(黒フェード中)は
  // 誤クリックを無効化する。
  function handleScreenTap(point: { x: number; y: number }): void {
    if (isTransitioning(transition)) return;

    if (scene.kind === 'title') {
      requestSceneChange(() => ({ kind: 'stageSelect' }));
      return;
    }

    if (scene.kind === 'stageSelect') {
      const stageIds = stages.map((s) => s.id);
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        if (!stage) continue;
        if (!pointInRect(point.x, point.y, stageSelectBoxRect(i))) continue;
        // クリア済み + 未クリアの最初の1つだけ選択可能(それ以外はロック表示でタップ無効)。
        if (!isStageSelectable(stage.id, stageIds, save.clearedStageIds)) return;
        requestSceneChange(() => startPlaying(stage.data, i));
        return;
      }
      return;
    }

    if (scene.kind === 'clear') {
      if (hasNextStage(scene.stageIndex) && pointInRect(point.x, point.y, clearNextButtonRect())) {
        const nextIndex = scene.stageIndex + 1;
        const next = stages[nextIndex];
        if (next) {
          requestSceneChange(() => startPlaying(next.data, nextIndex));
        }
        return;
      }
      if (pointInRect(point.x, point.y, clearTitleButtonRect())) {
        requestSceneChange(() => ({ kind: 'title' }));
      }
      return;
    }
  }

  function toCanvasPointFromClient(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('click', (event) => {
    handleScreenTap(toCanvasPointFromClient(event.clientX, event.clientY));
  });

  // InputManager側のtouchstart/touchendがpreventDefault()するため、タッチ後に合成される
  // clickイベントは発火しない。そのためタイトル/選択/クリア画面の遷移はここで別途拾う
  // (地形配置/消去はplaying中のみInputManagerが処理するため、二重発火の心配はない)。
  canvas.addEventListener('touchend', (event) => {
    const touch = event.changedTouches.item(0);
    if (!touch) return;
    handleScreenTap(toCanvasPointFromClient(touch.clientX, touch.clientY));
  });

  // ステージ選択カードのホバー発光(マウスのみ。タッチ操作にホバーの概念は無いためhoveredStageIndexは
  // 常にnullのまま=通常表示になる)。
  canvas.addEventListener('mousemove', (event) => {
    if (scene.kind !== 'stageSelect') {
      hoveredStageIndex = null;
      return;
    }
    const point = toCanvasPointFromClient(event.clientX, event.clientY);
    hoveredStageIndex = null;
    for (let i = 0; i < stages.length; i++) {
      if (pointInRect(point.x, point.y, stageSelectBoxRect(i))) {
        hoveredStageIndex = i;
        break;
      }
    }
  });

  const loop = createLoop({
    update: (dt) => {
      animTime += dt;
      const commands = input.drain();

      if (scene.kind === 'playing') {
        const nextGame = updateGame(scene.game, commands, dt);
        // GameStateのdiff(前フレーム=scene.game・今フレーム=nextGame)からイベントを検出し、
        // パーティクル/画面演出を発火する(core側は一切変更していない。読み取るだけ)。
        effects.handleFrame(scene.game, nextGame, commands);
        persistNewlyCollectedCoins(nextGame.stage.id, nextGame.takenThisSession);
        const stageWidthPx = nextGame.grid.width * TILE_SIZE;
        const stageHeightPx = nextGame.grid.height * TILE_SIZE;
        const targetWorldX = (nextGame.jumpman.position.x + JUMPMAN_WIDTH / 2) * TILE_SIZE;
        const targetWorldY = (nextGame.jumpman.position.y + JUMPMAN_HEIGHT / 2) * TILE_SIZE;
        const nextCamera = updateCamera(
          scene.camera,
          targetWorldX,
          targetWorldY,
          stageWidthPx,
          stageHeightPx,
          LOGICAL_WIDTH,
          GAME_AREA_HEIGHT,
          dt,
        );

        // ちょうど今フレームでクリアした(エッジ検出: 前フレームはまだCleared化していなかった)場合、
        // 即座に'clear'シーンへ切り替えず、フェードを要求する(黒画面の裏でシーンが切り替わる)。
        // ロジックの時間そのものは止めない(シンプルな方を選ぶ、という方針どおり): sceneは
        // このフレームも'playing'のまま更新し続ける('playing'中のstatus===Clearedはcore側の
        // update()が早期returnするだけなので、フェード完了まで無害に据え置かれる)。
        if (nextGame.status === GameStatus.Cleared && scene.game.status !== GameStatus.Cleared) {
          persistStageCleared(nextGame.stage.id, scene.stageIndex);
          const stageIndexAtClear = scene.stageIndex;
          requestSceneChange(() => ({
            kind: 'clear',
            stageIndex: stageIndexAtClear,
            game: nextGame,
            camera: nextCamera,
            clearedAt: animTime,
          }));
        }
        scene = { kind: 'playing', stageIndex: scene.stageIndex, stageData: scene.stageData, game: nextGame, camera: nextCamera };
      }

      // パーティクル/タイマーはGameStateのupdateとは独立にdt駆動で進める('clear'シーン中も
      // 呼び続けることで、クリア画面の背後で紙吹雪が降り続ける演出を成立させる)。
      // マナ比率(0〜1)はplaying/clear中のみ渡す(それ以外のシーンでは影バーを進めない)。
      const manaRatio =
        scene.kind === 'playing' || scene.kind === 'clear'
          ? scene.game.mana.max > 0
            ? scene.game.mana.current / scene.game.mana.max
            : 0
          : undefined;
      effects.update(dt, manaRatio);

      // シーン切替の黒フェードを1フレーム分進める。フェードアウトが完了した瞬間(=画面が
      // 真っ黒になった瞬間)に、保留していたシーン構築処理を実行して実際に切り替える。
      const transitionResult = advanceTransition(transition, dt);
      transition = transitionResult.next;
      if (transitionResult.fadeOutJustCompleted && pendingSceneFactory) {
        scene = pendingSceneFactory();
        pendingSceneFactory = null;
      }
    },
    render: () => {
      devOverlay?.sync(scene.kind);
      upgradeEntry.sync(scene.kind);

      if (scene.kind === 'title') {
        drawTitleScreen(ctx, Math.floor(animTime * 2) % 2 === 0, assets, menuBackgroundLayers, animTime);
      } else if (scene.kind === 'stageSelect') {
        const stageIds = stages.map((s) => s.id);
        const metas: StageMeta[] = stages.map((s) => ({
          id: s.id,
          name: s.data.name,
          theme: s.data.theme,
          coinCount: s.data.coins.length,
          collectedCoinIndices: new Set(save.collected[s.id] ?? []),
          selectable: isStageSelectable(s.id, stageIds, save.clearedStageIds),
          cleared: save.clearedStageIds.includes(s.id),
        }));
        drawStageSelectScreen(ctx, metas, menuBackgroundLayers, animTime, hoveredStageIndex);
      } else if (scene.kind === 'playing') {
        renderGame(ctx, assets, scene.game, scene.camera, animTime, input.getHoverTile(), save.wallet, effects, backgroundLayers);
      } else {
        // 'clear'
        renderGame(
          ctx,
          assets,
          scene.game,
          scene.camera,
          animTime,
          null,
          save.wallet,
          effects,
          backgroundLayers,
          animTime - scene.clearedAt,
        );
        drawClearButtons(ctx, hasNextStage(scene.stageIndex));
      }

      // シーン切替の黒フェード(全シーン共通、最前面に重ねる)
      const fadeAlpha = computeFadeAlpha(transition);
      if (fadeAlpha > 0) {
        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.globalAlpha = fadeAlpha;
        ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        ctx.restore();
      }
    },
  });

  loop.start();
}

// このモジュールは DRAFT_STAGE_STORAGE_KEY / TERRAIN_MASTER_STORAGE_KEY を
// マップ/地形マスタエディタからも import される。#game-canvas が存在するページ
// (= index.html)でのみ自動起動し、他ページへの副作用(bootstrapの誤実行)を防ぐ。
if (typeof document !== 'undefined' && document.getElementById('game-canvas')) {
  void main();
}
