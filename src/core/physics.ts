// 軸分離AABB×グリッド衝突。全エンティティ(ジャンプマン・敵)共用の純関数群。
// 手順: X移動→押し戻し→Y移動→押し戻し。MAX_FALL_SPEED によって1フレームの移動量が
// タイルサイズ未満に収まるためトンネリングは起きない(呼び出し側は妥当な dt/速度を渡すこと)。
import type { AABB, Vec2 } from './types';
import type { BlockType } from './types';
import type { TileGrid } from './grid';

const EPS = 1e-6;

/** 2つのAABBが重なっているか(接触ダメージ・地形配置の妥当性チェック等に使う汎用ジオメトリ) */
export function aabbOverlaps(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** AABBが重なっているタイル座標の一覧を返す */
export function overlappingTileCoords(aabb: AABB): { x: number; y: number }[] {
  const minX = Math.floor(aabb.x + EPS);
  const maxX = Math.floor(aabb.x + aabb.w - EPS);
  const minY = Math.floor(aabb.y + EPS);
  const maxY = Math.floor(aabb.y + aabb.h - EPS);
  const coords: { x: number; y: number }[] = [];
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      coords.push({ x: tx, y: ty });
    }
  }
  return coords;
}

/** AABBが重なっているタイルの中に predicate を満たすものがあるか(トゲ接触判定等に使う) */
export function overlapsBlockType(grid: TileGrid, aabb: AABB, predicate: (type: BlockType) => boolean): boolean {
  for (const { x, y } of overlappingTileCoords(aabb)) {
    if (predicate(grid.get(x, y))) return true;
  }
  return false;
}

/** 足元(接地面)にあるsolidタイルの座標一覧を返す(落ちるブロックの起動判定に使う) */
export function groundedTileCoords(grid: TileGrid, aabb: AABB): { x: number; y: number }[] {
  const probeY = aabb.y + aabb.h + 0.02;
  const minX = Math.floor(aabb.x + EPS);
  const maxX = Math.floor(aabb.x + aabb.w - EPS);
  const tileY = Math.floor(probeY);
  const coords: { x: number; y: number }[] = [];
  for (let tx = minX; tx <= maxX; tx++) {
    if (grid.isSolid(tx, tileY)) coords.push({ x: tx, y: tileY });
  }
  return coords;
}

/**
 * AABBの下・上・左・右に直接隣接(ごく近傍で接触)しているsolidタイル座標の一覧を返す。
 * solidなブロック(壊れるブロック等)は衝突解決後のAABBと構造的に重ならず「接するだけ」になるため、
 * overlappingTileCoords(物理的な重なり)では検出できない。この接触判定はそれに代わるもの。
 * 足元だけを見る groundedTileCoords と異なり4方向すべてを見る(踏んでも・横から押しても・
 * 下から突き上げても検出できるようにするため)。
 */
export function adjacentSolidTileCoords(grid: TileGrid, aabb: AABB): { x: number; y: number }[] {
  const PROBE = 0.02;
  const minX = Math.floor(aabb.x + EPS);
  const maxX = Math.floor(aabb.x + aabb.w - EPS);
  const minY = Math.floor(aabb.y + EPS);
  const maxY = Math.floor(aabb.y + aabb.h - EPS);

  const seen = new Set<string>();
  const coords: { x: number; y: number }[] = [];
  const add = (x: number, y: number): void => {
    if (!grid.isSolid(x, y)) return;
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    coords.push({ x, y });
  };

  const belowY = Math.floor(aabb.y + aabb.h + PROBE);
  const aboveY = Math.floor(aabb.y - PROBE);
  const leftX = Math.floor(aabb.x - PROBE);
  const rightX = Math.floor(aabb.x + aabb.w + PROBE);

  for (let tx = minX; tx <= maxX; tx++) {
    add(tx, belowY); // 足元
    add(tx, aboveY); // 頭上
  }
  for (let ty = minY; ty <= maxY; ty++) {
    add(leftX, ty); // 左
    add(rightX, ty); // 右(進行方向が右向きのときの前方)
  }

  return coords;
}

