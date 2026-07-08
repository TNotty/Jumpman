// 壊れるブロック(接触中に蓄積ダメージ、2段階の見た目変化→消滅)と
// 落ちるブロック(乗られたら0.4s震え→エンティティ化して落下→画面外で消滅)の動的状態を扱う。
import type { AABB, Vec2 } from './types';
import { BlockType } from './types';
import type { TileGrid } from './grid';
import { adjacentSolidTileCoords, groundedTileCoords } from './physics';
import { BREAKABLE_STAGE_COUNT, BREAKABLE_STAGE_DURATION, FALLING_SHAKE_DURATION, FALL_DEATH_MARGIN } from './constants';

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

// --- 壊れるブロック ---------------------------------------------------

/** タイル座標("x,y") → 蓄積接触時間(秒) */
export type BreakableDamageMap = ReadonlyMap<string, number>;

export const EMPTY_BREAKABLE_DAMAGE: BreakableDamageMap = new Map();

/** 蓄積時間から見た目段階を求める(0=無傷/breakable_1、1=breakable_2、2=breakable_3) */
export function breakableStage(damageSeconds: number): number {
  return Math.floor(damageSeconds / BREAKABLE_STAGE_DURATION);
}

/** 指定タイルの現在の見た目段階(1〜3、breakable_1/2/3スプライトに対応) */
export function breakableSpriteStage(damage: BreakableDamageMap, x: number, y: number): 1 | 2 | 3 {
  const stage = breakableStage(damage.get(tileKey(x, y)) ?? 0);
  if (stage <= 0) return 1;
  if (stage === 1) return 2;
  return 3;
}

export interface BreakableUpdateResult {
  grid: TileGrid;
  damage: BreakableDamageMap;
}

/**
 * 接触中の壊れるブロックへダメージ(dt秒)を蓄積する。閾値(BREAKABLE_STAGE_COUNT段階)に
 * 達したタイルはEmptyにして消滅させる。contactAABBs にはジャンプマン・生存中の敵のAABBを渡す。
 *
 * 壊れるブロックはsolidなため、軸分離衝突解決後のAABBとは構造的に重ならず「接するだけ」になる
 * (踏んでも横から押しても同様)。そのため物理的な重なりを見る overlappingTileCoords ではなく、
 * 隣接接触を見る adjacentSolidTileCoords で判定する。
 */
export function updateBreakableContacts(
  grid: TileGrid,
  damage: BreakableDamageMap,
  contactAABBs: readonly AABB[],
  dt: number,
): BreakableUpdateResult {
  const touched = new Set<string>();
  for (const aabb of contactAABBs) {
    for (const { x, y } of adjacentSolidTileCoords(grid, aabb)) {
      if (grid.get(x, y) === BlockType.Breakable) {
        touched.add(tileKey(x, y));
      }
    }
  }

  if (touched.size === 0) return { grid, damage };

  const nextDamage = new Map(damage);
  let nextGrid = grid;
  let cloned = false;

  for (const key of touched) {
    const current = (nextDamage.get(key) ?? 0) + dt;
    if (breakableStage(current) >= BREAKABLE_STAGE_COUNT) {
      if (!cloned) {
        nextGrid = grid.clone();
        cloned = true;
      }
      const [xs, ys] = key.split(',');
      nextGrid.set(Number(xs), Number(ys), BlockType.Empty);
      nextDamage.delete(key);
    } else {
      nextDamage.set(key, current);
    }
  }

  return { grid: nextGrid, damage: nextDamage };
}

/** 消滅した/範囲外になったタイルの残留エントリを掃除する(グリッドがEmptyに戻った場合の後始末) */
export function pruneBreakableDamage(grid: TileGrid, damage: BreakableDamageMap): BreakableDamageMap {
  let changed = false;
  const next = new Map(damage);
  for (const key of next.keys()) {
    const [xs, ys] = key.split(',');
    if (grid.get(Number(xs), Number(ys)) !== BlockType.Breakable) {
      next.delete(key);
      changed = true;
    }
  }
  return changed ? next : damage;
}

// --- 落ちるブロック ---------------------------------------------------

export type FallingBlockPhase = 'shaking' | 'falling';

export interface FallingBlockState {
  /** 発生元タイルの "x,y"。1つの発生元につき同時に1体まで */
  id: string;
  x: number;
  y: number;
  phase: FallingBlockPhase;
  /** shaking残り時間(秒)。fallingフェーズでは未使用 */
  timer: number;
  velocity: Vec2;
}

/** standers(ジャンプマン・地上の敵のAABB)が落ちるブロックの上に乗ったら新しく起動する */
export function triggerFallingBlocks(
  grid: TileGrid,
  existing: readonly FallingBlockState[],
  standers: readonly AABB[],
): FallingBlockState[] {
  const activeIds = new Set(existing.map((f) => f.id));
  const additions: FallingBlockState[] = [];
  for (const aabb of standers) {
    for (const { x, y } of groundedTileCoords(grid, aabb)) {
      if (grid.get(x, y) !== BlockType.Falling) continue;
      const id = tileKey(x, y);
      if (activeIds.has(id)) continue;
      activeIds.add(id);
      additions.push({ id, x, y, phase: 'shaking', timer: FALLING_SHAKE_DURATION, velocity: { x: 0, y: 0 } });
    }
  }
  return [...existing, ...additions];
}

export interface FallingUpdateResult {
  grid: TileGrid;
  blocks: FallingBlockState[];
}

/**
 * 落ちるブロックの状態遷移。shaking→timer切れでgridをEmptyにしてfallingへ。
 * falling中は重力落下し、ステージ下端を大きく超えたら(画面外)消滅させる。
 */
export function updateFallingBlocks(
  grid: TileGrid,
  blocks: readonly FallingBlockState[],
  gravity: number,
  maxFall: number,
  dt: number,
  stageHeight: number,
): FallingUpdateResult {
  let nextGrid = grid;
  let cloned = false;
  const nextBlocks: FallingBlockState[] = [];

  for (const block of blocks) {
    if (block.phase === 'shaking') {
      const timer = block.timer - dt;
      if (timer <= 0) {
        if (!cloned) {
          nextGrid = grid.clone();
          cloned = true;
        }
        nextGrid.set(block.x, block.y, BlockType.Empty);
        nextBlocks.push({ ...block, phase: 'falling', timer: 0, velocity: { x: 0, y: 0 } });
      } else {
        nextBlocks.push({ ...block, timer });
      }
      continue;
    }

    const vy = Math.min(block.velocity.y + gravity * dt, maxFall);
    const y = block.y + vy * dt;
    if (y > stageHeight + FALL_DEATH_MARGIN) {
      continue; // 画面外で消滅(リストから除外)
    }
    nextBlocks.push({ ...block, y, velocity: { x: 0, y: vy } });
  }

  return { grid: nextGrid, blocks: nextBlocks };
}
