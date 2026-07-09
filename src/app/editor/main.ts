// マップエディタのエントリポイント(editor.html から読み込まれる)。
// イベント駆動+ダーティフラグ再描画(60fpsループ不要)。core/render/data を可能な限り再利用する。
import { JUMPMAN_HEIGHT, JUMPMAN_WIDTH, TILE_SIZE } from '../../core/constants';
import { validateStage } from '../../data/schema';
import stage01Raw from '../../data/stages/stage01.json';
import stage02Raw from '../../data/stages/stage02.json';
import { AssetStore, loadAssets } from '../../render/assets';
import { blockSpriteName, enemySpriteName } from '../../render/renderer';
import { drawSprite } from '../../render/sprites';
import { openGameDraft } from '../../platform/navigation';
import { downloadJSON, loadJSON, readJSONFile, removeJSON, saveJSON } from '../../platform/storage';
import { DRAFT_STAGE_STORAGE_KEY, EDIT_REQUEST_STORAGE_KEY } from '../game/main';
import { EditorTool, TOOL_LABEL, TOOL_ORDER, blockTypeForTool, enemyTypeForTool, isPaintTool, toolFromKey } from './paletteTool';
import {
  createBlankDraft,
  eraseAt,
  fromStageData,
  getTile,
  isStageDraftLike,
  resizeDraft,
  resolveInitialDraft,
  setGoal,
  setStart,
  setTile,
  toStageData,
  toggleCheckpoint,
  toggleEnemy,
  updateMana,
  updateMeta,
} from './stageDraft';
import type { StageDraft } from './stageDraft';

const EDITOR_AUTOSAVE_KEY = 'jumpman:editorAutosave';
const AUTOSAVE_DEBOUNCE_MS = 3000;

function requireElement<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as unknown as T;
}

