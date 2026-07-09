// ゲーム全体の状態と唯一の更新入口 update(state, commands, dt)。決定論的(同じ入力なら同じ結果)。
import type { Command } from './commands';
import { GRAVITY, JUMPMAN_HEIGHT, JUMPMAN_WIDTH, MAX_FALL_SPEED, SPIKE_CONTACT_DAMAGE } from './constants';
import { TileGrid } from './grid';
import { applyDamage, createJumpman, isDead, isFallDeath, jumpmanAABB, respawn, setRespawnPoint, updateJumpman } from './jumpman';
import { createEnemyState, enemyAABB, enemyContactDamage, resetEnemy, updateEnemy } from './enemies';
import { regenerate, spend } from './mana';
import { aabbOverlaps, overlapsBlockType } from './physics';
import { applyErase, applyPlacement, checkErase, checkPlacement } from './placement';
import type { PlayerStats } from './upgrades';
import { DEFAULT_PLAYER_STATS } from './upgrades';
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
  CoinState,
  EnemyState,
  GameStatus as GameStatusType,
  JumpmanState,
  ManaState,
  PaletteSlot,
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
  /**
   * パレット8枠の元データ。要素はloadout(セーブデータ)由来で、空枠はnull(選択不可)になる。
   * 空配列ならパレット未使用ステージ扱い(既存の挙動を維持)。
   */
  terrainMaster: (TerrainDefinition | null)[];
  /** 現在パレットで選択中のスロット(0-7、または常時選択可能な消去スロット'eraser') */
  selectedSlot: PaletteSlot;
  breakableDamage: BreakableDamageMap;
  fallingBlocks: FallingBlockState[];
  /** コインの実行時状態(stage.coinsと同じ並び順、index対応) */
  coins: CoinState[];
  /**
   * 今回のプレイ(このGameStateの生存期間。死亡/リトライを跨いでも維持=リセットされない)中に
   * 新規取得したコインのindex一覧。permanentlyCollectedだったコインのindexは含まれない
   * (=ここに現れるのは常に「walletを増やすべき新規取得」のみ)。app層はこの配列の増分を見て
   * セーブデータへ即座に反映する(src/data/saveData.ts 参照)。
   */
  takenThisSession: number[];
  /**
   * 強化(アップグレード)を織り込み済みの実効ステータス(src/core/upgrades.ts参照)。
   * jumpman.tsの自動走行/自動ジャンプ/死亡復帰へ毎フレーム渡される。省略時はDEFAULT_PLAYER_STATS
   * (強化レベル0相当=既存の定数と同じ値)になり、既存の挙動と完全互換になる。
   */
  playerStats: PlayerStats;
  status: GameStatusType;
  elapsedTime: number;
}

/**
 * @param collectedCoinIndices このステージで既にセーブデータ上取得済みのコインindex集合。
 *   該当indexのコインは permanentlyCollected=true で開始する(半透明表示・wallet加算なし)。
 *   core層はセーブデータそのものを知らず、app層が導出したこの集合だけを受け取る(純粋性維持)。
 * @param playerStats 強化を織り込み済みの実効ステータス(省略時はDEFAULT_PLAYER_STATS=強化レベル0)。
 *   jumpmanの初期速度/最大HP、マナの回復倍率/上限ボーナスに反映される。
 */
