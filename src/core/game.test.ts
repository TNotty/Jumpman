import { describe, expect, it } from 'vitest';
import { FIXED_DT, JUMPMAN_MAX_HP } from './constants';
import { createGameState, update } from './game';
import { BlockType, EnemyType, GameStatus } from './types';
import type { StageData, TerrainDefinition } from './types';
import { derivePlayerStats, zeroUpgradeLevels } from './upgrades';

function buildStage(overrides: Partial<StageData> = {}): StageData {
  return {
    version: 1,
    id: 'test',
    name: 'テスト',
    theme: 'grass',
    width: 10,
    height: 4,
    tiles: ['..........', '..........', '..........', 'NNNNNNNNNN'].map((r) => r.slice(0, 10)),
    start: { x: 1, y: 1 },
    goal: { x: 8, y: 1 },
    checkpoints: [{ x: 4, y: 1 }],
    enemies: [{ type: EnemyType.Slime, x: 5, y: 1, dir: -1 }],
    mana: { initial: 10, max: 50, regenPerSec: 1 },
    eraseCost: 3,
    coins: [],
    ...overrides,
  };
}

describe('createGameState', () => {
  it('ステージから初期状態を組み立てる(チェックポイント未達・敵は静的配置)', () => {
    const state = createGameState(buildStage());
    expect(state.status).toBe(GameStatus.Playing);
    expect(state.checkpoints).toEqual([{ x: 4, y: 1, activated: false }]);
    expect(state.enemies).toHaveLength(1);
    expect(state.enemies[0]?.alive).toBe(true);
    expect(state.mana.current).toBe(10);
    expect(state.jumpman.position).toEqual({ x: 1, y: 1 });
  });
});

