import { describe, expect, it } from 'vitest';
import {
  MAX_TERRAIN_COUNT,
  addTerrain,
  createBlankTerrainMaster,
  getTerrainCell,
  moveTerrain,
  removeTerrain,
  resizeTerrainGrid,
  setTerrainCell,
  toTerrainMaster,
  updateTerrainMeta,
} from './terrainDraft';
import { validateTerrainMaster } from '../../data/schema';
import { BlockType } from '../../core/types';

describe('addTerrain / removeTerrain', () => {
  it('末尾に追加し、8枠上限で頭打ちになる', () => {
    let master = createBlankTerrainMaster();
    for (let i = 0; i < 10; i++) {
      master = addTerrain(master);
    }
    expect(master.terrains).toHaveLength(MAX_TERRAIN_COUNT);
  });

  it('追加した地形のidは重複しない', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = addTerrain(master);
    const ids = master.terrains.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('指定indexを削除する。範囲外は変化なし', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = addTerrain(master);
    const idToKeep = master.terrains[1]?.id;

    master = removeTerrain(master, 0);
    expect(master.terrains).toHaveLength(1);
    expect(master.terrains[0]?.id).toBe(idToKeep);

    const unchanged = removeTerrain(master, 99);
    expect(unchanged).toBe(master);
  });
});

describe('moveTerrain', () => {
  it('隣と入れ替える。境界では変化なし', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = addTerrain(master);
    master = addTerrain(master);
    const ids = master.terrains.map((t) => t.id);

    const moved = moveTerrain(master, 0, 1);
    expect(moved.terrains.map((t) => t.id)).toEqual([ids[1], ids[0], ids[2]]);

    const atTop = moveTerrain(master, 0, -1);
    expect(atTop).toBe(master); // 先頭より上には動かせない

    const atBottom = moveTerrain(master, 2, 1);
    expect(atBottom).toBe(master); // 末尾より下には動かせない
  });
});

describe('updateTerrainMeta', () => {
  it('名前・コスト・解放フラグを部分更新する', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = updateTerrainMeta(master, 0, { name: '橋', cost: 5, unlocked: false });
    expect(master.terrains[0]?.name).toBe('橋');
    expect(master.terrains[0]?.cost).toBe(5);
    expect(master.terrains[0]?.unlocked).toBe(false);
  });
});

describe('resizeTerrainGrid / setTerrainCell / getTerrainCell', () => {
  it('セルを設定・取得できる', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = resizeTerrainGrid(master, 0, 3, 3);
    master = setTerrainCell(master, 0, 1, 1, BlockType.Spike);
    const terrain = master.terrains[0];
    expect(terrain).toBeDefined();
    if (!terrain) return;
    expect(getTerrainCell(terrain, 1, 1)).toBe(BlockType.Spike);
    expect(terrain.grid).toHaveLength(3);
    expect(terrain.grid.every((row) => row.length === 3)).toBe(true);
  });

  it('8×8を超えるサイズにはclampされる', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = resizeTerrainGrid(master, 0, 20, 20);
    const terrain = master.terrains[0];
    expect(terrain?.grid).toHaveLength(8);
    expect(terrain?.grid[0]).toHaveLength(8);
  });

  it('縮小しても既存の内容(左上基準)は保持される', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = resizeTerrainGrid(master, 0, 5, 5);
    master = setTerrainCell(master, 0, 0, 0, BlockType.Normal);
    master = resizeTerrainGrid(master, 0, 2, 2);
    const terrain = master.terrains[0];
    expect(terrain).toBeDefined();
    if (!terrain) return;
    expect(getTerrainCell(terrain, 0, 0)).toBe(BlockType.Normal);
  });
});

describe('toTerrainMaster', () => {
  it('妥当なマスタは validateTerrainMaster を通る(スキーマ往復)', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = updateTerrainMeta(master, 0, { name: '橋', cost: 3, unlocked: true });

    const result = toTerrainMaster(master);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) return;

    const revalidated = validateTerrainMaster(result.value);
    expect(revalidated.ok).toBe(true);
  });

  it('不正なデータ(コストが負)はエラーになる', () => {
    let master = createBlankTerrainMaster();
    master = addTerrain(master);
    master = updateTerrainMeta(master, 0, { cost: -1 });

    const result = toTerrainMaster(master);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
