// ゲーム全体の状態と唯一の更新入口 update(state, commands, dt)。決定論的(同じ入力なら同じ結果)。
import type { Command } from './commands';
import { GRAVITY, JUMPMAN_HEIGHT, JUMPMAN_WIDTH, MAX_FALL_SPEED, SPIKE_CONTACT_DAMAGE } from './constants';
import { TileGrid } from './grid';
import { applyDamage, createJumpman, isDead, isFallDeath, jumpmanAABB, respawn, setRespawnPoint, updateJumpman } from './jumpman';
import { createEnemyState, enemyAABB, enemyContactDamage, resetEnemy, updateEnemy } from './enemies';
import { regenerate, spend } from './mana';
import { aabbOverlaps, overlapsBlockType } from './physics';
import { applyErase, applyPlacement, checkErase, checkPlacement } from './placement';
import {
  EMPTY_BREAKABLE_DAMAGE,
  pruneBreakableDamage,
  triggerFallingBlocks,
  updateBreakableContacts,
  updateFallingBlocks,
} from './blocks';
import type { BreakableDamageMap, FallingBlockState } from './blocks';
import type {
  AABB,
  CheckpointState,
  EnemyState,
  GameStatus as GameStatusType,
  JumpmanState,
  ManaState,
  StageData,
  TerrainDefinition,
  Vec2,
} from './types';
import { BlockType, GameStatus } from './types';

export interface GameState {
  stage: StageData;
  grid: TileGrid;
  jumpman: JumpmanState;
  checkpoints: CheckpointState[];
  enemies: EnemyState[];
  mana: ManaState;
  /** パレット8枠の元データ(terrainMaster.json)。空配列ならパレット未使用ステージ扱い */
  terrainMaster: TerrainDefinition[];
  /** 現在パレットで選択中のスロット(0-7) */
  selectedSlot: number;
  breakableDamage: BreakableDamageMap;
  fallingBlocks: FallingBlockState[];
  status: GameStatusType;
  elapsedTime: number;
}

export function createGameState(stage: StageData, terrainMaster: TerrainDefinition[] = []): GameState {
  const grid = TileGrid.fromRows(stage.tiles);
  return {
    stage,
    grid,
    jumpman: createJumpman(stage.start),
    checkpoints: stage.checkpoints.map((cp) => ({ ...cp, activated: false })),
    enemies: stage.enemies.map((def, index) => createEnemyState(def, index)),
    mana: { current: stage.mana.initial, max: stage.mana.max, regenPerSec: stage.mana.regenPerSec },
    terrainMaster,
    selectedSlot: 0,
    breakableDamage: EMPTY_BREAKABLE_DAMAGE,
    fallingBlocks: [],
    status: GameStatus.Playing,
    elapsedTime: 0,
  };
}

function overlapsTile(position: Vec2, tile: Vec2): boolean {
  const left = position.x;
  const right = position.x + JUMPMAN_WIDTH;
  const top = position.y;
  const bottom = position.y + JUMPMAN_HEIGHT;
  return left < tile.x + 1 && right > tile.x && top < tile.y + 1 && bottom > tile.y;
}

/**
 * placeTerrain/eraseTile/selectSlot コマンドをこのフレームの物理更新の前に適用する。
 * 判定・妥当性検証は placement.ts に委譲し、ここでは順番に適用するだけ。
 */
function applyCommands(state: GameState, commands: readonly Command[]): GameState {
  let grid = state.grid;
  let mana = state.mana;
  let selectedSlot = state.selectedSlot;
  const aabb = jumpmanAABB(state.jumpman.position);

  for (const command of commands) {
    switch (command.type) {
      case 'placeTerrain': {
        const terrain = state.terrainMaster.find((t) => t.id === command.terrainId);
        if (!terrain) break;
        const check = checkPlacement(grid, terrain, command.x, command.y, aabb, state.enemies, mana);
        if (!check.ok) break;
        grid = applyPlacement(grid, check.cellsToPlace);
        mana = spend(mana, terrain.cost);
        break;
      }
      case 'eraseTile': {
        const check = checkErase(grid, command.x, command.y, mana, state.stage.eraseCost);
        if (!check.ok) break;
        grid = applyErase(grid, command.x, command.y);
        mana = spend(mana, state.stage.eraseCost);
        break;
      }
      case 'selectSlot': {
        const slot = command.slot;
        const target = state.terrainMaster[slot];
        if (slot >= 0 && slot < state.terrainMaster.length && target?.unlocked) {
          selectedSlot = slot;
        }
        break;
      }
      default:
        break;
    }
  }

  if (grid === state.grid && mana === state.mana && selectedSlot === state.selectedSlot) {
    return state;
  }
  return { ...state, grid, mana, selectedSlot };
}