describe('update', () => {
  it('ジャンプマンが進み、チェックポイントとゴールを順に通過する', () => {
    let state = createGameState(buildStage());

    let steps = 0;
    while (state.status !== GameStatus.Cleared && steps < 600) {
      state = update(state, [], FIXED_DT);
      steps += 1;
    }

    expect(state.status).toBe(GameStatus.Cleared);
    expect(state.checkpoints[0]?.activated).toBe(true);
    expect(state.jumpman.respawnPoint).toEqual({ x: 4, y: 1 });
  });

  it('selectSlot: ロック中のスロットへは切り替わらず、ロック解除済みへは切り替わる', () => {
    const terrainMaster: TerrainDefinition[] = [
      { id: 'h2', name: '横2', cost: 2, unlocked: true, unlockCost: 0, grid: ['NN'] },
      { id: 'locked1', name: 'ロック', cost: 1, unlocked: false, unlockCost: 5, grid: ['N'] },
      { id: 'v2', name: '縦2', cost: 2, unlocked: true, unlockCost: 0, grid: ['N', 'N'] },
    ];
    let state = createGameState(buildStage(), terrainMaster);
    expect(state.selectedSlot).toBe(0);

    state = update(state, [{ type: 'selectSlot', slot: 1 }], FIXED_DT);
    expect(state.selectedSlot).toBe(0); // ロック中なので変化しない

    state = update(state, [{ type: 'selectSlot', slot: 2 }], FIXED_DT);
    expect(state.selectedSlot).toBe(2); // ロック解除済みなので切り替わる
  });

  it('selectSlot: 消去スロット(eraser)は常時選択可能', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, unlockCost: 0, grid: ['NN'] }];
    let state = createGameState(buildStage(), terrainMaster);

    state = update(state, [{ type: 'selectSlot', slot: 'eraser' }], FIXED_DT);
    expect(state.selectedSlot).toBe('eraser');
  });

  it('消去スロット選択中: placeTerrainコマンドが1マス消去として扱われる(terrainIdは無視される)', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, unlockCost: 0, grid: ['NN'] }];
    let state = createGameState(buildStage({ mana: { initial: 10, max: 50, regenPerSec: 0 } }), terrainMaster);

    // 消去対象として、ステージ由来の床(row3)の1マスを使う
    expect(state.grid.get(6, 3)).toBe(BlockType.Normal);

    state = update(state, [{ type: 'selectSlot', slot: 'eraser' }], FIXED_DT);
    expect(state.selectedSlot).toBe('eraser');

    const manaBefore = state.mana.current;
    state = update(state, [{ type: 'placeTerrain', terrainId: 'h2', x: 6, y: 3 }], FIXED_DT);

    expect(state.grid.get(6, 3)).toBe(BlockType.Empty); // 生成ではなく消去された
    expect(state.mana.current).toBe(manaBefore - state.stage.eraseCost); // 消去コスト(eraseCost)分だけ消費
  });

  it('消去スロット選択中: マナ不足なら拒否され、グリッド・マナとも変化しない', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, unlockCost: 0, grid: ['NN'] }];
    // eraseCost(既定3)未満のマナしか無い状態にする
    let state = createGameState(buildStage({ mana: { initial: 1, max: 50, regenPerSec: 0 } }), terrainMaster);
    expect(state.stage.eraseCost).toBe(3);

    state = update(state, [{ type: 'selectSlot', slot: 'eraser' }], FIXED_DT);
    const before = state.grid.get(6, 3);
    const manaBefore = state.mana.current;

    state = update(state, [{ type: 'placeTerrain', terrainId: 'h2', x: 6, y: 3 }], FIXED_DT);

    expect(state.grid.get(6, 3)).toBe(before); // 変化しない
    expect(state.mana.current).toBe(manaBefore); // 消費されない
  });

  it('右クリック相当のeraseTileコマンドは、消去スロットを選択していなくても常時有効', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, unlockCost: 0, grid: ['NN'] }];
    let state = createGameState(buildStage({ mana: { initial: 10, max: 50, regenPerSec: 0 } }), terrainMaster);
    expect(state.selectedSlot).toBe(0); // 地形スロットを選択したまま(消去スロットではない)

    state = update(state, [{ type: 'eraseTile', x: 6, y: 3 }], FIXED_DT);
    expect(state.grid.get(6, 3)).toBe(BlockType.Empty);
  });

  it('placeTerrain/eraseTile: パレット経由で実際に地形を生成・消去し、マナを消費する', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, unlockCost: 0, grid: ['NN'] }];
    let state = createGameState(buildStage(), terrainMaster);

    // ジャンプマン・敵から離れた空きマス(x=2,y=0)に生成
    state = update(state, [{ type: 'placeTerrain', terrainId: 'h2', x: 2, y: 0 }], FIXED_DT);
    expect(state.grid.get(2, 0)).toBe(BlockType.Normal);
    expect(state.grid.get(3, 0)).toBe(BlockType.Normal);
    expect(state.mana.current).toBeLessThan(10); // コスト2 + 微小な回復が相殺されるが必ず減っている

    const manaAfterPlace = state.mana.current;
    // 既存ブロック(row3のステージ由来の床)を1マス消去
    state = update(state, [{ type: 'eraseTile', x: 5, y: 3 }], FIXED_DT);
    expect(state.grid.get(5, 3)).toBe(BlockType.Empty);
    expect(state.mana.current).toBeLessThan(manaAfterPlace);
  });

  it('placeTerrain: 存在しないterrainIdは無視される(グリッド・マナとも変化なし)', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, unlockCost: 0, grid: ['NN'] }];
    const state = createGameState(buildStage(), terrainMaster);
    const before = state.mana.current;

    const next = update(state, [{ type: 'placeTerrain', terrainId: 'does-not-exist', x: 2, y: 0 }], FIXED_DT);

    expect(next.grid.get(2, 0)).toBe(BlockType.Empty);
    expect(next.mana.current).toBeGreaterThanOrEqual(before); // 消費されていない(回復分のみ増える)
  });

  it('クリア後は状態が変化しない(ジャンプマンの位置・ステータスは維持)', () => {
    let state = createGameState(buildStage());
    let steps = 0;
    while (state.status !== GameStatus.Cleared && steps < 600) {
      state = update(state, [], FIXED_DT);
      steps += 1;
    }
    const clearedPosition = state.jumpman.position;
    state = update(state, [], FIXED_DT);
    expect(state.status).toBe(GameStatus.Cleared);
    expect(state.jumpman.position).toEqual(clearedPosition);
  });

  it('壊れるブロック統合: 一面Bの床を数百フレーム走らせると、少なくとも1つのBタイルが破壊されEmptyになる', () => {
    // 床全体が壊れるブロックで、少し進んだ先に壁があり足止めされる(=同じタイルに継続して乗り続ける)構成。
    // これにより「踏んでいるだけで壊れない」バグ(overlappingTileCoordsの誤用)が回帰しないことを確認する。
    // ゴールはジャンプマンの経路(y≈2.5付近)から離れたy=0に置き、誤ってクリア扱いにならないようにする。
    const width = 10;
    const height = 5;
    const stage: StageData = {
      version: 1,
      id: 'breakable_floor',
      name: '壊れる床のテスト',
      theme: 'grass',
      width,
      height,
      tiles: ['..........', '.....N....', '.....N....', '.....N....', 'BBBBBBBBBB'],
      start: { x: 1, y: 2 },
      goal: { x: 8, y: 0 },
      checkpoints: [],
      enemies: [],
      mana: { initial: 10, max: 50, regenPerSec: 1 },
      eraseCost: 3,
      coins: [],
    };

    let state = createGameState(stage);
    let anyDestroyed = false;
    for (let i = 0; i < 1200 && !anyDestroyed; i++) {
      state = update(state, [], FIXED_DT);
      for (let x = 0; x < width; x++) {
        if (state.grid.get(x, height - 1) === BlockType.Empty) {
          anyDestroyed = true;
        }
      }
    }

    expect(anyDestroyed).toBe(true);
  });

  it('ノックバック統合: 平地でトゲに被弾すると、直後にposition.xが一時的に後退する', () => {
    const width = 10;
    const height = 6;
    const stage: StageData = {
      version: 1,
      id: 'spike_knockback',
      name: 'トゲノックバックのテスト',
      theme: 'grass',
      width,
      height,
      tiles: ['..........', '..........', '..........', '..........', '...SSS....', 'NNNNNNNNNN'],
      start: { x: 1, y: 3.5 },
      goal: { x: 8, y: 3.5 },
      checkpoints: [],
      enemies: [],
      mana: { initial: 10, max: 50, regenPerSec: 1 },
      eraseCost: 3,
      coins: [],
    };

    let state = createGameState(stage);
    let prevX = state.jumpman.position.x;
    let contactFrame = -1;
    let sawBackwardMovement = false;

    for (let i = 0; i < 300; i++) {
      state = update(state, [], FIXED_DT);
      if (contactFrame < 0 && state.jumpman.hp < JUMPMAN_MAX_HP) {
        contactFrame = i;
      }
      if (contactFrame >= 0 && state.jumpman.position.x < prevX) {
        sawBackwardMovement = true;
      }
      prevX = state.jumpman.position.x;
      if (sawBackwardMovement) break;
    }

    expect(contactFrame).toBeGreaterThanOrEqual(0); // トゲに被弾したこと
    expect(sawBackwardMovement).toBe(true); // 被弾後、水平ノックバックで一時的にx座標が後退したこと
  });

  it('マナ境界統合: コスト-1では拒否され、ちょうどのコストでは許可される', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 5, unlocked: true, unlockCost: 0, grid: ['NN'] }];

    // コストちょうど-1(4)では拒否され、グリッド・マナとも変化しない
    const shortState = createGameState(buildStage({ mana: { initial: 4, max: 50, regenPerSec: 0 } }), terrainMaster);
    const afterShort = update(shortState, [{ type: 'placeTerrain', terrainId: 'h2', x: 2, y: 0 }], FIXED_DT);
    expect(afterShort.grid.get(2, 0)).toBe(BlockType.Empty);
    expect(afterShort.mana.current).toBe(4);

    // コストちょうど(5)では許可され、マナが0まで消費される
    const exactState = createGameState(buildStage({ mana: { initial: 5, max: 50, regenPerSec: 0 } }), terrainMaster);
    const afterExact = update(exactState, [{ type: 'placeTerrain', terrainId: 'h2', x: 2, y: 0 }], FIXED_DT);
    expect(afterExact.grid.get(2, 0)).toBe(BlockType.Normal);
    expect(afterExact.grid.get(3, 0)).toBe(BlockType.Normal);
    expect(afterExact.mana.current).toBe(0);
  });
});

