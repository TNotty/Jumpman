import { describe, expect, it } from 'vitest';
import { validateStage } from '../data/schema';
import { FIXED_DT, JUMPMAN_MAX_HP } from './constants';
import { createGameState, update } from './game';
import { BlockType, EnemyType, GameStatus } from './types';
import type { TerrainDefinition } from './types';

// 小型ステージ(幅30×高さ10)。1タイルの穴と1タイルの段差を含み、
// いずれも自動ジャンプ(崖/壁センサー)だけで越えられる範囲に収めてある。
function buildSmallStage() {
  const width = 30;
  const height = 10;
  const rows: string[] = [];

  for (let y = 0; y < height; y++) {
    if (y === 7) {
      // 段差(x=20-23をrow7から立ち上げる)
      rows.push('.'.repeat(20) + 'NNNN' + '.'.repeat(6));
    } else if (y === 8 || y === 9) {
      // 地面。x=10 に1タイルの穴を空ける
      rows.push('N'.repeat(10) + '.' + 'N'.repeat(19));
    } else {
      rows.push('.'.repeat(width));
    }
  }

  return {
    version: 1,
    id: 'scenario_small',
    name: 'シナリオ検証用ステージ',
    theme: 'grass',
    width,
    height,
    tiles: rows,
    start: { x: 1, y: 6 },
    goal: { x: 27, y: 6 },
    checkpoints: [{ x: 15, y: 6 }],
    enemies: [{ type: 'slime', x: 5, y: 6, dir: -1 }],
    mana: { initial: 10, max: 50, regenPerSec: 1 },
    eraseCost: 3,
  };
}

