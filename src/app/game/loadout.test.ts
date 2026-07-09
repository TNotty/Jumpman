import { describe, expect, it } from 'vitest';
import { resolveLoadoutPalette } from './loadout';
import { createGameState, update } from '../../core/game';
import { BlockType } from '../../core/types';
import type { TerrainDefinition } from '../../core/types';
import { FIXED_DT } from '../../core/constants';

const TERRAIN_MASTER: TerrainDefinition[] = [
  { id: 'h5', name: '横5マス', cost: 3, unlocked: true, unlockCost: 0, grid: ['NNNNN'] },
  { id: 'v3', name: '縦3マス', cost: 3, unlocked: true, unlockCost: 0, grid: ['N', 'N', 'N'] },
  { id: 'u', name: 'コの字', cost: 5, unlocked: true, unlockCost: 0, grid: ['NNN', 'N.N'] },
  { id: 'h3', name: '横3マス', cost: 2, unlocked: false, unlockCost: 2, grid: ['NNN'] },
];

describe('resolveLoadoutPalette', () => {
  it('地形IDをterrainMasterから解決し、同じ長さの配列を返す', () => {
    const loadout = ['h5', 'v3', 'u', null, null, null, null, null];
    const result = resolveLoadoutPalette(loadout, TERRAIN_MASTER);
    expect(result).toHaveLength(8);
    expect(result[0]).toEqual(TERRAIN_MASTER[0]);
    expect(result[1]).toEqual(TERRAIN_MASTER[1]);
    expect(result[2]).toEqual(TERRAIN_MASTER[2]);
  });

  it('nullのスロット(空枠)はnullのまま返す', () => {
    const loadout = ['h5', null, null, null, null, null, null, null];
    const result = resolveLoadoutPalette(loadout, TERRAIN_MASTER);
    expect(result[1]).toBeNull();
    expect(result[7]).toBeNull();
  });

  it('地形マスタに存在しないIDはnull(空枠扱い)にする(ID変更/削除後の後方互換)', () => {
    const loadout = ['does-not-exist', 'v3', null, null, null, null, null, null];
    const result = resolveLoadoutPalette(loadout, TERRAIN_MASTER);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual(TERRAIN_MASTER[1]);
  });

  it('unlockedTerrainIdsを渡さない/含まない場合、マスタ側unlocked:falseの地形はロックのまま解決される', () => {
    const loadout = ['h3', null, null, null, null, null, null, null];
    const result = resolveLoadoutPalette(loadout, TERRAIN_MASTER);
    expect(result[0]?.unlocked).toBe(false);
  });

  it('unlockedTerrainIdsに含まれる地形IDは、マスタ側がunlocked:falseでも解決結果ではunlocked:trueになる(コイン解放の反映)', () => {
    const loadout = ['h3', null, null, null, null, null, null, null];
    const result = resolveLoadoutPalette(loadout, TERRAIN_MASTER, ['h3']);
    expect(result[0]?.id).toBe('h3');
    expect(result[0]?.unlocked).toBe(true);
  });

  it('unlockedTerrainIdsに含まれないunlocked:false地形は、他のIDが解放されていてもロックのまま', () => {
    const loadout = ['h3', null, null, null, null, null, null, null];
    const result = resolveLoadoutPalette(loadout, TERRAIN_MASTER, ['does-not-matter']);
    expect(result[0]?.unlocked).toBe(false);
  });

  it('もともとunlocked:trueな地形は、unlockedTerrainIdsに関わらずunlocked:trueのまま', () => {
    const loadout = ['h5', null, null, null, null, null, null, null];
    const result = resolveLoadoutPalette(loadout, TERRAIN_MASTER, []);
    expect(result[0]?.unlocked).toBe(true);
  });

  it('空のloadoutは空配列を返す', () => {
    expect(resolveLoadoutPalette([], TERRAIN_MASTER)).toEqual([]);
  });
});

describe('resolveLoadoutPalette統合: コインで解放した地形が実際に選択・配置できる(update()経由)', () => {
  function buildStage() {
    return {
      version: 1 as const,
      id: 'test',
      name: 'テスト',
      theme: 'grass',
      width: 10,
      height: 4,
      tiles: ['..........', '..........', '..........', 'NNNNNNNNNN'],
      start: { x: 1, y: 1 },
      goal: { x: 8, y: 1 },
      checkpoints: [],
      enemies: [],
      mana: { initial: 10, max: 50, regenPerSec: 0 },
      eraseCost: 3,
      coins: [],
    };
  }

  it('unlockedTerrainIdsにマスタunlocked:falseの地形IDを含むセーブ→パレット解決→createGameState→selectSlot+placeTerrain→グリッドに配置される', () => {
    // h5(スロット0)はマスタ上から既に解放済み。h3(スロット1)はマスタ上ではunlocked:falseだが、
    // セーブ側でコイン解放済み(unlockedTerrainIds)扱いにする。selectedSlotの既定値0とは別の
    // スロット(1)を対象にすることで、selectSlotのロック判定ゲートも実質的に検証する。
    const loadout = ['h5', 'h3', null, null, null, null, null, null];
    const unlockedTerrainIds = ['h3'];
    const palette = resolveLoadoutPalette(loadout, TERRAIN_MASTER, unlockedTerrainIds);

    expect(palette[1]?.unlocked).toBe(true); // 解決後はunlocked:trueへ差し替わっている前提

    let state = createGameState(buildStage(), palette);
    expect(state.selectedSlot).toBe(0); // 既定はスロット0(h5)

    // スロット1(h3)を選択→ロック解除済みなので切り替わる
    state = update(state, [{ type: 'selectSlot', slot: 1 }], FIXED_DT);
    expect(state.selectedSlot).toBe(1);

    // ジャンプマン・敵から離れた空きマス(x=2,y=0)へ配置
    state = update(state, [{ type: 'placeTerrain', terrainId: 'h3', x: 2, y: 0 }], FIXED_DT);

    expect(state.grid.get(2, 0)).toBe(BlockType.Normal);
    expect(state.grid.get(3, 0)).toBe(BlockType.Normal);
    expect(state.grid.get(4, 0)).toBe(BlockType.Normal);
  });

  it('(回帰確認)unlockedTerrainIdsを渡さない旧来の呼び出しでは、マスタunlocked:falseの地形は選択・配置できないまま', () => {
    const loadout = ['h5', 'h3', null, null, null, null, null, null];
    const palette = resolveLoadoutPalette(loadout, TERRAIN_MASTER); // unlockedTerrainIds省略
    expect(palette[1]?.unlocked).toBe(false);

    let state = createGameState(buildStage(), palette);
    state = update(state, [{ type: 'selectSlot', slot: 1 }], FIXED_DT);
    expect(state.selectedSlot).toBe(0); // ロック中なので切り替わらず既定の0のまま

    state = update(state, [{ type: 'placeTerrain', terrainId: 'h3', x: 2, y: 0 }], FIXED_DT);
    expect(state.grid.get(2, 0)).toBe(BlockType.Empty); // ロック中のため配置されない
  });
});