export function createGameState(
  stage: StageData,
  terrainMaster: (TerrainDefinition | null)[] = [],
  collectedCoinIndices: ReadonlySet<number> = new Set(),
  playerStats: PlayerStats = DEFAULT_PLAYER_STATS,
): GameState {
  const grid = TileGrid.fromRows(stage.tiles);
  return {
    stage,
    grid,
    jumpman: createJumpman(stage.start, playerStats),
    checkpoints: stage.checkpoints.map((cp) => ({ ...cp, activated: false })),
    enemies: stage.enemies.map((def, index) => createEnemyState(def, index)),
    mana: {
      current: stage.mana.initial,
      max: stage.mana.max + playerStats.manaMaxBonus,
      regenPerSec: stage.mana.regenPerSec * playerStats.manaRegenMultiplier,
    },
    terrainMaster,
    selectedSlot: 0,
    breakableDamage: EMPTY_BREAKABLE_DAMAGE,
    fallingBlocks: [],
    coins: stage.coins.map((coin, index) => ({
      x: coin.x,
      y: coin.y,
      permanentlyCollected: collectedCoinIndices.has(index),
      collectedThisSession: false,
    })),
    takenThisSession: [],
    playerStats,
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
 * 消去スロット('eraser')選択中は、placeTerrainコマンド(左クリック/タップの主操作)を
 * terrainIdを見ずに1マス消去として扱う。右クリック由来のeraseTileコマンドは
 * 選択中スロットに関わらず常時有効(既存の挙動を維持)。
 */
function applyCommands(state: GameState, commands: readonly Command[]): GameState {
  let grid = state.grid;
  let mana = state.mana;
  let selectedSlot = state.selectedSlot;
  const aabb = jumpmanAABB(state.jumpman.position);

  for (const command of commands) {
    switch (command.type) {
      case 'placeTerrain': {
        if (selectedSlot === 'eraser') {
          const check = checkErase(grid, command.x, command.y, mana, state.stage.eraseCost);
          if (!check.ok) break;
          grid = applyErase(grid, command.x, command.y);
          mana = spend(mana, state.stage.eraseCost);
          break;
        }
        const terrain = state.terrainMaster.find((t) => t?.id === command.terrainId);
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
        if (slot === 'eraser') {
          selectedSlot = 'eraser';
        } else {
          const target = state.terrainMaster[slot];
          if (slot >= 0 && slot < state.terrainMaster.length && target?.unlocked) {
            selectedSlot = slot;
          }
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

/**
 * ジャンプマンとコインの重なりを判定し、未取得コインを取得済みにする。
 * permanentlyCollected(セーブ済み)なコインは判定自体をスキップする(=何も起きない。
 * 半透明表示のまま・walletも増えない。「当たり判定はあるが効果が無い」のと外形的に同じ結果になる)。
 * 新規取得(collectedThisSession)したコインのindexだけを takenThisSession に積む
 * (permanentlyCollectedなコインのindexは決してここに入らない=app層は増分をそのままwallet加算に使える)。
 */
function applyCoinCollection(state: GameState): GameState {
  let changed = false;
  const newlyTakenIndices: number[] = [];

  const coins = state.coins.map((coin, index) => {
    if (coin.permanentlyCollected || coin.collectedThisSession) return coin;
    if (!overlapsTile(state.jumpman.position, coin)) return coin;
    changed = true;
    newlyTakenIndices.push(index);
    return { ...coin, collectedThisSession: true };
  });

  if (!changed) return state;
  return { ...state, coins, takenThisSession: [...state.takenThisSession, ...newlyTakenIndices] };
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
    jumpman: respawn(state.jumpman, state.playerStats),
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
 * 接触ダメージ → ブロック動的状態 → チェックポイント/コイン取得/ゴール判定 → 死亡復帰。
 */
export function update(state: GameState, commands: readonly Command[], dt: number): GameState {
  if (state.status === GameStatus.Cleared) {
    return { ...state, elapsedTime: state.elapsedTime + dt };
  }

  let next = applyCommands(state, commands);
  next = { ...next, mana: regenerate(next.mana, dt) };

  next = { ...next, jumpman: updateJumpman(next.jumpman, next.grid, dt, next.playerStats) };
  next = { ...next, enemies: next.enemies.map((enemy) => updateEnemy(enemy, next.grid, dt)) };

  next = applyContactDamage(next);
  next = applyBlockDynamics(next, dt);

  next = applyCheckpoints(next);
  next = applyCoinCollection(next);
  next = applyGoal(next);

  next = applyDeathAndRespawn(next);

  next = { ...next, elapsedTime: next.elapsedTime + dt };
  return next;
}