/** トゲ/敵接触によるジャンプマンへのダメージ・ノックバック・無敵付与を適用する */
function applyContactDamage(state: GameState): GameState {
  const aabb = jumpmanAABB(state.jumpman.position);

  let damage = 0;
  if (overlapsBlockType(state.grid, aabb, (t) => t === BlockType.Spike)) {
    damage = SPIKE_CONTACT_DAMAGE;
  } else {
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue;
      if (aabbOverlaps(aabb, enemyAABB(enemy))) {
        damage = enemyContactDamage(enemy.type);
        break;
      }
    }
  }

  if (damage <= 0) return state;

  const jumpman = applyDamage(state.jumpman, damage);
  if (jumpman === state.jumpman) return state; // 無敵中で変化なし
  return { ...state, jumpman };
}

/** 壊れる/落ちるブロックの動的状態(接触蓄積ダメージ・震え→落下)を進める */
function applyBlockDynamics(state: GameState, dt: number): GameState {
  const contactAABBs: AABB[] = [jumpmanAABB(state.jumpman.position)];
  for (const enemy of state.enemies) {
    if (enemy.alive) contactAABBs.push(enemyAABB(enemy));
  }

  const breakableResult = updateBreakableContacts(state.grid, state.breakableDamage, contactAABBs, dt);

  const triggered = triggerFallingBlocks(breakableResult.grid, state.fallingBlocks, contactAABBs);
  const fallingResult = updateFallingBlocks(
    breakableResult.grid,
    triggered,
    GRAVITY,
    MAX_FALL_SPEED,
    dt,
    state.stage.height,
  );

  const breakableDamage = pruneBreakableDamage(fallingResult.grid, breakableResult.damage);

  return { ...state, grid: fallingResult.grid, breakableDamage, fallingBlocks: fallingResult.blocks };
}

function applyCheckpoints(state: GameState): GameState {
  let respawnHolder = state.jumpman;
  let changed = false;
  const checkpoints = state.checkpoints.map((cp) => {
    if (cp.activated) return cp;
    if (overlapsTile(state.jumpman.position, cp)) {
      changed = true;
      respawnHolder = setRespawnPoint(respawnHolder, { x: cp.x, y: cp.y });
      return { ...cp, activated: true };
    }
    return cp;
  });
  if (!changed) return state;
  return { ...state, checkpoints, jumpman: respawnHolder };
}

function applyGoal(state: GameState): GameState {
  if (state.status === GameStatus.Cleared) return state;
  if (overlapsTile(state.jumpman.position, state.stage.goal)) {
    return { ...state, status: GameStatus.Cleared };
  }
  return state;
}

/**
 * 死亡(落下死/HP0)からチェックポイントへ完全復帰させる。
 * HP全快・生成地形とマナは維持・敵は初期配置へリセット。
 */
function respawnAtCheckpoint(state: GameState): GameState {
  return {
    ...state,
    jumpman: respawn(state.jumpman),
    enemies: state.enemies.map(resetEnemy),
  };
}

function applyDeathAndRespawn(state: GameState): GameState {
  const fellOff = isFallDeath(state.jumpman.position, state.grid.height);
  const outOfHp = isDead(state.jumpman);
  if (!fellOff && !outOfHp) return state;
  return respawnAtCheckpoint(state);
}

/**
 * ゲーム状態の唯一の更新入口。
 * 順序: コマンド適用(地形生成/消去/パレット選択) → マナ回復 → ジャンプマン/敵の移動 →
 * 接触ダメージ → ブロック動的状態 → チェックポイント/ゴール判定 → 死亡復帰。
 */
export function update(state: GameState, commands: readonly Command[], dt: number): GameState {
  if (state.status === GameStatus.Cleared) {
    return { ...state, elapsedTime: state.elapsedTime + dt };
  }

  let next = applyCommands(state, commands);
  next = { ...next, mana: regenerate(next.mana, dt) };

  next = { ...next, jumpman: updateJumpman(next.jumpman, next.grid, dt) };
  next = { ...next, enemies: next.enemies.map((enemy) => updateEnemy(enemy, next.grid, dt)) };

  next = applyContactDamage(next);
  next = applyBlockDynamics(next, dt);

  next = applyCheckpoints(next);
  next = applyGoal(next);

  next = applyDeathAndRespawn(next);

  next = { ...next, elapsedTime: next.elapsedTime + dt };
  return next;
}
