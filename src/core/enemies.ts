// 敵AI: スライム(壁反転・崖から落ちる)/カエル(常時ジャンプ・壁でも反転しない)/鳥(等高度直進・壁反転・重力無効)。
// 能力値は constants.ts の ENEMY_STATS に一元化されている。
import type { AABB, EnemyDefinition, EnemyState, Vec2 } from './types';
import { EnemyType, BlockType } from './types';
import type { TileGrid } from './grid';
import { overlapsBlockType, stepBody } from './physics';
import { ENEMY_HEIGHT, ENEMY_STATS, ENEMY_WIDTH, GRAVITY, MAX_FALL_SPEED, SPIKE_CONTACT_DAMAGE } from './constants';

export function enemyAABB(enemy: { x: number; y: number }): AABB {
  return { x: enemy.x, y: enemy.y, w: ENEMY_WIDTH, h: ENEMY_HEIGHT };
}

/** 指定種別の接触ダメージ量(ENEMY_STATSから取得) */
export function enemyContactDamage(type: EnemyType): number {
  return statsFor(type).contactDamage;
}

function statsFor(type: EnemyType) {
  switch (type) {
    case EnemyType.Slime:
      return ENEMY_STATS.slime;
    case EnemyType.Frog:
      return ENEMY_STATS.frog;
    case EnemyType.Bird:
      return ENEMY_STATS.bird;
    default:
      return ENEMY_STATS.slime;
  }
}

export function createEnemyState(def: EnemyDefinition, id: number): EnemyState {
  return {
    id,
    type: def.type,
    x: def.x,
    y: def.y,
    dir: def.dir,
    velocity: { x: 0, y: 0 },
    hp: statsFor(def.type).hp,
    alive: true,
    grounded: false,
    spawn: { ...def },
  };
}

/** 死亡復帰(チェックポイント再開)時に初期配置へ戻す */
export function resetEnemy(enemy: EnemyState): EnemyState {
  return {
    ...enemy,
    x: enemy.spawn.x,
    y: enemy.spawn.y,
    dir: enemy.spawn.dir,
    velocity: { x: 0, y: 0 },
    hp: statsFor(enemy.type).hp,
    alive: true,
    grounded: false,
  };
}

function updateSlime(enemy: EnemyState, grid: TileGrid, dt: number): EnemyState {
  const stats = ENEMY_STATS.slime;
  const aabb = enemyAABB(enemy);
  const velocity: Vec2 = { x: stats.speed * enemy.dir, y: enemy.velocity.y };
  const result = stepBody(grid, aabb, velocity, GRAVITY, MAX_FALL_SPEED, dt);
  // 壁に当たったら反転。崖(足元に床が無い)は反転せずそのまま歩き続けて落下する。
  const dir: 1 | -1 = result.hitWall ? ((enemy.dir * -1) as 1 | -1) : enemy.dir;
  return { ...enemy, x: result.position.x, y: result.position.y, velocity: result.velocity, dir, grounded: result.grounded };
}

function updateFrog(enemy: EnemyState, grid: TileGrid, dt: number): EnemyState {
  const stats = ENEMY_STATS.frog;
  const aabb = enemyAABB(enemy);
  // 接地している間は毎フレーム新しい跳躍を開始する(=常時ジャンプ移動)。
  // 壁に当たっても velocity.x は 0 になるが dir は反転させないため、次の跳躍も同じ方向を狙う。
  const velocity: Vec2 = enemy.grounded ? { x: stats.jumpVx * enemy.dir, y: stats.jumpVy } : enemy.velocity;
  const result = stepBody(grid, aabb, velocity, GRAVITY, MAX_FALL_SPEED, dt);
  return { ...enemy, x: result.position.x, y: result.position.y, velocity: result.velocity, dir: enemy.dir, grounded: result.grounded };
}

function updateBird(enemy: EnemyState, grid: TileGrid, dt: number): EnemyState {
  const stats = ENEMY_STATS.bird;
  const aabb = enemyAABB(enemy);
  const velocity: Vec2 = { x: stats.speed * enemy.dir, y: 0 };
  // 重力無効(gravity=0)。等高度を直進し、壁に当たったら反転する。
  const result = stepBody(grid, aabb, velocity, 0, MAX_FALL_SPEED, dt);
  const dir: 1 | -1 = result.hitWall ? ((enemy.dir * -1) as 1 | -1) : enemy.dir;
  return { ...enemy, x: result.position.x, y: result.position.y, velocity: result.velocity, dir, grounded: false };
}

/** トゲタイルとの接触ダメージ。HPが尽きたら alive=false にする */
function applySpikeDamage(enemy: EnemyState, grid: TileGrid): EnemyState {
  if (!enemy.alive) return enemy;
  const aabb = enemyAABB(enemy);
  if (!overlapsBlockType(grid, aabb, (t) => t === BlockType.Spike)) return enemy;
  const hp = Math.max(0, enemy.hp - SPIKE_CONTACT_DAMAGE);
  return { ...enemy, hp, alive: hp > 0 };
}

/** 敵1体分の毎フレーム更新(AI移動 → トゲ接触ダメージ)。死亡済みなら何もしない。 */
export function updateEnemy(enemy: EnemyState, grid: TileGrid, dt: number): EnemyState {
  if (!enemy.alive) return enemy;

  let next: EnemyState;
  switch (enemy.type) {
    case EnemyType.Slime:
      next = updateSlime(enemy, grid, dt);
      break;
    case EnemyType.Frog:
      next = updateFrog(enemy, grid, dt);
      break;
    case EnemyType.Bird:
      next = updateBird(enemy, grid, dt);
      break;
    default:
      next = enemy;
  }

  return applySpikeDamage(next, grid);
}
