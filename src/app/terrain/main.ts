// 地形マスタエディタのエントリポイント(terrain.html から読み込まれる)。
// イベント駆動+ダーティフラグ再描画(60fpsループ不要)。core/render/data を可能な限り再利用する。
import { GAME_AREA_HEIGHT } from '../../core/constants';
import { BlockType } from '../../core/types';
import { validateTerrainMaster } from '../../data/schema';
import terrainMasterRaw from '../../data/terrainMaster.json';
import { drawPaletteSlots } from '../../render/renderer';
import { downloadJSON, loadJSON, readJSONFile, saveJSON } from '../../platform/storage';
import { TERRAIN_MASTER_STORAGE_KEY } from '../game/main';
import {
  MAX_TERRAIN_COUNT,
  MAX_TERRAIN_GRID_SIZE,
  addTerrain,
  createBlankTerrainMaster,
  getTerrainCell,
  moveTerrain,
  removeTerrain,
  resizeTerrainGrid,
  setTerrainCell,
  toTerrainMaster,
  updateTerrainMeta,
} from './terrainDraft';
import type { TerrainMaster } from '../../core/types';

const TERRAIN_AUTOSAVE_KEY = 'jumpman:terrainEditorAutosave';
const AUTOSAVE_DEBOUNCE_MS = 3000;
const GRID_CELL_PX = 40;

const CELL_TYPES: readonly { type: BlockType; label: string }[] = [
  { type: BlockType.Empty, label: '空' },
  { type: BlockType.Normal, label: '通常' },
  { type: BlockType.Breakable, label: '壊れる' },
  { type: BlockType.Spike, label: 'トゲ' },
  { type: BlockType.Falling, label: '落ちる' },
];

function requireElement<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as unknown as T;
}

function blockColor(type: BlockType): string {
  switch (type) {
    case BlockType.Normal:
      return '#8b5a2b';
    case BlockType.Breakable:
      return '#c0895a';
    case BlockType.Spike:
      return '#e74c3c';
    case BlockType.Falling:
      return '#5d4632';
    case BlockType.Empty:
    default:
      return '#262626';
  }
}