function main(): void {
  const canvas = requireElement<HTMLCanvasElement>('editor-canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D描画コンテキストの取得に失敗しました');

  const coordsEl = requireElement<HTMLDivElement>('coords');
  const paletteEl = requireElement<HTMLDivElement>('palette');
  const errorsEl = requireElement<HTMLDivElement>('errors');
  const autosaveStatusEl = requireElement<HTMLDivElement>('autosave-status');

  const idInput = requireElement<HTMLInputElement>('field-id');
  const nameInput = requireElement<HTMLInputElement>('field-name');
  const widthInput = requireElement<HTMLInputElement>('field-width');
  const heightInput = requireElement<HTMLInputElement>('field-height');
  const themeSelect = requireElement<HTMLSelectElement>('field-theme');
  const manaInitialInput = requireElement<HTMLInputElement>('field-mana-initial');
  const manaMaxInput = requireElement<HTMLInputElement>('field-mana-max');
  const manaRegenInput = requireElement<HTMLInputElement>('field-mana-regen');
  const eraseCostInput = requireElement<HTMLInputElement>('field-erase-cost');

  const btnNew = requireElement<HTMLButtonElement>('btn-new');
  const btnDownload = requireElement<HTMLButtonElement>('btn-download');
  const btnLoadFile = requireElement<HTMLButtonElement>('btn-load-file');
  const fileInput = requireElement<HTMLInputElement>('file-input');
  const btnLoadLocal = requireElement<HTMLButtonElement>('btn-load-local');
  const btnLoadSample1 = requireElement<HTMLButtonElement>('btn-load-sample1');
  const btnLoadSample2 = requireElement<HTMLButtonElement>('btn-load-sample2');
  const btnTestplay = requireElement<HTMLButtonElement>('btn-testplay');

  let draft: StageDraft = createBlankDraft();
  let currentTool: EditorTool = EditorTool.BlockNormal;
  let assets: AssetStore | null = null;
  let hoverTile: { x: number; y: number } | null = null;

  const camera = { x: 0, y: 0, zoom: 1 };
  let isPaintingLeft = false;
  let isErasingRight = false;
  let isPanning = false;
  let spaceHeld = false;
  let panLast = { x: 0, y: 0 };
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let renderScheduled = false;

  // --- 座標変換 -----------------------------------------------------------

  function toCanvasPoint(event: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  }

  function screenToWorldPx(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x / camera.zoom + camera.x, y: p.y / camera.zoom + camera.y };
  }

  function screenToTile(p: { x: number; y: number }): { x: number; y: number } {
    const w = screenToWorldPx(p);
    return { x: Math.floor(w.x / TILE_SIZE), y: Math.floor(w.y / TILE_SIZE) };
  }

  function tileToScreen(tileX: number, tileY: number): { x: number; y: number } {
    return { x: (tileX * TILE_SIZE - camera.x) * camera.zoom, y: (tileY * TILE_SIZE - camera.y) * camera.zoom };
  }

  // --- 描画 -----------------------------------------------------------------
  // render/scheduleRenderはconstのアロー関数式にする(function宣言だとctxのnullナローイングが
  // クロージャ越しに効かないため)。

  const render = (): void => {
    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!assets) return;

    const tilePx = TILE_SIZE * camera.zoom;
    const minTileX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
    const maxTileX = Math.min(draft.width - 1, Math.ceil((camera.x + canvas.width / camera.zoom) / TILE_SIZE));
    const minTileY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
    const maxTileY = Math.min(draft.height - 1, Math.ceil((camera.y + canvas.height / camera.zoom) / TILE_SIZE));

    for (let y = minTileY; y <= maxTileY; y++) {
      for (let x = minTileX; x <= maxTileX; x++) {
        const spriteName = blockSpriteName(getTile(draft, x, y), draft.theme, 1);
        if (!spriteName) continue;
        const p = tileToScreen(x, y);
        drawSprite(ctx, assets, spriteName, 0, p.x, p.y, tilePx, tilePx);
      }
    }

    // ステージ範囲の外枠
    const origin = tileToScreen(0, 0);
    const end = tileToScreen(draft.width, draft.height);
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(origin.x, origin.y, end.x - origin.x, end.y - origin.y);

    // グリッド線(ズームが小さいときは省略して負荷を抑える)
    if (tilePx >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      for (let x = minTileX; x <= maxTileX + 1; x++) {
        const p = tileToScreen(x, 0);
        ctx.beginPath();
        ctx.moveTo(p.x, 0);
        ctx.lineTo(p.x, canvas.height);
        ctx.stroke();
      }
      for (let y = minTileY; y <= maxTileY + 1; y++) {
        const p = tileToScreen(0, y);
        ctx.beginPath();
        ctx.moveTo(0, p.y);
        ctx.lineTo(canvas.width, p.y);
        ctx.stroke();
      }
    }

    if (draft.start) {
      const p = tileToScreen(draft.start.x, draft.start.y);
      drawSprite(ctx, assets, 'jumpman_idle', 0, p.x, p.y, tilePx * JUMPMAN_WIDTH, tilePx * JUMPMAN_HEIGHT);
    }
    if (draft.goal) {
      const flagH = tilePx * 1.5;
      const bottom = tileToScreen(draft.goal.x, draft.goal.y + 1);
      drawSprite(ctx, assets, 'goal_flag', 0, bottom.x, bottom.y - flagH, tilePx, flagH);
    }
    for (const cp of draft.checkpoints) {
      const flagH = tilePx * 1.5;
      const bottom = tileToScreen(cp.x, cp.y + 1);
      drawSprite(ctx, assets, 'checkpoint_flag', 0, bottom.x, bottom.y - flagH, tilePx, flagH);
    }
    for (const enemy of draft.enemies) {
      const p = tileToScreen(enemy.x, enemy.y);
      drawSprite(ctx, assets, enemySpriteName(enemy.type), 0, p.x, p.y, tilePx, tilePx);
    }

    if (hoverTile) {
      const p = tileToScreen(hoverTile.x, hoverTile.y);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x, p.y, tilePx, tilePx);
    }
  };

  const scheduleRender = (): void => {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  };

  // --- ドラフト操作 -----------------------------------------------------------

  function showErrors(errors: readonly string[]): void {
    errorsEl.textContent = errors.join('\n');
  }

  function clearErrors(): void {
    errorsEl.textContent = '';
  }

  function syncFormFromDraft(): void {
    idInput.value = draft.id;
    nameInput.value = draft.name;
    widthInput.value = String(draft.width);
    heightInput.value = String(draft.height);
    themeSelect.value = draft.theme;
    manaInitialInput.value = String(draft.mana.initial);
    manaMaxInput.value = String(draft.mana.max);
    manaRegenInput.value = String(draft.mana.regenPerSec);
    eraseCostInput.value = String(draft.eraseCost);
  }

  function markDirty(): void {
    if (autosaveTimer !== null) clearTimeout(autosaveTimer);
    autosaveStatusEl.textContent = '未保存の変更があります…';
    autosaveTimer = setTimeout(() => {
      saveJSON(EDITOR_AUTOSAVE_KEY, draft);
      autosaveStatusEl.textContent = `自動保存しました(${new Date().toLocaleTimeString('ja-JP')})`;
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  function setDraft(next: StageDraft): void {
    draft = next;
    syncFormFromDraft();
    clearErrors();
    scheduleRender();
    markDirty();
  }

  function applyPaint(point: { x: number; y: number }): void {
    const blockType = blockTypeForTool(currentTool);
    if (blockType !== null) {
      draft = setTile(draft, point.x, point.y, blockType);
    } else if (currentTool === EditorTool.Eraser) {
      draft = eraseAt(draft, point);
    }
    scheduleRender();
    markDirty();
  }

  function applyClickTool(point: { x: number; y: number }): void {
    if (currentTool === EditorTool.Start) {
      draft = setStart(draft, point);
    } else if (currentTool === EditorTool.Goal) {
      draft = setGoal(draft, point);
    } else if (currentTool === EditorTool.Checkpoint) {
      draft = toggleCheckpoint(draft, point);
    } else {
      const enemyType = enemyTypeForTool(currentTool);
      if (enemyType !== null) {
        draft = toggleEnemy(draft, point, enemyType);
      }
    }
    scheduleRender();
    markDirty();
  }

  // --- パレットUI -------------------------------------------------------------

  function renderPalette(): void {
    paletteEl.innerHTML = '';
    TOOL_ORDER.forEach((tool, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = tool === currentTool ? 'tool-btn selected' : 'tool-btn';
      const keyHint = index < 9 ? `<span class="key">[${index + 1}]</span>` : '';
      btn.innerHTML = `${TOOL_LABEL[tool]}${keyHint}`;
      btn.addEventListener('click', () => {
        currentTool = tool;
        renderPalette();
      });
      paletteEl.appendChild(btn);
    });
  }

  // --- マウス操作 -------------------------------------------------------------

  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  canvas.addEventListener('mousedown', (event) => {
    const screenPoint = toCanvasPoint(event);
    if (event.button === 1 || (event.button === 0 && spaceHeld)) {
      isPanning = true;
      panLast = screenPoint;
      event.preventDefault();
      return;
    }
    const tile = screenToTile(screenPoint);
    if (event.button === 0) {
      if (isPaintTool(currentTool)) {
        isPaintingLeft = true;
        applyPaint(tile);
      } else {
        applyClickTool(tile);
      }
    } else if (event.button === 2) {
      isErasingRight = true;
      draft = eraseAt(draft, tile);
      scheduleRender();
      markDirty();
    }
  });

  window.addEventListener('mouseup', () => {
    isPaintingLeft = false;
    isErasingRight = false;
    isPanning = false;
  });

  canvas.addEventListener('mousemove', (event) => {
    const screenPoint = toCanvasPoint(event);
    if (isPanning) {
      camera.x -= (screenPoint.x - panLast.x) / camera.zoom;
      camera.y -= (screenPoint.y - panLast.y) / camera.zoom;
      panLast = screenPoint;
      scheduleRender();
      return;
    }
    const tile = screenToTile(screenPoint);
    hoverTile = tile;
    coordsEl.textContent = `x: ${tile.x}, y: ${tile.y}`;
    if (isPaintingLeft) applyPaint(tile);
    if (isErasingRight) {
      draft = eraseAt(draft, tile);
      markDirty();
    }
    scheduleRender();
  });

  canvas.addEventListener('mouseleave', () => {
    hoverTile = null;
    coordsEl.textContent = 'x: -, y: -';
    scheduleRender();
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const screenPoint = toCanvasPoint(event);
      const worldBefore = screenToWorldPx(screenPoint);
      const zoomFactor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      camera.zoom = Math.max(0.25, Math.min(4, camera.zoom * zoomFactor));
      const worldAfter = screenToWorldPx(screenPoint);
      camera.x += worldBefore.x - worldAfter.x;
      camera.y += worldBefore.y - worldAfter.y;
      scheduleRender();
    },
    { passive: false },
  );

  // --- キーボード操作 -----------------------------------------------------------

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      spaceHeld = true;
      event.preventDefault();
      return;
    }
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'SELECT') return; // フォーム入力中は数字キーを奪わない
    const tool = toolFromKey(event.key);
    if (tool) {
      currentTool = tool;
      renderPalette();
    }
  });

  window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') spaceHeld = false;
  });

  // --- ステージ設定フォーム -----------------------------------------------------

  idInput.addEventListener('change', () => {
    draft = updateMeta(draft, { id: idInput.value });
    markDirty();
  });
  nameInput.addEventListener('change', () => {
    draft = updateMeta(draft, { name: nameInput.value });
    markDirty();
  });
  themeSelect.addEventListener('change', () => {
    draft = updateMeta(draft, { theme: themeSelect.value });
    scheduleRender();
    markDirty();
  });
  widthInput.addEventListener('change', () => {
    draft = resizeDraft(draft, Number(widthInput.value), draft.height);
    syncFormFromDraft();
    scheduleRender();
    markDirty();
  });
  heightInput.addEventListener('change', () => {
    draft = resizeDraft(draft, draft.width, Number(heightInput.value));
    syncFormFromDraft();
    scheduleRender();
    markDirty();
  });
  manaInitialInput.addEventListener('change', () => {
    draft = updateMana(draft, { initial: Number(manaInitialInput.value) });
    markDirty();
  });
  manaMaxInput.addEventListener('change', () => {
    draft = updateMana(draft, { max: Number(manaMaxInput.value) });
    markDirty();
  });
  manaRegenInput.addEventListener('change', () => {
    draft = updateMana(draft, { regenPerSec: Number(manaRegenInput.value) });
    markDirty();
  });
  eraseCostInput.addEventListener('change', () => {
    draft = updateMeta(draft, { eraseCost: Number(eraseCostInput.value) });
    markDirty();
  });

  // --- ファイル操作 -------------------------------------------------------------

  btnNew.addEventListener('click', () => {
    if (!window.confirm('現在の編集内容を破棄して新規作成しますか?')) return;
    setDraft(createBlankDraft());
  });

  btnDownload.addEventListener('click', () => {
    const result = toStageData(draft);
    if (!result.ok || !result.value) {
      showErrors(result.errors);
      return;
    }
    clearErrors();
    downloadJSON(`${draft.id || 'stage'}.json`, result.value);
  });

  btnLoadFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    readJSONFile<unknown>(file)
      .then((raw) => {
        const result = validateStage(raw);
        if (!result.ok) {
          showErrors(result.errors);
          return;
        }
        setDraft(fromStageData(result.value));
      })
      .catch((error: unknown) => {
        showErrors([error instanceof Error ? error.message : 'ファイルの読込に失敗しました']);
      });
  });

  btnLoadLocal.addEventListener('click', () => {
    const raw = loadJSON<unknown>(EDITOR_AUTOSAVE_KEY);
    if (raw === null || !isStageDraftLike(raw)) {
      showErrors(['下書きが見つからないか、壊れています']);
      return;
    }
    setDraft(raw);
  });

  function loadSample(raw: unknown): void {
    const result = validateStage(raw);
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    setDraft(fromStageData({ ...result.value, id: `${result.value.id}_copy` }));
  }
  btnLoadSample1.addEventListener('click', () => loadSample(stage01Raw));
  btnLoadSample2.addEventListener('click', () => loadSample(stage02Raw));

  btnTestplay.addEventListener('click', () => {
    const result = toStageData(draft);
    if (!result.ok || !result.value) {
      showErrors(result.errors);
      return;
    }
    clearErrors();
    saveJSON(DRAFT_STAGE_STORAGE_KEY, result.value);
    openGameDraft();
  });

  // --- 起動 -----------------------------------------------------------------
  // 優先順位: editRequest(ゲーム側「エディタで開く」由来) → オートセーブ → 新規。
  // editRequestは存在すれば成否を問わず消去し、通常起動(次回以降のリロード)を汚さない。

  const editRequestRaw = loadJSON<unknown>(EDIT_REQUEST_STORAGE_KEY);
  const autosavedRaw = loadJSON<unknown>(EDITOR_AUTOSAVE_KEY);
  const initial = resolveInitialDraft(editRequestRaw, autosavedRaw);
  draft = initial.draft;
  if (initial.shouldClearEditRequest) {
    removeJSON(EDIT_REQUEST_STORAGE_KEY);
  }
  if (initial.warning) {
    showErrors([initial.warning]);
    console.warn(initial.warning);
  }
  syncFormFromDraft();
  renderPalette();

  loadAssets()
    .then((loaded) => {
      assets = loaded;
      scheduleRender();
    })
    .catch((error: unknown) => {
      showErrors(['アセットの読み込みに失敗しました']);
      console.error(error);
    });
}

main();