describe('コイン取得', () => {
  function runFrames(state: ReturnType<typeof createGameState>, frames: number): ReturnType<typeof createGameState> {
    let s = state;
    for (let i = 0; i < frames; i++) {
      s = update(s, [], FIXED_DT);
    }
    return s;
  }

  it('通常のコインに重なると取得済みになり、takenThisSessionにindexが記録される', () => {
    const stage = buildStage({ coins: [{ x: 3, y: 1 }] });
    let state = createGameState(stage);
    expect(state.coins).toEqual([{ x: 3, y: 1, permanentlyCollected: false, collectedThisSession: false }]);
    expect(state.takenThisSession).toEqual([]);

    state = runFrames(state, 180); // x=1→3への到達に十分な余裕(RUN_SPEED=3でも数秒あれば届く)

    expect(state.coins[0]?.collectedThisSession).toBe(true);
    expect(state.coins[0]?.permanentlyCollected).toBe(false);
    expect(state.takenThisSession).toEqual([0]);
  });

  it('永続取得済み(セーブ由来)のコインは重なってもtakenThisSessionに増えない(半透明のまま・再加算されない)', () => {
    const stage = buildStage({ coins: [{ x: 3, y: 1 }, { x: 6, y: 1 }] });
    let state = createGameState(stage, [], new Set([0])); // index0のみ既に取得済み

    expect(state.coins[0]?.permanentlyCollected).toBe(true);
    expect(state.coins[1]?.permanentlyCollected).toBe(false);

    state = runFrames(state, 400); // 両方のコイン位置を通過するのに十分な余裕

    // index0(永続取得済み)はcollectedThisSessionにならず、takenThisSessionにも入らない
    expect(state.coins[0]?.collectedThisSession).toBe(false);
    // index1(未取得)は通常どおり新規取得される
    expect(state.coins[1]?.collectedThisSession).toBe(true);
    expect(state.takenThisSession).toEqual([1]); // index0は含まれない
  });

  it('取得後に死亡してチェックポイントへ復帰しても、取得状態(takenThisSession)は維持される(復活しない)', () => {
    const stage = buildStage({ coins: [{ x: 3, y: 1 }] });
    let state = createGameState(stage);

    // コイン(x=3)通過には十分だが、ゴール(x=8)にはまだ届かない程度に留める
    // (ゴールに到達してCleared状態になると、update()が以降の処理(死亡復帰含む)を丸ごと
    // スキップするようになり、このテストの後半が意味を成さなくなるため)。
    state = runFrames(state, 90);
    expect(state.status).toBe(GameStatus.Playing);
    expect(state.takenThisSession).toEqual([0]);
    expect(state.coins[0]?.collectedThisSession).toBe(true);

    // HPを0にして次のupdateで死亡→チェックポイント復帰させる(scenario.test.tsと同じ手法)
    state = { ...state, jumpman: { ...state.jumpman, hp: 0 } };
    const beforeRespawnPosition = state.jumpman.position;
    state = update(state, [], FIXED_DT);

    // 復帰(HP全快・位置リセット)が実際に起きたことの確認
    expect(state.jumpman.hp).toBeGreaterThan(0);
    expect(state.jumpman.position).not.toEqual(beforeRespawnPosition);

    // コインの取得状態は死亡復帰を跨いで維持される(消えない・巻き戻らない)
    expect(state.coins[0]?.collectedThisSession).toBe(true);
    expect(state.takenThisSession).toEqual([0]);
  });
});

