import { describe, expect, it } from 'vitest';
import { TileGrid } from './grid';
import { BlockType } from './types';

describe('TileGrid', () => {
  it('fromRows で文字凡例からBlockTypeへ変換する', () => {
    const grid = TileGrid.fromRows(['.NBS', 'F...']);
    expect(grid.width).toBe(4);
    expect(grid.height).toBe(2);
    expect(grid.get(0, 0)).toBe(BlockType.Empty);
    expect(grid.get(1, 0)).toBe(BlockType.Normal);
    expect(grid.get(2, 0)).toBe(BlockType.Breakable);
    expect(grid.get(3, 0)).toBe(BlockType.Spike);
    expect(grid.get(0, 1)).toBe(BlockType.Falling);
  });

  it('isSolid: 通常/壊れる/落ちるブロックはsolid、トゲ/空は非solid', () => {
    const grid = TileGrid.fromRows(['NBFS.']);
    expect(grid.isSolid(0, 0)).toBe(true);
    expect(grid.isSolid(1, 0)).toBe(true);
    expect(grid.isSolid(2, 0)).toBe(true);
    expect(grid.isSolid(3, 0)).toBe(false); // spike
    expect(grid.isSolid(4, 0)).toBe(false); // empty
  });

  it('範囲外の座標は常にEmpty/非solidを返す', () => {
    const grid = TileGrid.fromRows(['NN', 'NN']);
    expect(grid.get(-1, 0)).toBe(BlockType.Empty);
    expect(grid.get(0, -1)).toBe(BlockType.Empty);
    expect(grid.get(99, 0)).toBe(BlockType.Empty);
    expect(grid.isSolid(99, 99)).toBe(false);
  });

  it('set は範囲内のセルのみ更新する(範囲外は無視)', () => {
    const grid = new TileGrid(2, 2);
    grid.set(0, 0, BlockType.Normal);
    grid.set(99, 99, BlockType.Normal); // 無視されるはず
    expect(grid.get(0, 0)).toBe(BlockType.Normal);
  });
});