describe('シナリオ: 小型ステージを自動走行・自動ジャンプでゴールまで到達できる', () => {
  it('Nステップ実行後にステータスがクリアになり、座標がゴール付近にある', () => {
    const validated = validateStage(buildSmallStage());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    let state = createGameState(validated.value);
    const maxSteps = 600; // 10秒分。幅30タイルを6タイル/秒で走れば5秒程度で到達できるはず

    let steps = 0;
    while (state.status !== GameStatus.Cleared && steps < maxSteps) {
      state = update(state, [], FIXED_DT);
      steps += 1;
    }

    expect(state.status).toBe(GameStatus.Cleared);
    expect(steps).toBeLessThan(maxSteps);
    // ゴール判定はジャンプマンAABBがゴールタイルに重なった瞬間に発火するため、
    // ゴール座標のごく近傍(タイル1枚分程度の余裕)にいることを確認する
    expect(state.jumpman.position.x).toBeGreaterThan(state.stage.goal.x - 1);
    expect(state.jumpman.position.x).toBeLessThan(state.stage.goal.x + 2);
    // チェックポイントを通過していること
    expect(state.checkpoints[0]?.activated).toBe(true);
  });

  it('穴に落ちるステージでは、支援なしでは落下死してスタートへ戻る(自動ジャンプの限界確認)', () => {
    const width = 20;
    const height = 10;
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      if (y === 8 || y === 9) {
        // x=5から幅8タイルの穴(自動ジャンプの限界=約4タイルを超える)
        rows.push('N'.repeat(5) + '.'.repeat(8) + 'N'.repeat(width - 13));
      } else {
        rows.push('.'.repeat(width));
      }
    }

    const stage = {
      version: 1,
      id: 'scenario_unreachable',
      name: '支援必須ステージ',
      theme: 'grass',
      width,
      height,
      tiles: rows,
      start: { x: 1, y: 6 },
      goal: { x: 18, y: 6 },
      checkpoints: [],
      enemies: [],
      mana: { initial: 10, max: 50, regenPerSec: 1 },
      eraseCost: 3,
    };

    const validated = validateStage(stage);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    let state = createGameState(validated.value);
    const maxSteps = 300;
    let steps = 0;
    let respawned = false;
    while (state.status !== GameStatus.Cleared && steps < maxSteps) {
      const before = state.jumpman.position.x;
      state = update(state, [], FIXED_DT);
      if (state.jumpman.position.x < before - 1) {
        respawned = true;
      }
      steps += 1;
    }

    expect(state.status).not.toBe(GameStatus.Cleared);
    expect(respawned).toBe(true);
  });

  it('自動ジャンプでは越えられない穴でも、地形を生成すれば橋渡ししてゴールに到達できる', () => {
    const width = 20;
    const height = 10;
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      if (y === 8 || y === 9) {
        // x=5から幅8タイルの穴(自動ジャンプの限界=約4タイルを超える)。同じ形状を再利用。
        rows.push('N'.repeat(5) + '.'.repeat(8) + 'N'.repeat(width - 13));
      } else {
        rows.push('.'.repeat(width));
      }
    }

    const stage = {
      version: 1,
      id: 'scenario_bridge',
      name: '橋渡しステージ',
      theme: 'grass',
      width,
      height,
      tiles: rows,
      start: { x: 1, y: 6 },
      goal: { x: 18, y: 6 },
      checkpoints: [],
      enemies: [],
      // regenPerSec:0 でマナ消費額を厳密に検証できるようにする(回復自体はmana.test.tsで別途検証済み)
      mana: { initial: 10, max: 50, regenPerSec: 0 },
      eraseCost: 3,
    };

    const validated = validateStage(stage);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const bridgeTerrain: TerrainDefinition = { id: 'bridge', name: '橋', cost: 5, unlocked: true, unlockCost: 0, grid: ['NNNNNNNN'] };
    let state = createGameState(validated.value, [bridgeTerrain]);

    // ジャンプマンが穴に到達する前に、穴(x=5..12, row8)をちょうど埋める橋を生成する
    state = update(state, [{ type: 'placeTerrain', terrainId: 'bridge', x: 5, y: 8 }], FIXED_DT);
    expect(state.mana.current).toBe(5); // 初期10 - コスト5
    for (let x = 5; x <= 12; x++) {
      expect(state.grid.get(x, 8)).toBe(BlockType.Normal);
    }

    let steps = 1;
    const maxSteps = 400;
    while (state.status !== GameStatus.Cleared && steps < maxSteps) {
      state = update(state, [], FIXED_DT);
      steps += 1;
    }

    expect(state.status).toBe(GameStatus.Cleared);
    expect(steps).toBeLessThan(maxSteps);
  });

  it('トゲに触れてHPが0になると、チェックポイントへ復帰する(HP全快・生成地形とマナは維持・敵は初期配置リセット)', () => {
    const width = 20;
    const height = 6;
    const rows: string[] = [];
    for (let y = 0; y < height; y++) {
      if (y === 4) {
        // 床の上に埋め込まれたトゲ(x=6-8)。床(row5)自体はずっとsolidなので落下はしない。
        rows.push('.'.repeat(6) + 'SSS' + '.'.repeat(width - 9));
      } else if (y === 5) {
        rows.push('N'.repeat(width));
      } else {
        rows.push('.'.repeat(width));
      }
    }

    const stage = {
      version: 1,
      id: 'scenario_spike_death',
      name: 'トゲ死亡復帰ステージ',
      theme: 'grass',
      width,
      height,
      tiles: rows,
      start: { x: 1, y: 3.5 },
      goal: { x: 18, y: 3.5 },
      checkpoints: [{ x: 3, y: 3.5 }],
      enemies: [{ type: 'slime', x: 15, y: 3.5, dir: -1 }],
      // regenPerSec:0 でマナ消費額を厳密に検証できるようにする(回復自体はmana.test.tsで別途検証済み)
      mana: { initial: 10, max: 50, regenPerSec: 0 },
      eraseCost: 3,
    };

    const validated = validateStage(stage);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const decorTerrain: TerrainDefinition = { id: 'deco', name: '飾り', cost: 1, unlocked: true, unlockCost: 0, grid: ['N'] };
    let state = createGameState(validated.value, [decorTerrain]);

    // 進路に影響しない場所に地形を生成しておき、死亡復帰後も維持されることを確認する
    state = update(state, [{ type: 'placeTerrain', terrainId: 'deco', x: 1, y: 0 }], FIXED_DT);
    expect(state.grid.get(1, 0)).toBe(BlockType.Normal);
    expect(state.mana.current).toBe(9); // 初期10 - コスト1

    // HPを1にしておき、トゲに1回触れるだけで死亡→復帰するようにする
    state = { ...state, jumpman: { ...state.jumpman, hp: 1 } };

    // 敵の本来の初期配置(spawn)を基準にする。state.enemies[0]の現在座標は既に1フレーム分
    // 移動済みなのでスナップショットには使わない(resetEnemyが復元するのはspawnそのもの)。
    const enemySpawn = { x: state.enemies[0]?.spawn.x ?? 0, y: state.enemies[0]?.spawn.y ?? 0 };

    let sawRespawn = false;
    let enemyMoved = false;
    for (let i = 0; i < 300 && !sawRespawn; i++) {
      state = update(state, [], FIXED_DT);
      if (!enemyMoved && (state.enemies[0]?.x !== enemySpawn.x || state.enemies[0]?.y !== enemySpawn.y)) {
        enemyMoved = true;
      }
      if (state.jumpman.hp === JUMPMAN_MAX_HP) {
        sawRespawn = true;
      }
    }

    expect(sawRespawn).toBe(true);
    expect(enemyMoved).toBe(true); // 敵が実際に動いていたこと(復帰でリセットされたことの意味を持たせるため)
    // チェックポイント(x=3)を通過済みなので、スタート地点(x=1)ではなくチェックポイントへ復帰する
    expect(state.jumpman.position.x).toBeCloseTo(3, 5);
    expect(state.jumpman.position.y).toBeCloseTo(3.5, 5);
    // 敵は初期配置へリセットされている
    expect(state.enemies[0]?.x).toBeCloseTo(enemySpawn.x, 5);
    expect(state.enemies[0]?.y).toBeCloseTo(enemySpawn.y, 5);
    expect(state.enemies[0]?.alive).toBe(true);
    // 生成地形とマナは維持される(死亡前に生成したブロックがまだ存在する)
    expect(state.grid.get(1, 0)).toBe(BlockType.Normal);
    expect(state.mana.current).toBe(9);
  });
});
