// 地形生成/消去の妥当性チェックと適用。
// 配置ルール: ジャンプマン・敵と重なるセルを含む配置は拒否。既存ブロックと重なるセルはスキップし
// 空セルのみ生成する(コストは満額)。マナ不足は配置不可。消去はステージ由来ブロックも1マス可。
import type { AABB, EnemyState, ManaState, TerrainDefinition } from './types';
import { BlockType, BLOCK_CHAR_MAP } from './types';
import type { TileGrid } from './grid';
import { aabbOverlaps } from './physics';
import { enemyAABB } from './enemies';
import { canAfford } from './mana';

export type PlacementRejectReason = 'locked' | 'insufficient_mana' | 'blocked_by_entity' | 'no_effect';

export interface PlacementCell {
  x: number;
  y: number;
  type: BlockType;
}

export interface PlacementCheck {
  ok: boolean;
  reason?: PlacementRejectReason;
  /** 実際に生成されるセル(既存ブロックと重なるセルは除外済み) */
  cellsToPlace: PlacementCell[];
}

/**
 * タッチ操作時、指で生成予測が隠れないようにする配置基準アンカー。
 * 'right': 指の右に生成する(タップ位置のマス = 地形の左上/左端。マウス操作と同じ挙動)。
 * 'left' : 指の左に生成する(タップ位置のマス = 地形の右端になるよう基準点を左にずらす)。
 */
export type TouchAnchorSide = 'left' | 'right';

/**
 * タッチ位置のタイルX座標と選択中地形の幅・アンカー方向から、配置基準タイルX座標(左上/左端)を計算する。
 * 純関数(DOM非依存)。マウス操作は常に 'right' 相当(基準点=タップ位置)を使うためこの関数を呼ばない。
 * 幅1(消去スロット等)はどちらのアンカーでもオフセット0で結果は変わらない。
 * グリッド範囲外に出る場合のクランプは行わない(placement側のcheckPlacement/checkEraseの
 * 範囲外スキップ/no_effect判定に委ねる)。
 */
export function anchoredBaseTileX(tapTileX: number, terrainWidth: number, anchorSide: TouchAnchorSide): number {
  if (anchorSide === 'left') {
    const width = Math.max(1, terrainWidth);
    return tapTileX - (width - 1);
  }
  return tapTileX;
}

/** 地形マスタの形状グリッドを、基準点(左上)からのワールド座標セル配列に展開する('.'は形状に含まれない) */
export function expandTerrainCells(terrain: TerrainDefinition, baseX: number, baseY: number): PlacementCell[] {
  const cells: PlacementCell[] = [];
  terrain.grid.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const char = row[dx];
      if (char === undefined || char === '.') continue;
      const type = BLOCK_CHAR_MAP[char] ?? BlockType.Empty;
      if (type === BlockType.Empty) continue;
      cells.push({ x: baseX + dx, y: baseY + dy, type });
    }
  });
  return cells;
}

/**
 * 配置の妥当性を検証する。ジャンプマン・生存中の敵のいずれかと重なるセルが1つでもあれば
 * 配置全体を拒否する。既存ブロック(Empty以外)と重なるセルは生成対象から除外するのみ。
 */
export function checkPlacement(
  grid: TileGrid,
  terrain: TerrainDefinition,
  baseX: number,
  baseY: number,
  jumpmanAABB: AABB,
  enemies: readonly EnemyState[],
  mana: ManaState,
): PlacementCheck {
  if (!terrain.unlocked) {
    return { ok: false, reason: 'locked', cellsToPlace: [] };
  }
  if (!canAfford(mana, terrain.cost)) {
    return { ok: false, reason: 'insufficient_mana', cellsToPlace: [] };
  }

  const allCells = expandTerrainCells(terrain, baseX, baseY);
  if (allCells.length === 0) {
    return { ok: false, reason: 'no_effect', cellsToPlace: [] };
  }

  const aliveEnemyAABBs = enemies.filter((e) => e.alive).map((e) => enemyAABB(e));

  for (const cell of allCells) {
    const cellAABB: AABB = { x: cell.x, y: cell.y, w: 1, h: 1 };
    if (aabbOverlaps(cellAABB, jumpmanAABB)) {
      return { ok: false, reason: 'blocked_by_entity', cellsToPlace: [] };
    }
    for (const enemyBox of aliveEnemyAABBs) {
      if (aabbOverlaps(cellAABB, enemyBox)) {
        return { ok: false, reason: 'blocked_by_entity', cellsToPlace: [] };
      }
    }
  }

  const cellsToPlace = allCells.filter(
    (cell) => grid.inBounds(cell.x, cell.y) && grid.get(cell.x, cell.y) === BlockType.Empty,
  );

  // 全セルが範囲外/既存ブロック上でも生成対象が無い(=何も起きない)なら、マナを徴収せず拒否する。
  // 一部のセルだけが成立する場合(部分スキップ)は従来どおり許可し、コストは満額徴収する。
  if (cellsToPlace.length === 0) {
    return { ok: false, reason: 'no_effect', cellsToPlace: [] };
  }

  return { ok: true, cellsToPlace };
}

/** checkPlacement が ok を返したセル群をグリッドに適用した新しいグリッドを返す */
export function applyPlacement(grid: TileGrid, cells: readonly PlacementCell[]): TileGrid {
  if (cells.length === 0) return grid;
  const next = grid.clone();
  for (const cell of cells) {
    next.set(cell.x, cell.y, cell.type);
  }
  return next;
}

export type EraseRejectReason = 'insufficient_mana' | 'no_effect' | 'out_of_grid';

export interface EraseCheck {
  ok: boolean;
  reason?: EraseRejectReason;
}

/** 1マス消去の妥当性検証。ステージ由来のブロックも消去可。空マスや範囲外は no_effect/out_of_grid で拒否 */
export function checkErase(grid: TileGrid, x: number, y: number, mana: ManaState, eraseCost: number): EraseCheck {
  if (!grid.inBounds(x, y)) {
    return { ok: false, reason: 'out_of_grid' };
  }
  if (grid.get(x, y) === BlockType.Empty) {
    return { ok: false, reason: 'no_effect' };
  }
  if (!canAfford(mana, eraseCost)) {
    return { ok: false, reason: 'insufficient_mana' };
  }
  return { ok: true };
}

/** checkErase が ok を返した場合に適用する(1マスをEmptyにした新しいグリッドを返す) */
export function applyErase(grid: TileGrid, x: number, y: number): TileGrid {
  const next = grid.clone();
  next.set(x, y, BlockType.Empty);
  return next;
}
