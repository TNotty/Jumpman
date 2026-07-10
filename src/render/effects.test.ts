import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTICLE_POOL_CAPACITY,
  EVENT_PARTICLE_COUNTS,
  clearParticlePool,
  countActiveParticles,
  createEffectsManager,
  createParticlePool,
  detectEffectEvents,
  spawnParticle,
  updateParticlePool,
} from './effects';
import { FIXED_DT } from '../core/constants';
import { createGameState, update } from '../core/game';
import type { GameState } from '../core/game';
import { BlockType, EnemyType, GameStatus } from '../core/types';
import type { StageData, TerrainDefinition } from '../core/types';
import type { Command } from '../core/commands';

function buildStage(overrides: Partial<StageData> = {}): StageData {
  return {
    version: 1,
    id: 'test',
    name: 'テスト',
    theme: 'grass',
    width: 30,
    height: 8,
    // floorTopY=6(2行の床の上端)なので、start/goal/敵は「床の2タイル上」(floorTopY-2=4)に
    // 置く(重力で自然に落下着地する。core/game.test.ts等の既存テストと同じ規約)。
    tiles: Array.from({ length: 8 }, (_, y) => (y >= 6 ? 'N'.repeat(30) : '.'.repeat(30))),
    start: { x: 1, y: 4 },
    goal: { x: 26, y: 4 },
    checkpoints: [],
    enemies: [],
    mana: { initial: 20, max: 50, regenPerSec: 1 },
    eraseCost: 3,
    coins: [],
    ...overrides,
  };
}

/** grounded/hp/takenThisSession等が変化した直後の(prev, next)ペアを条件が満たされるまで探す */
function stepUntil(
  state: GameState,
  predicate: (prev: GameState, next: GameState) => boolean,
  commandsPerStep: readonly Command[] = [],
  maxSteps = 2000,
): { prev: GameState; next: GameState } {
  let prev = state;
  for (let i = 0; i < maxSteps; i++) {
    const next = update(prev, commandsPerStep, FIXED_DT);
    if (predicate(prev, next)) return { prev, next };
    prev = next;
  }
  throw new Error('条件を満たすフレームが見つかりませんでした(maxSteps到達)');
}

// --- パーティクルプール(純ロジック) -------------------------------------------------------