export interface PhysicsStepResult {
  position: Vec2;
  velocity: Vec2;
  grounded: boolean;
  hitWall: boolean;
  hitCeiling: boolean;
}

function aabbAt(aabb: AABB, x: number, y: number): AABB {
  return { x, y, w: aabb.w, h: aabb.h };
}

/** AABBが1つでもsolidタイルと重なっているか */
export function overlapsSolid(grid: TileGrid, aabb: AABB): boolean {
  const minX = Math.floor(aabb.x + EPS);
  const maxX = Math.floor(aabb.x + aabb.w - EPS);
  const minY = Math.floor(aabb.y + EPS);
  const maxY = Math.floor(aabb.y + aabb.h - EPS);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (grid.isSolid(tx, ty)) return true;
    }
  }
  return false;
}

function resolveAxisX(
  grid: TileGrid,
  aabb: AABB,
  vx: number,
  dt: number,
): { x: number; hitWall: boolean } {
  if (vx === 0) return { x: aabb.x, hitWall: false };
  const newX = aabb.x + vx * dt;
  const candidate = aabbAt(aabb, newX, aabb.y);
  if (!overlapsSolid(grid, candidate)) {
    return { x: newX, hitWall: false };
  }
  if (vx > 0) {
    const tileX = Math.floor(newX + aabb.w);
    return { x: tileX - aabb.w, hitWall: true };
  }
  const tileX = Math.floor(newX);
  return { x: tileX + 1, hitWall: true };
}

function resolveAxisY(
  grid: TileGrid,
  aabb: AABB,
  vy: number,
  dt: number,
): { y: number; hitCeiling: boolean; landed: boolean } {
  if (vy === 0) return { y: aabb.y, hitCeiling: false, landed: false };
  const newY = aabb.y + vy * dt;
  const candidate = aabbAt(aabb, aabb.x, newY);
  if (!overlapsSolid(grid, candidate)) {
    return { y: newY, hitCeiling: false, landed: false };
  }
  if (vy > 0) {
    const tileY = Math.floor(newY + aabb.h);
    return { y: tileY - aabb.h, hitCeiling: false, landed: true };
  }
  const tileY = Math.floor(newY);
  return { y: tileY + 1, hitCeiling: true, landed: false };
}

/** 足元のごく近傍にsolidタイルがあるか(着地直後も含め毎フレーム判定するための接地チェック) */
export function probeGrounded(grid: TileGrid, aabb: AABB): boolean {
  const probeY = aabb.y + aabb.h + 0.02;
  const minX = Math.floor(aabb.x + EPS);
  const maxX = Math.floor(aabb.x + aabb.w - EPS);
  const tileY = Math.floor(probeY);
  for (let tx = minX; tx <= maxX; tx++) {
    if (grid.isSolid(tx, tileY)) return true;
  }
  return false;
}

export function applyGravity(vy: number, gravity: number, maxFall: number, dt: number): number {
  return Math.min(vy + gravity * dt, maxFall);
}

/**
 * 1エンティティ分の物理ステップ。重力適用→X軸移動/衝突→Y軸移動/衝突の順で解決する。
 */
export function stepBody(
  grid: TileGrid,
  aabb: AABB,
  velocity: Vec2,
  gravity: number,
  maxFall: number,
  dt: number,
): PhysicsStepResult {
  const vy = applyGravity(velocity.y, gravity, maxFall, dt);
  const vx = velocity.x;

  const xResult = resolveAxisX(grid, aabb, vx, dt);
  const afterX = aabbAt(aabb, xResult.x, aabb.y);

  const yResult = resolveAxisY(grid, afterX, vy, dt);
  const finalAABB = aabbAt(aabb, xResult.x, yResult.y);

  const grounded = yResult.landed || probeGrounded(grid, finalAABB);

  return {
    position: { x: finalAABB.x, y: finalAABB.y },
    velocity: {
      x: xResult.hitWall ? 0 : vx,
      y: yResult.hitCeiling || yResult.landed ? 0 : vy,
    },
    grounded,
    hitWall: xResult.hitWall,
    hitCeiling: yResult.hitCeiling,
  };
}
