import { describe, expect, it } from 'vitest';
import { TileGrid } from '../core/grid';
import { BlockType } from '../core/types';
import { coinRenderState, computeTileEdgeFlags } from './renderer';

describe('computeTileEdgeFlags(オートタイリングの隣接判定)', () => {
  function buildGrid(rows: string[]): TileGrid {
    // 'N'=Normal(固体), 'B'=Breakable(固体), '.'=Empty(非固体)
    const grid = new TileGrid(rows[0]?.length ?? 0, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const char = row[x];
        if (char === 'N') grid.set(x, y, BlockType.Normal);
        else if (char === 'B') grid.set(x, y, BlockType.Breakable);
      }
    });
    return grid;
  }

  it('四方すべて固体に囲まれている場合、全エッジがfalse(閉じている)', () => {
    const grid = buildGrid(['NNN', 'NNN', 'NNN']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: false,
      bottomOpen: false,
      leftOpen: false,
      rightOpen: false,
    });
  });

  it('上だけ空いている(床の表面)場合、topOpenのみtrue', () => {
    const grid = buildGrid(['...', 'NNN', 'NNN']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: true,
      bottomOpen: false,
      leftOpen: false,
      rightOpen: false,
    });
  });

  it('上+左が空いている(左上の角)場合、topOpenとleftOpenがtrue', () => {
    const grid = buildGrid(['...', '.NN', '.NN']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: true,
      bottomOpen: false,
      leftOpen: true,
      rightOpen: false,
    });
  });

  it('上+右が空いている(右上の角)場合、topOpenとrightOpenがtrue', () => {
    const grid = buildGrid(['...', 'NN.', 'NN.']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: true,
      bottomOpen: false,
      leftOpen: false,
      rightOpen: true,
    });
  });

  it('下だけ空いている(浮遊ブロックの底面)場合、bottomOpenのみtrue', () => {
    const grid = buildGrid(['NNN', 'NNN', '...']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: false,
      bottomOpen: true,
      leftOpen: false,
      rightOpen: false,
    });
  });

  it('グリッド範囲外は非固体(Empty)扱いなので、マップ端は開いている扱いになる', () => {
    const grid = buildGrid(['NNN', 'NNN', 'NNN']);
    // x=0はマップの左端。左隣(x=-1)は範囲外=Empty扱いでleftOpen=trueになる
    expect(computeTileEdgeFlags(grid, 0, 1).leftOpen).toBe(true);
  });

  it('隣接セルが通常ブロック以外の固体(壊れるブロック等)でも「閉じている」扱いになる', () => {
    const grid = buildGrid(['BBB', 'BNB', 'BBB']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: false,
      bottomOpen: false,
      leftOpen: false,
      rightOpen: false,
    });
  });
});

describe('coinRenderState', () => {
  it('permanentlyCollected(再訪時点で既に取得済み)は半透明(dim)になる', () => {
    expect(coinRenderState({ permanentlyCollected: true, collectedThisSession: false })).toBe('dim');
  });

  it('collectedThisSession(今回のセッションで新規取得)は非描画(hidden、即座に消える)になる', () => {
    expect(coinRenderState({ permanentlyCollected: false, collectedThisSession: true })).toBe('hidden');
  });

  it('未取得は通常表示(normal)になる', () => {
    expect(coinRenderState({ permanentlyCollected: false, collectedThisSession: false })).toBe('normal');
  });

  it('permanentlyCollectedが優先される(理論上両方trueになることは無いが、念のため)', () => {
    expect(coinRenderState({ permanentlyCollected: true, collectedThisSession: true })).toBe('dim');
  });
});