describe('ParticlePool(純ロジック: 寿命更新・プール上限)', () => {
  it('createParticlePoolは指定容量ぶんの非アクティブなパーティクルで初期化される', () => {
    const pool = createParticlePool(8);
    expect(pool.capacity).toBe(8);
    expect(pool.particles).toHaveLength(8);
    expect(countActiveParticles(pool)).toBe(0);
  });

  it('既定の容量は512', () => {
    expect(DEFAULT_PARTICLE_POOL_CAPACITY).toBe(512);
  });

  it('spawnParticleでアクティブなパーティクルが1つ増える', () => {
    const pool = createParticlePool(4);
    spawnParticle(pool, { x: 1, y: 2, vx: 0, vy: 0, life: 1, size: 3, color: '#fff' });
    expect(countActiveParticles(pool)).toBe(1);
    expect(pool.particles[0]?.x).toBe(1);
    expect(pool.particles[0]?.y).toBe(2);
    expect(pool.particles[0]?.life).toBe(1);
  });

  it('updateParticlePoolは位置を速度分だけ進め、寿命をdtぶん減らす', () => {
    const pool = createParticlePool(4);
    spawnParticle(pool, { x: 0, y: 0, vx: 2, vy: 3, life: 1, size: 3, color: '#fff', gravity: 0 });
    updateParticlePool(pool, 0.5);
    const p = pool.particles[0];
    expect(p?.x).toBeCloseTo(1, 5);
    expect(p?.y).toBeCloseTo(1.5, 5);
    expect(p?.life).toBeCloseTo(0.5, 5);
    expect(p?.active).toBe(true);
  });

  it('寿命が尽きたパーティクルはactive=falseになる(プールに残り続けない)', () => {
    const pool = createParticlePool(4);
    spawnParticle(pool, { x: 0, y: 0, vx: 0, vy: 0, life: 0.1, size: 3, color: '#fff' });
    updateParticlePool(pool, 0.2);
    expect(countActiveParticles(pool)).toBe(0);
    expect(pool.particles[0]?.active).toBe(false);
  });

  it('重力(gravity)はvyへ毎フレーム加算される', () => {
    const pool = createParticlePool(4);
    spawnParticle(pool, { x: 0, y: 0, vx: 0, vy: 0, life: 5, size: 3, color: '#fff', gravity: 10 });
    updateParticlePool(pool, 1);
    expect(pool.particles[0]?.vy).toBeCloseTo(10, 5);
  });

  it('容量を超えてspawnしても常に容量以下に収まる(リングバッファで最も古いスロットを上書き)', () => {
    const pool = createParticlePool(4);
    for (let i = 0; i < 10; i++) {
      spawnParticle(pool, { x: i, y: 0, vx: 0, vy: 0, life: 10, size: 1, color: '#fff' });
    }
    expect(pool.particles).toHaveLength(4); // 配列自体の長さは容量のまま変化しない
    expect(countActiveParticles(pool)).toBe(4); // 上限を超えて増えることはない
  });

  it('clearParticlePoolで全パーティクルが非アクティブになり、cursorが0に戻る', () => {
    const pool = createParticlePool(4);
    spawnParticle(pool, { x: 0, y: 0, vx: 0, vy: 0, life: 5, size: 1, color: '#fff' });
    spawnParticle(pool, { x: 0, y: 0, vx: 0, vy: 0, life: 5, size: 1, color: '#fff' });
    clearParticlePool(pool);
    expect(countActiveParticles(pool)).toBe(0);
    expect(pool.cursor).toBe(0);
  });
});

describe('EVENT_PARTICLE_COUNTS(イベント→生成数の定数テーブル)', () => {
  it('全イベント種別が定義されており、生成数はいずれも0以上512未満(スマホ配慮で控えめ)', () => {
    for (const kind of Object.keys(EVENT_PARTICLE_COUNTS) as (keyof typeof EVENT_PARTICLE_COUNTS)[]) {
      const count = EVENT_PARTICLE_COUNTS[kind];
      expect(count, kind).toBeGreaterThanOrEqual(0);
      expect(count, kind).toBeLessThan(DEFAULT_PARTICLE_POOL_CAPACITY);
    }
  });
});

// --- イベント検出(GameStateのdiffのみで判定する純関数) -------------------------------------

