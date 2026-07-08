// ジャンプマンの自動走行・自動ジャンプ・HP・無敵・ノックバックを扱う純関数群。
// 落下死/HP0死亡時の「チェックポイントへの完全復帰」(敵の初期配置リセットを含む)は
// 複数エンティティにまたがる横断的な処理のため game.ts が orchestrate する。
// ここではジャンプマン単体の状態遷移(位置リセット・無敵タイマー等)のみを扱う。
import type { AABB, JumpmanState, Vec2 } from './types';
import type { TileGrid } from './grid';
import { stepBody } from './physics';
import {
  CLIFF_LOOKAHEAD,
  CLIFF_PROBE_DROP,
  FALL_DEATH_MARGIN,
  GRAVITY,
  INVINCIBLE_DURATION,
  JUMPMAN_HEIGHT,
  JUMPMAN_MAX_HP,
  JUMPMAN_WIDTH,
  JUMP_COOLDOWN,
  JUMP_VELOCITY,
  KNOCKBACK_DURATION,
  KNOCKBACK_VX,
  KNOCKBACK_VY,
  MAX_FALL_SPEED,
  RUN_SPEED,
  WALL_SENSOR_OFFSET,
} from './constants';

export function createJumpman(start: Vec2): JumpmanState {
  return {
    position: { x: start.x, y: start.y },
    velocity: { x: RUN_SPEED, y: 0 },
    facing: 1,
    grounded: false,
    hp: JUMPMAN_MAX_HP,
    invincibleTimer: 0,
    jumpCooldown: 0,
    knockbackTimer: 0,
    respawnPoint: { x: start.x, y: start.y },
  };
}

export function jumpmanAABB(position: Vec2): AABB {
  return { x: position.x, y: position.y, w: JUMPMAN_WIDTH, h: JUMPMAN_HEIGHT };
}

export interface JumpSensors {
  /** 前方(進行方向)に壁があるか */
  wallAhead: boolean;
  /** 前方の足元に床が無い(崖)か */
  cliffAhead: boolean;
}

function isSolidColumn(grid: TileGrid, x: number, top: number, height: number): boolean {
  const EPS = 1e-6;
  const tx = Math.floor(x);
  const minY = Math.floor(top + EPS);
  const maxY = Math.floor(top + height - EPS);
  for (let ty = minY; ty <= maxY; ty++) {
    if (grid.isSolid(tx, ty)) return true;
  }
  return false;
}

/** 壁センサー(前方 WALL_SENSOR_OFFSET タイルの縦方向)と崖プローブ(前方 CLIFF_LOOKAHEAD, 下方 CLIFF_PROBE_DROP)を計算する */
export function computeJumpSensors(grid: TileGrid, aabb: AABB, facing: 1 | -1): JumpSensors {
  const frontX = facing > 0 ? aabb.x + aabb.w + WALL_SENSOR_OFFSET : aabb.x - WALL_SENSOR_OFFSET;
  const wallAhead = isSolidColumn(grid, frontX, aabb.y, aabb.h);

  const footProbeX = facing > 0 ? aabb.x + aabb.w + CLIFF_LOOKAHEAD : aabb.x - CLIFF_LOOKAHEAD;
  const footProbeY = aabb.y + aabb.h + CLIFF_PROBE_DROP;
  const cliffAhead = !grid.isSolid(Math.floor(footProbeX), Math.floor(footProbeY));

  return { wallAhead, cliffAhead };
}

/**
 * 自動ジャンプ判定。接地中のみ発火し、壁センサーを優先し、崖プローブがフォールバックする。
 * ジャンプ後 JUMP_COOLDOWN 秒は再発火しない。
 */
export function shouldJump(
  grid: TileGrid,
  aabb: AABB,
  facing: 1 | -1,
  grounded: boolean,
  jumpCooldown: number,
): boolean {
  if (!grounded) return false;
  if (jumpCooldown > 0) return false;
  const sensors = computeJumpSensors(grid, aabb, facing);
  if (sensors.wallAhead) return true;
  return sensors.cliffAhead;
}

/** ステージ高さを踏まえた落下死判定(y > height + FALL_DEATH_MARGIN) */
export function isFallDeath(position: Vec2, stageHeight: number): boolean {
  return position.y > stageHeight + FALL_DEATH_MARGIN;
}

/** 直近のスタート/チェックポイント座標へ戻す。HP全快・速度リセット */
export function respawn(state: JumpmanState): JumpmanState {
  return {
    ...state,
    position: { x: state.respawnPoint.x, y: state.respawnPoint.y },
    velocity: { x: RUN_SPEED, y: 0 },
    facing: 1,
    grounded: false,
    hp: JUMPMAN_MAX_HP,
    invincibleTimer: 0,
    jumpCooldown: 0,
    knockbackTimer: 0,
  };
}

export function setRespawnPoint(state: JumpmanState, point: Vec2): JumpmanState {
  return { ...state, respawnPoint: { x: point.x, y: point.y } };
}

/** HPが0以下か */
export function isDead(state: JumpmanState): boolean {
  return state.hp <= 0;
}

/**
 * 被弾処理。無敵中は何も起きない(同一参照を返す)。
 * ダメージ→HP減少→ノックバック→無敵付与、の順で1つの状態遷移として適用する。
 * knockbackTimer が設定され、その間 updateJumpman は自動走行によるvelocity.x上書きと
 * 自動ジャンプ判定を抑制するため、ここで設定した速度がそのまま物理演算に反映される。
 */
export function applyDamage(state: JumpmanState, damage: number): JumpmanState {
  if (state.invincibleTimer > 0) return state;
  return {
    ...state,
    hp: Math.max(0, state.hp - damage),
    velocity: { x: KNOCKBACK_VX, y: KNOCKBACK_VY },
    invincibleTimer: INVINCIBLE_DURATION,
    knockbackTimer: KNOCKBACK_DURATION,
  };
}

/**
 * ジャンプマン1体分の毎フレーム更新。自動走行→自動ジャンプ判定→物理ステップ→各種タイマー減算の順。
 * ノックバック中(knockbackTimer > 0)は自動走行によるvelocity.x上書きと自動ジャンプ判定を
 * 抑制し、applyDamageが設定した速度をそのまま物理演算に渡す(壁に向かって後退中の誤発火防止)。
 * 重力・衝突解決はノックバック中でも通常どおり適用される。
 * 落下死判定(isFallDeath)とHP0死亡判定は呼び出し側(game.ts)が行い、
 * 死亡時のチェックポイント復帰は respawn() を使って呼び出し側から適用する。
 */
export function updateJumpman(state: JumpmanState, grid: TileGrid, dt: number): JumpmanState {
  const aabb = jumpmanAABB(state.position);
  const inKnockback = state.knockbackTimer > 0;

  let velocity: Vec2 = inKnockback ? state.velocity : { x: RUN_SPEED * state.facing, y: state.velocity.y };

  let jumpCooldown = Math.max(0, state.jumpCooldown - dt);

  if (!inKnockback && shouldJump(grid, aabb, state.facing, state.grounded, jumpCooldown)) {
    velocity = { ...velocity, y: JUMP_VELOCITY };
    jumpCooldown = JUMP_COOLDOWN;
  }

  const result = stepBody(grid, aabb, velocity, GRAVITY, MAX_FALL_SPEED, dt);

  return {
    ...state,
    position: result.position,
    velocity: result.velocity,
    grounded: result.grounded,
    jumpCooldown,
    knockbackTimer: Math.max(0, state.knockbackTimer - dt),
    invincibleTimer: Math.max(0, state.invincibleTimer - dt),
  };
}
