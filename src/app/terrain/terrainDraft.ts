// 地形マスタエディタの編集中データを扱う純関数群。DOM/Canvasには一切依存しない。
// core/types.ts の TerrainDefinition/TerrainMaster、core/data/schema.ts の
// validateTerrainMaster をそのまま再利用する(ロジックの二重実装をしない)。
import { validateTerrainMaster } from '../../data/schema';
import { BLOCK_CHAR_MAP, BLOCK_TYPE_CHAR, BlockType } from '../../core/types';
import type { TerrainDefinition, TerrainMaster } from '../../core/types';

export const MAX_TERRAIN_COUNT = 8;
export const MAX_TERRAIN_GRID_SIZE = 8;
export const MIN_TERRAIN_GRID_SIZE = 1;

export function createBlankTerrainMaster(): TerrainMaster {
  return { version: 1, terrains: [] };
}

let idCounter = 0;
function nextTerrainId(existing: readonly TerrainDefinition[]): string {
  idCounter += 1;
  let candidate = `terrain_${idCounter}`;
  const existingIds = new Set(existing.map((t) => t.id));
  while (existingIds.has(candidate)) {
    idCounter += 1;
    candidate = `terrain_${idCounter}`;
  }
  return candidate;
}

export function createBlankTerrain(existing: readonly TerrainDefinition[] = []): TerrainDefinition {
  return {
    id: nextTerrainId(existing),
    name: '新しい地形',
    cost: 1,
    unlocked: true,
    grid: ['N'],
  };
}

/** 8枠上限内であれば末尾に新規地形を追加する(上限に達していれば変化なし) */
export function addTerrain(master: TerrainMaster): TerrainMaster {
  if (master.terrains.length >= MAX_TERRAIN_COUNT) return master;
  return { ...master, terrains: [...master.terrains, createBlankTerrain(master.terrains)] };
}

export function removeTerrain(master: TerrainMaster, index: number): TerrainMaster {
  if (index < 0 || index >= master.terrains.length) return master;
  return { ...master, terrains: master.terrains.filter((_, i) => i !== index) };
}

/** 指定インデックスの地形を隣(direction: -1=上/1=下)と入れ替える。境界では変化なし */
export function moveTerrain(master: TerrainMaster, index: number, direction: 1 | -1): TerrainMaster {
  const targetIndex = index + direction;
  if (index < 0 || index >= master.terrains.length) return master;
  if (targetIndex < 0 || targetIndex >= master.terrains.length) return master;

  const terrains = [...master.terrains];
  const a = terrains[index];
  const b = terrains[targetIndex];
  if (!a || !b) return master;
  terrains[index] = b;
  terrains[targetIndex] = a;
  return { ...master, terrains };
}

export function updateTerrainMeta(
  master: TerrainMaster,
  index: number,
  patch: Partial<Pick<TerrainDefinition, 'id' | 'name' | 'cost' | 'unlocked'>>,
): TerrainMaster {
  const target = master.terrains[index];
  if (!target) return master;
  const terrains = [...master.terrains];
  terrains[index] = { ...target, ...patch };
  return { ...master, terrains };
}

/**
 * 地形グリッドのサイズを変更する(最大8×8)。既存の形状は左上を基準に保持し、
 * はみ出す部分は切り詰め、拡張した部分は空('.')で埋める。
 */
export function resizeTerrainGrid(master: TerrainMaster, index: number, width: number, height: number): TerrainMaster {
  const target = master.terrains[index];
  if (!target) return master;

  const nextWidth = Math.max(MIN_TERRAIN_GRID_SIZE, Math.min(MAX_TERRAIN_GRID_SIZE, Math.floor(width)));
  const nextHeight = Math.max(MIN_TERRAIN_GRID_SIZE, Math.min(MAX_TERRAIN_GRID_SIZE, Math.floor(height)));

  const grid: string[] = [];
  for (let y = 0; y < nextHeight; y++) {
    const sourceRow = target.grid[y] ?? '';
    let row = sourceRow.slice(0, nextWidth);
    if (row.length < nextWidth) {
      row += '.'.repeat(nextWidth - row.length);
    }
    grid.push(row);
  }

  const terrains = [...master.terrains];
  terrains[index] = { ...target, grid };
  return { ...master, terrains };
}

function replaceRowChar(row: string, x: number, char: string): string {
  return row.slice(0, x) + char + row.slice(x + 1);
}

/** グリッド上の1マスにブロック種別を設定する(タイル凡例はステージJSONと共通) */
export function setTerrainCell(master: TerrainMaster, index: number, x: number, y: number, type: BlockType): TerrainMaster {
  const target = master.terrains[index];
  if (!target) return master;
  const row = target.grid[y];
  if (row === undefined || x < 0 || x >= row.length) return master;
  const char = BLOCK_TYPE_CHAR[type];
  if (row[x] === char) return master;

  const grid = [...target.grid];
  grid[y] = replaceRowChar(row, x, char);
  const terrains = [...master.terrains];
  terrains[index] = { ...target, grid };
  return { ...master, terrains };
}

export function getTerrainCell(terrain: TerrainDefinition, x: number, y: number): BlockType {
  const row = terrain.grid[y];
  if (row === undefined || x < 0 || x >= row.length) return BlockType.Empty;
  const char = row[x] ?? '.';
  return BLOCK_CHAR_MAP[char] ?? BlockType.Empty;
}

export interface DraftToTerrainMasterResult {
  ok: boolean;
  errors: string[];
  value?: TerrainMaster;
}

/** 保存前に schema.ts の validateTerrainMaster を通す(二重実装を避ける) */
export function toTerrainMaster(master: TerrainMaster): DraftToTerrainMasterResult {
  const result = validateTerrainMaster(master);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, errors: [], value: result.value };
}