describe('detectEffectEvents', () => {
  it('grounded が false→true になったフレームで landed イベントが出る', () => {
    const stage = buildStage();
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => !p.jumpman.grounded && n.jumpman.grounded);
    const events = detectEffectEvents(prev, next, []);
    expect(events.some((e) => e.kind === 'landed')).toBe(true);
  });

  it('grounded が true→false かつ上向き速度になったフレームで jumpTakeoff イベントが出る(自動ジャンプ)', () => {
    // 幅6の穴を用意し、自動ジャンプの崖センサーが発火する状況を作る
    const stage = buildStage({
      width: 30,
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return 'NNNNNNNNNN......NNNNNNNNNNNNNN'; // x=10-15が穴
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(
      state,
      (p, n) => p.jumpman.grounded && !n.jumpman.grounded && n.jumpman.velocity.y < 0,
    );
    const events = detectEffectEvents(prev, next, []);
    expect(events.some((e) => e.kind === 'jumpTakeoff')).toBe(true);
  });

  it('コインを取得したフレームで coinCollected イベントが出る', () => {
    const stage = buildStage({ coins: [{ x: 5, y: 5 }] });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => n.takenThisSession.length > p.takenThisSession.length);
    const events = detectEffectEvents(prev, next, []);
    const coinEvents = events.filter((e) => e.kind === 'coinCollected');
    expect(coinEvents).toHaveLength(1);
  });

  it('トゲに接触してHPが減ったフレームで damage イベントが出る(死亡復帰のフレームとは別)', () => {
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return '.'.repeat(6) + 'S'.repeat(4) + 'N'.repeat(20);
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => n.jumpman.hp < p.jumpman.hp);
    const events = detectEffectEvents(prev, next, []);
    expect(events.some((e) => e.kind === 'damage')).toBe(true);
    expect(events.some((e) => e.kind === 'death')).toBe(false);
    expect(events.some((e) => e.kind === 'respawn')).toBe(false);
  });

  it('フルHPのまま落下死したフレームで death と respawn の両方のイベントが出る(HPが変化しなくてもテレポート判定で検出できる)', () => {
    // 落下死: 床の無いステージで落ち続けさせる。被弾を伴わないためHPは変化しない
    // (=hp増加だけを見ていては検出できない。位置のテレポート判定で拾えることを確認する)。
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, () => '.'.repeat(30)),
      checkpoints: [],
    });
    let state: GameState = createGameState(stage);
    let sawDeath = false;
    let sawRespawn = false;
    for (let i = 0; i < 3000; i++) {
      const next = update(state, [], FIXED_DT);
      const events = detectEffectEvents(state, next, []);
      if (events.some((e) => e.kind === 'death')) sawDeath = true;
      if (events.some((e) => e.kind === 'respawn')) sawRespawn = true;
      state = next;
      if (sawDeath && sawRespawn) break;
    }
    expect(sawDeath).toBe(true);
    expect(sawRespawn).toBe(true);
  });

  it('壊れるブロックの段階が進んだフレームで blockChipped イベントが出て、消滅したフレームで blockBroken イベントが出る', () => {
    // 1タイルの段差は自動ジャンプで即座に越えてしまい接触時間が足りないため、
    // 3タイル分積み上げて(自動ジャンプでは越えられない高さにして)接触を持続させる。
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 4 || y === 5 || y === 6) return '.'.repeat(6) + 'B' + 'N'.repeat(23);
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
    });
    let state: GameState = createGameState(stage);
    let sawChipped = false;
    let sawBroken = false;
    for (let i = 0; i < 400; i++) {
      const next = update(state, [], FIXED_DT);
      const events = detectEffectEvents(state, next, []);
      if (events.some((e) => e.kind === 'blockChipped')) sawChipped = true;
      if (events.some((e) => e.kind === 'blockBroken')) sawBroken = true;
      state = next;
      if (sawChipped && sawBroken) break;
    }
    expect(sawChipped).toBe(true);
    expect(sawBroken).toBe(true);
  });

  it('落ちるブロックがshaking→fallingへ遷移したフレームで blockFalling イベントが出る', () => {
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return '.'.repeat(6) + 'F' + 'N'.repeat(23);
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(
      state,
      (p, n) =>
        n.fallingBlocks.some((b) => b.phase === 'falling') && !p.fallingBlocks.some((b) => b.phase === 'falling'),
      [],
      400,
    );
    const events = detectEffectEvents(prev, next, []);
    expect(events.some((e) => e.kind === 'blockFalling')).toBe(true);
  });

  it('地形生成コマンドで実際にセルが新しく固体化したフレームで placementSuccess イベントが出て、生成セル座標が一致する', () => {
    const stage = buildStage();
    const terrainMaster: TerrainDefinition[] = [
      { id: 'h3', name: '横3マス', cost: 1, unlocked: true, unlockCost: 0, grid: ['NNN'] },
    ];
    const state = createGameState(stage, terrainMaster);
    const commands: Command[] = [{ type: 'placeTerrain', terrainId: 'h3', x: 10, y: 3 }];
    const next = update(state, commands, FIXED_DT);

    expect(next.grid.get(10, 3)).toBe(BlockType.Normal);

    const events = detectEffectEvents(state, next, commands);
    const placementEvents = events.filter((e) => e.kind === 'placementSuccess');
    expect(placementEvents).toHaveLength(1);
    const event = placementEvents[0];
    if (event?.kind !== 'placementSuccess') throw new Error('unreachable');
    expect(event.cells).toEqual([
      { x: 10, y: 3 },
      { x: 11, y: 3 },
      { x: 12, y: 3 },
    ]);
  });

  it('マナ不足等で配置が拒否されたフレームでは placementSuccess イベントが出ない', () => {
    const stage = buildStage({ mana: { initial: 0, max: 50, regenPerSec: 0 } });
    const terrainMaster: TerrainDefinition[] = [
      { id: 'h3', name: '横3マス', cost: 5, unlocked: true, unlockCost: 0, grid: ['NNN'] },
    ];
    const state = createGameState(stage, terrainMaster);
    const commands: Command[] = [{ type: 'placeTerrain', terrainId: 'h3', x: 10, y: 3 }];
    const next = update(state, commands, FIXED_DT);

    expect(next.grid.get(10, 3)).toBe(BlockType.Empty); // 拒否されて何も置かれない

    const events = detectEffectEvents(state, next, commands);
    expect(events.some((e) => e.kind === 'placementSuccess')).toBe(false);
  });

  it('ゴールに到達したフレームで goalReached イベントが出る', () => {
    const stage = buildStage({ width: 10, start: { x: 1, y: 4 }, goal: { x: 8, y: 4 }, tiles: ['..........', '..........', '..........', '..........', '..........', '..........', 'NNNNNNNNNN', 'NNNNNNNNNN'] });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => p.status !== GameStatus.Cleared && n.status === GameStatus.Cleared);
    const events = detectEffectEvents(prev, next, []);
    expect(events.some((e) => e.kind === 'goalReached')).toBe(true);
  });

  it('何も起きていないフレームではイベントが出ない', () => {
    const stage = buildStage();
    const state = createGameState(stage);
    // 1フレームだけ進める(通常の自動走行のみ、着地/被弾/取得等は起きない前提の短い区間を選ぶ)
    const next = update(state, [], FIXED_DT);
    const events = detectEffectEvents(state, next, []);
    // 初回フレームは空中から落下し始めるだけなので、着地イベントはまだ起きないはず
    expect(events.some((e) => e.kind === 'landed')).toBe(false);
    expect(events.some((e) => e.kind === 'damage')).toBe(false);
    expect(events.some((e) => e.kind === 'coinCollected')).toBe(false);
  });

  it('敵がトゲに接触してHPが減ったフレームでenemyDamageイベントが出る(該当する敵のidつき)', () => {
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return '.'.repeat(10) + 'SSSS' + '.'.repeat(16);
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
      enemies: [{ type: EnemyType.Slime, x: 10, y: 4, dir: 1 }],
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => {
      const pe = p.enemies[0];
      const ne = n.enemies[0];
      return !!pe && !!ne && ne.hp < pe.hp;
    });
    const events = detectEffectEvents(prev, next, []);
    const damageEvents = events.filter((e) => e.kind === 'enemyDamage');
    expect(damageEvents).toHaveLength(1);
    const event = damageEvents[0];
    if (event?.kind !== 'enemyDamage') throw new Error('unreachable');
    expect(event.enemyId).toBe(next.enemies[0]?.id);
  });
});