function main(): void {
  const listEl = requireElement<HTMLDivElement>('terrain-list');
  const gridPaletteEl = requireElement<HTMLDivElement>('grid-palette');
  const errorsEl = requireElement<HTMLDivElement>('errors');
  const autosaveStatusEl = requireElement<HTMLDivElement>('autosave-status');

  const idInput = requireElement<HTMLInputElement>('field-id');
  const nameInput = requireElement<HTMLInputElement>('field-name');
  const costInput = requireElement<HTMLInputElement>('field-cost');
  const unlockedInput = requireElement<HTMLInputElement>('field-unlocked');
  const gridWidthInput = requireElement<HTMLInputElement>('field-grid-width');
  const gridHeightInput = requireElement<HTMLInputElement>('field-grid-height');

  const gridCanvas = requireElement<HTMLCanvasElement>('grid-canvas');
  const gridCtx = gridCanvas.getContext('2d');
  if (!gridCtx) throw new Error('2D描画コンテキストの取得に失敗しました(grid-canvas)');

  const previewCanvas = requireElement<HTMLCanvasElement>('palette-preview-canvas');
  const previewCtx = previewCanvas.getContext('2d');
  if (!previewCtx) throw new Error('2D描画コンテキストの取得に失敗しました(palette-preview-canvas)');

  const btnAdd = requireElement<HTMLButtonElement>('btn-add');
  const btnRemove = requireElement<HTMLButtonElement>('btn-remove');
  const btnUp = requireElement<HTMLButtonElement>('btn-up');
  const btnDown = requireElement<HTMLButtonElement>('btn-down');
  const btnDownload = requireElement<HTMLButtonElement>('btn-download');
  const btnLoadFile = requireElement<HTMLButtonElement>('btn-load-file');
  const fileInput = requireElement<HTMLInputElement>('file-input');
  const btnLoadLocal = requireElement<HTMLButtonElement>('btn-load-local');
  const btnLoadSample = requireElement<HTMLButtonElement>('btn-load-sample');
  const btnApplyToGame = requireElement<HTMLButtonElement>('btn-apply-to-game');

  let master: TerrainMaster = createBlankTerrainMaster();
  let selectedIndex = 0;
  let selectedCellType: BlockType = BlockType.Normal;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  const showErrors = (errors: readonly string[]): void => {
    errorsEl.textContent = errors.join('\n');
  };
  const clearErrors = (): void => {
    errorsEl.textContent = '';
  };

  const markDirty = (): void => {
    if (autosaveTimer !== null) clearTimeout(autosaveTimer);
    autosaveStatusEl.textContent = '未保存の変更があります…';
    autosaveTimer = setTimeout(() => {
      saveJSON(TERRAIN_AUTOSAVE_KEY, master);
      autosaveStatusEl.textContent = `自動保存しました(${new Date().toLocaleTimeString('ja-JP')})`;
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  const renderList = (): void => {
    listEl.innerHTML = '';
    master.terrains.forEach((terrain, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = index === selectedIndex ? 'terrain-item selected' : 'terrain-item';
      btn.textContent = `${index + 1}. ${terrain.name}${terrain.unlocked ? '' : '(未解放)'}`;
      btn.addEventListener('click', () => {
        selectedIndex = index;
        syncAll();
      });
      listEl.appendChild(btn);
    });
    if (master.terrains.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '12px';
      empty.style.color = '#888';
      empty.textContent = '地形がありません。「追加」してください。';
      listEl.appendChild(empty);
    }
  };

  const renderGridPalette = (): void => {
    gridPaletteEl.innerHTML = '';
    for (const cellType of CELL_TYPES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = cellType.label;
      btn.style.borderColor = cellType.type === selectedCellType ? '#f1c40f' : '#555';
      btn.addEventListener('click', () => {
        selectedCellType = cellType.type;
        renderGridPalette();
      });
      gridPaletteEl.appendChild(btn);
    }
  };

  const renderGridCanvas = (): void => {
    gridCtx.fillStyle = '#1a1a1a';
    gridCtx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);

    const terrain = master.terrains[selectedIndex];
    if (!terrain) return;

    const gridW = terrain.grid[0]?.length ?? 0;
    const gridH = terrain.grid.length;

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const type = getTerrainCell(terrain, x, y);
        gridCtx.fillStyle = blockColor(type);
        gridCtx.fillRect(x * GRID_CELL_PX, y * GRID_CELL_PX, GRID_CELL_PX - 1, GRID_CELL_PX - 1);
      }
    }

    gridCtx.strokeStyle = '#f1c40f';
    gridCtx.lineWidth = 2;
    gridCtx.strokeRect(0, 0, gridW * GRID_CELL_PX, gridH * GRID_CELL_PX);
  };

  const renderPalettePreview = (): void => {
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewCtx.save();
    previewCtx.translate(0, -GAME_AREA_HEIGHT);
    drawPaletteSlots(previewCtx, master.terrains, selectedIndex);
    previewCtx.restore();
  };

  const syncFormFromSelected = (): void => {
    const terrain = master.terrains[selectedIndex];
    const disabled = !terrain;
    for (const input of [idInput, nameInput, costInput, unlockedInput, gridWidthInput, gridHeightInput]) {
      input.disabled = disabled;
    }
    if (!terrain) return;
    idInput.value = terrain.id;
    nameInput.value = terrain.name;
    costInput.value = String(terrain.cost);
    unlockedInput.checked = terrain.unlocked;
    gridWidthInput.value = String(terrain.grid[0]?.length ?? 1);
    gridHeightInput.value = String(terrain.grid.length);
  };

  const syncAll = (): void => {
    renderList();
    syncFormFromSelected();
    renderGridCanvas();
    renderPalettePreview();
  };

  // --- 一覧操作 -----------------------------------------------------------

  btnAdd.addEventListener('click', () => {
    if (master.terrains.length >= MAX_TERRAIN_COUNT) return;
    master = addTerrain(master);
    selectedIndex = master.terrains.length - 1;
    clearErrors();
    syncAll();
    markDirty();
  });

  btnRemove.addEventListener('click', () => {
    if (master.terrains.length === 0) return;
    master = removeTerrain(master, selectedIndex);
    selectedIndex = Math.max(0, Math.min(selectedIndex, master.terrains.length - 1));
    syncAll();
    markDirty();
  });

  function moveSelected(direction: 1 | -1): void {
    const targetIndex = selectedIndex + direction;
    if (targetIndex < 0 || targetIndex >= master.terrains.length) return;
    master = moveTerrain(master, selectedIndex, direction);
    selectedIndex = targetIndex;
    syncAll();
    markDirty();
  }
  btnUp.addEventListener('click', () => moveSelected(-1));
  btnDown.addEventListener('click', () => moveSelected(1));

  // --- フォーム -------------------------------------------------------------

  idInput.addEventListener('change', () => {
    master = updateTerrainMeta(master, selectedIndex, { id: idInput.value });
    renderList();
    markDirty();
  });
  nameInput.addEventListener('change', () => {
    master = updateTerrainMeta(master, selectedIndex, { name: nameInput.value });
    renderList();
    renderPalettePreview();
    markDirty();
  });
  costInput.addEventListener('change', () => {
    master = updateTerrainMeta(master, selectedIndex, { cost: Number(costInput.value) });
    renderPalettePreview();
    markDirty();
  });
  unlockedInput.addEventListener('change', () => {
    master = updateTerrainMeta(master, selectedIndex, { unlocked: unlockedInput.checked });
    renderList();
    renderGridCanvas();
    renderPalettePreview();
    markDirty();
  });
  gridWidthInput.addEventListener('change', () => {
    const terrain = master.terrains[selectedIndex];
    if (!terrain) return;
    master = resizeTerrainGrid(master, selectedIndex, Number(gridWidthInput.value), terrain.grid.length);
    syncFormFromSelected();
    renderGridCanvas();
    renderPalettePreview();
    markDirty();
  });
  gridHeightInput.addEventListener('change', () => {
    const terrain = master.terrains[selectedIndex];
    if (!terrain) return;
    master = resizeTerrainGrid(master, selectedIndex, terrain.grid[0]?.length ?? 1, Number(gridHeightInput.value));
    syncFormFromSelected();
    renderGridCanvas();
    renderPalettePreview();
    markDirty();
  });

  // --- グリッドキャンバス操作 ---------------------------------------------------

  let isPaintingGrid = false;

  function paintGridCellAt(clientX: number, clientY: number): void {
    const terrain = master.terrains[selectedIndex];
    if (!terrain) return;
    const rect = gridCanvas.getBoundingClientRect();
    const scaleX = gridCanvas.width / rect.width;
    const scaleY = gridCanvas.height / rect.height;
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top) * scaleY;
    const cellX = Math.floor(px / GRID_CELL_PX);
    const cellY = Math.floor(py / GRID_CELL_PX);
    const gridW = terrain.grid[0]?.length ?? 0;
    const gridH = terrain.grid.length;
    if (cellX < 0 || cellY < 0 || cellX >= gridW || cellY >= gridH) return;
    master = setTerrainCell(master, selectedIndex, cellX, cellY, selectedCellType);
    renderGridCanvas();
    renderPalettePreview();
    markDirty();
  }

  gridCanvas.addEventListener('mousedown', (event) => {
    isPaintingGrid = true;
    paintGridCellAt(event.clientX, event.clientY);
  });
  window.addEventListener('mouseup', () => {
    isPaintingGrid = false;
  });
  gridCanvas.addEventListener('mousemove', (event) => {
    if (isPaintingGrid) paintGridCellAt(event.clientX, event.clientY);
  });

  // --- ファイル操作 -------------------------------------------------------------

  function setMaster(next: TerrainMaster): void {
    master = next;
    selectedIndex = 0;
    clearErrors();
    syncAll();
    markDirty();
  }

  btnDownload.addEventListener('click', () => {
    const result = toTerrainMaster(master);
    if (!result.ok || !result.value) {
      showErrors(result.errors);
      return;
    }
    clearErrors();
    downloadJSON('terrainMaster.json', result.value);
  });

  btnLoadFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    readJSONFile<unknown>(file)
      .then((raw) => {
        const result = validateTerrainMaster(raw);
        if (!result.ok) {
          showErrors(result.errors);
          return;
        }
        setMaster(result.value);
      })
      .catch((error: unknown) => {
        showErrors([error instanceof Error ? error.message : 'ファイルの読込に失敗しました']);
      });
  });

  btnLoadLocal.addEventListener('click', () => {
    const raw = loadJSON<unknown>(TERRAIN_AUTOSAVE_KEY);
    const result = raw !== null ? validateTerrainMaster(raw) : null;
    if (!result || !result.ok) {
      showErrors(result && !result.ok ? result.errors : ['下書きが見つかりません']);
      return;
    }
    setMaster(result.value);
  });

  btnLoadSample.addEventListener('click', () => {
    const result = validateTerrainMaster(terrainMasterRaw);
    if (!result.ok) {
      showErrors(result.errors);
      return;
    }
    setMaster(result.value);
  });

  btnApplyToGame.addEventListener('click', () => {
    const result = toTerrainMaster(master);
    if (!result.ok || !result.value) {
      showErrors(result.errors);
      return;
    }
    clearErrors();
    saveJSON(TERRAIN_MASTER_STORAGE_KEY, result.value);
    autosaveStatusEl.textContent = 'ゲームへ反映しました(index.html の次回読込から有効です)';
  });

  // --- 起動 -----------------------------------------------------------------

  const autosaved = loadJSON<unknown>(TERRAIN_AUTOSAVE_KEY);
  const autosavedResult = autosaved !== null ? validateTerrainMaster(autosaved) : null;
  if (autosavedResult && autosavedResult.ok) {
    master = autosavedResult.value;
  } else {
    const bundledResult = validateTerrainMaster(terrainMasterRaw);
    master = bundledResult.ok ? bundledResult.value : createBlankTerrainMaster();
  }

  renderGridPalette();
  syncAll();
}

main();