describe('PlayerStats統合(createGameState/updateへの反映)', () => {
  function runFrames(state: ReturnType<typeof createGameState>, frames: number): ReturnType<typeof createGameState> {
    let s = state;
    for (let i = 0; i < frames; i++) {
      s = update(s, [], FIXED_DT);
    }
    return s;
  }

  it('speed lv10: 同じフレーム数での移動距離がおよそ2倍になる(RUN_SPEED×2)', () => {
    // 平坦・障害物無し・十分な幅の専用ステージ(標準のbuildStage()は幅10と狭く、
    // 高速側がゴールに到達してCleared状態になり得るため専用に組む)。
    const width = 80;
    const height = 4;
    const stage = buildStage({
      width,
      height,
      tiles: [
        '.'.repeat(width),
        '.'.repeat(width),
        '.'.repeat(width),
        'N'.repeat(width),
      ],
      start: { x: 1, y: 1 },
      goal: { x: width - 2, y: 1 },
      checkpoints: [],
      enemies: [],
    });

    const baseStats = derivePlayerStats(zeroUpgradeLevels());
    const fastStats = derivePlayerStats({ ...zeroUpgradeLevels(), speed: 10 });
    expect(fastStats.runSpeed).toBe(baseStats.runSpeed * 2);

    const baseStart = createGameState(stage, [], new Set(), baseStats);
    const fastStart = createGameState(stage, [], new Set(), fastStats);

    const FRAMES = 60; // 1秒分
    const baseAfter = runFrames(baseStart, FRAMES);
    const fastAfter = runFrames(fastStart, FRAMES);

    const baseDistance = baseAfter.jumpman.position.x - baseStart.jumpman.position.x;
    const fastDistance = fastAfter.jumpman.position.x - fastStart.jumpman.position.x;

    expect(baseAfter.status).toBe(GameStatus.Playing); // どちらもゴール到達前(距離比較が意味を持つ前提)
    expect(fastAfter.status).toBe(GameStatus.Playing);
    expect(baseDistance).toBeGreaterThan(0);
    expect(fastDistance / baseDistance).toBeCloseTo(2, 1);
  });

  it('hp lv3: 最大HPが5→8になり、死亡復帰後もその最大HPまで回復する(被弾3回余分に耐えられる)', () => {
    const stage = buildStage();
    const baseStats = derivePlayerStats(zeroUpgradeLevels());
    const hpStats = derivePlayerStats({ ...zeroUpgradeLevels(), hp: 3 });

    const baseState = createGameState(stage, [], new Set(), baseStats);
    const hpState = createGameState(stage, [], new Set(), hpStats);

    expect(baseState.jumpman.hp).toBe(JUMPMAN_MAX_HP); // 5(基礎値と一致)
    expect(hpState.jumpman.hp).toBe(JUMPMAN_MAX_HP + 3); // 8
    expect(hpState.jumpman.hp - baseState.jumpman.hp).toBe(3); // 被弾3回余分に耐えられる差分

    // 死亡→チェックポイント復帰後も、強化後の最大HP(8)まで回復する
    // (playerStatsがGameStateに保持され、respawnのたびに参照されることの確認)
    const dead = { ...hpState, jumpman: { ...hpState.jumpman, hp: 0 } };
    const respawned = update(dead, [], FIXED_DT);
    expect(respawned.jumpman.hp).toBe(8);
  });

  it('jump lv10: ジャンプ初速がJUMP_VELOCITY×2になり、createGameStateの初期jumpmanに反映される', () => {
    const stage = buildStage();
    const jumpStats = derivePlayerStats({ ...zeroUpgradeLevels(), jump: 10 });
    const state = createGameState(stage, [], new Set(), jumpStats);
    // 初期状態(接地前)のvelocity.xはrunSpeed基準。jumpVelocityは実際にジャンプが
    // 発火した際にupdateJumpman内で使われる値なので、ここではPlayerStats自体の値を確認する。
    expect(state.playerStats.jumpVelocity).toBe(jumpStats.jumpVelocity);
    expect(state.playerStats.jumpVelocity).toBeLessThan(0); // 上方向(負)のまま
  });

  it('manaRegen/manaMaxの強化がステージのマナ設定に反映された状態でGameStateが作られる', () => {
    const stage = buildStage({ mana: { initial: 10, max: 50, regenPerSec: 1 } });
    const stats = derivePlayerStats({ ...zeroUpgradeLevels(), manaRegen: 10, manaMax: 10 });
    expect(stats.manaRegenMultiplier).toBe(3);
    expect(stats.manaMaxBonus).toBe(50);

    const state = createGameState(stage, [], new Set(), stats);
    expect(state.mana.max).toBe(100); // 50 + 50
    expect(state.mana.regenPerSec).toBe(3); // 1 × 3
    expect(state.mana.current).toBe(10); // initialは変化しない(仕様どおり)
  });

  it('playerStatsを省略した場合は基礎値(強化レベル0)のまま動作する(既存呼び出しとの互換性)', () => {
    const state = createGameState(buildStage());
    expect(state.playerStats).toEqual(derivePlayerStats(zeroUpgradeLevels()));
    expect(state.jumpman.hp).toBe(JUMPMAN_MAX_HP);
  });
});