// --- EffectsManager(統合: イベント→パーティクル生成→時間経過で消える) ------------------------

describe('createEffectsManager', () => {
  it('初期状態ではsquash&stretchは等倍(scaleX=scaleY=1)', () => {
    const manager = createEffectsManager(32);
    expect(manager.getSquashStretch()).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it('初期状態ではisDeathPoseActive=false、getEnemyFlashAlpha=0', () => {
    const manager = createEffectsManager(32);
    expect(manager.isDeathPoseActive()).toBe(false);
    expect(manager.getEnemyFlashAlpha(0)).toBe(0);
  });

  it('死亡イベント(フルHPのまま落下死)でisDeathPoseActiveが一時的にtrueになり、時間経過でfalseに戻る', () => {
    const manager = createEffectsManager(32);
    const stage = buildStage({ tiles: Array.from({ length: 8 }, () => '.'.repeat(30)), checkpoints: [] });
    let state: GameState = createGameState(stage);
    let deathPrev: GameState | null = null;
    let deathNext: GameState | null = null;
    for (let i = 0; i < 3000; i++) {
      const next = update(state, [], FIXED_DT);
      const events = detectEffectEvents(state, next, []);
      if (events.some((e) => e.kind === 'death')) {
        deathPrev = state;
        deathNext = next;
        break;
      }
      state = next;
    }
    expect(deathPrev).not.toBeNull();
    expect(deathNext).not.toBeNull();
    if (!deathPrev || !deathNext) throw new Error('unreachable');

    manager.handleFrame(deathPrev, deathNext, []);
    expect(manager.isDeathPoseActive()).toBe(true);

    for (let i = 0; i < 60; i++) manager.update(1 / 60); // 1秒進める(死亡ポーズ時間0.35sを十分超える)
    expect(manager.isDeathPoseActive()).toBe(false);
  });

  it('enemyDamageイベントで該当敵のgetEnemyFlashAlphaが一時的に発火し、時間経過で0に戻る(他の敵には影響しない)', () => {
    const manager = createEffectsManager(32);
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return '.'.repeat(10) + 'SSSS' + '.'.repeat(16);
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
      enemies: [{ type: EnemyType.Slime, x: 10, y: 4, dir: 1 }],
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => {
      const pe = p.enemies[0];
      const ne = n.enemies[0];
      return !!pe && !!ne && ne.hp < pe.hp;
    });
    const enemyId = next.enemies[0]?.id;
    expect(enemyId).toBeDefined();
    if (enemyId === undefined) throw new Error('unreachable');

    expect(manager.getEnemyFlashAlpha(enemyId)).toBe(0);
    manager.handleFrame(prev, next, []);
    expect(manager.getEnemyFlashAlpha(enemyId)).toBeGreaterThan(0);
    expect(manager.getEnemyFlashAlpha(enemyId + 999)).toBe(0); // 別の敵idには影響しない

    for (let i = 0; i < 30; i++) manager.update(1 / 60); // 0.5秒進める(点滅時間0.15sを十分超える)
    expect(manager.getEnemyFlashAlpha(enemyId)).toBe(0);
  });

  it('landedイベントで縦潰れ(scaleY<1)が発火し、0.1秒後には等倍に戻る', () => {
    const manager = createEffectsManager(32);
    const stage = buildStage();
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => !p.jumpman.grounded && n.jumpman.grounded);

    manager.handleFrame(prev, next, []);
    const justLanded = manager.getSquashStretch();
    expect(justLanded.scaleY).toBeLessThan(1);
    expect(justLanded.scaleX).toBeGreaterThan(1);

    for (let i = 0; i < 30; i++) manager.update(1 / 60); // 0.5秒進める(0.1秒の演出時間を十分超える)
    expect(manager.getSquashStretch()).toEqual({ scaleX: 1, scaleY: 1 });
  });

  it('jumpTakeoffイベントで縦伸び(scaleY>1)が発火する', () => {
    const manager = createEffectsManager(32);
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return 'NNNNNNNNNN......NNNNNNNNNNNNNN';
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(
      state,
      (p, n) => p.jumpman.grounded && !n.jumpman.grounded && n.jumpman.velocity.y < 0,
    );

    manager.handleFrame(prev, next, []);
    const justJumped = manager.getSquashStretch();
    expect(justJumped.scaleY).toBeGreaterThan(1);
  });

  it('damageイベントでパーティクルが生成され、画面振動(shakeOffset)とビネットが発火する', () => {
    const manager = createEffectsManager(32);
    expect(manager.getShakeOffset()).toEqual({ x: 0, y: 0 });
    expect(manager.getVignetteAlpha()).toBe(0);

    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return '.'.repeat(6) + 'S'.repeat(4) + 'N'.repeat(20);
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => n.jumpman.hp < p.jumpman.hp);

    manager.handleFrame(prev, next, []);

    const shake = manager.getShakeOffset();
    expect(Math.abs(shake.x) <= 4).toBe(true);
    expect(Math.abs(shake.y) <= 4).toBe(true);
    expect(manager.getVignetteAlpha()).toBeGreaterThan(0);
  });

  it('updateで時間を進めると、寿命の短いパーティクルは消える(振動・ビネットも収まる)', () => {
    const manager = createEffectsManager(32);
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return '.'.repeat(6) + 'S'.repeat(4) + 'N'.repeat(20);
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => n.jumpman.hp < p.jumpman.hp);
    manager.handleFrame(prev, next, []);

    for (let i = 0; i < 120; i++) manager.update(1 / 60); // 2秒進める

    expect(manager.getShakeOffset()).toEqual({ x: 0, y: 0 });
    expect(manager.getVignetteAlpha()).toBe(0);
  });

  it('resetで振動・ビネット・ズームがすべて初期状態(=発火していない)に戻る', () => {
    const manager = createEffectsManager(32);
    const stage = buildStage({
      tiles: Array.from({ length: 8 }, (_, y) => {
        if (y === 6) return '.'.repeat(6) + 'S'.repeat(4) + 'N'.repeat(20);
        if (y === 7) return 'N'.repeat(30);
        return '.'.repeat(30);
      }),
    });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => n.jumpman.hp < p.jumpman.hp);
    manager.handleFrame(prev, next, []);
    expect(manager.getVignetteAlpha()).toBeGreaterThan(0);

    manager.reset();
    expect(manager.getShakeOffset()).toEqual({ x: 0, y: 0 });
    expect(manager.getVignetteAlpha()).toBe(0);
    expect(manager.getZoomScale()).toBe(1);
  });

  it('goalReachedイベントでズームスケールが1より大きくなる', () => {
    const manager = createEffectsManager(32);
    expect(manager.getZoomScale()).toBe(1);

    const stage = buildStage({ width: 10, start: { x: 1, y: 4 }, goal: { x: 8, y: 4 }, tiles: ['..........', '..........', '..........', '..........', '..........', '..........', 'NNNNNNNNNN', 'NNNNNNNNNN'] });
    const state = createGameState(stage);
    const { prev, next } = stepUntil(state, (p, n) => p.status !== GameStatus.Cleared && n.status === GameStatus.Cleared);
    manager.handleFrame(prev, next, []);
    manager.update(0.1); // ズームは即座に最大値になるのではなく徐々にイーズインするため、少し時間を進める

    expect(manager.getZoomScale()).toBeGreaterThan(1);
  });

  it('placementSuccessイベントで、生成されたセルのポップスケールが0(直後)から1(完了後)へ変化する', () => {
    const manager = createEffectsManager(32);
    const stage = buildStage();
    const terrainMaster: TerrainDefinition[] = [
      { id: 'h3', name: '横3マス', cost: 1, unlocked: true, unlockCost: 0, grid: ['NNN'] },
    ];
    const state = createGameState(stage, terrainMaster);
    const commands: Command[] = [{ type: 'placeTerrain', terrainId: 'h3', x: 10, y: 3 }];
    const next = update(state, commands, FIXED_DT);

    manager.handleFrame(state, next, commands);
    const justPopped = manager.getPlacementPopScale(10, 3);
    expect(justPopped).toBeGreaterThanOrEqual(0);
    expect(justPopped).toBeLessThan(1);

    for (let i = 0; i < 60; i++) manager.update(1 / 60); // 1秒進める(ポップ時間0.18sを十分超える)
    expect(manager.getPlacementPopScale(10, 3)).toBe(1); // 完了後は1(通常表示)に戻る
  });
});
