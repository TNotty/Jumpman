import { describe, expect, it } from 'vitest';
import { FIXED_DT, JUMPMAN_MAX_HP } from './constants';
import { createGameState, update } from './game';
import { BlockType, EnemyType, GameStatus } from './types';
import type { StageData, TerrainDefinition } from './types';

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
      { id: 'h2', name: '横2', cost: 2, unlocked: true, grid: ['NN'] },
      { id: 'locked1', name: 'ロック', cost: 1, unlocked: false, grid: ['N'] },
      { id: 'v2', name: '縦2', cost: 2, unlocked: true, grid: ['N', 'N'] },
    ];
    let state = createGameState(buildStage(), terrainMaster);
    expect(state.selectedSlot).toBe(0);

    state = update(state, [{ type: 'selectSlot', slot: 1 }], FIXED_DT);
    expect(state.selectedSlot).toBe(0); // ロック中なので変化しない

    state = update(state, [{ type: 'selectSlot', slot: 2 }], FIXED_DT);
    expect(state.selectedSlot).toBe(2); // ロック解除済みなので切り替わる
  });

  it('selectSlot: 消去スロット(eraser)は常時選択可能', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, grid: ['NN'] }];
    let state = createGameState(buildStage(), terrainMaster);

    state = update(state, [{ type: 'selectSlot', slot: 'eraser' }], FIXED_DT);
    expect(state.selectedSlot).toBe('eraser');
  });

  it('消去スロット選択中: placeTerrainコマンドが1マス消去として扱われる(terrainIdは無視される)', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, grid: ['NN'] }];
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
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, grid: ['NN'] }];
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
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, grid: ['NN'] }];
    let state = createGameState(buildStage({ mana: { initial: 10, max: 50, regenPerSec: 0 } }), terrainMaster);
    expect(state.selectedSlot).toBe(0); // 地形スロットを選択したまま(消去スロットではない)

    state = update(state, [{ type: 'eraseTile', x: 6, y: 3 }], FIXED_DT);
    expect(state.grid.get(6, 3)).toBe(BlockType.Empty);
  });

  it('placeTerrain/eraseTile: パレット経由で実際に地形を生成・消去し、マナを消費する', () => {
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, grid: ['NN'] }];
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
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 2, unlocked: true, grid: ['NN'] }];
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
    const terrainMaster: TerrainDefinition[] = [{ id: 'h2', name: '横2', cost: 5, unlocked: true, grid: ['NN'] }];

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
