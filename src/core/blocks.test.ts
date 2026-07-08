import { describe, expect, it } from 'vitest';
import { TileGrid } from './grid';
import {
  EMPTY_BREAKABLE_DAMAGE,
  breakableSpriteStage,
  pruneBreakableDamage,
  triggerFallingBlocks,
  updateBreakableContacts,
  updateFallingBlocks,
} from './blocks';
import type { FallingBlockState } from './blocks';
import { BlockType } from './types';
import type { AABB } from './types';
import { GRAVITY, MAX_FALL_SPEED } from './constants';

const DT = 1 / 60;

describe('壊れるブロック', () => {
  it('接触し続けると2段階の見た目変化を経て消滅する(実際の物理と同じ「乗っているだけで重ならない」AABBで検証)', () => {
    const grid = new TileGrid(4, 4);
    grid.set(1, 1, BlockType.Breakable);

    let currentGrid = grid;
    let damage = EMPTY_BREAKABLE_DAMAGE;
    // 壊れるブロックはsolidなので、衝突解決後のAABBは(1,1)の上端(y=1)に接するだけで重ならない。
    // stepBodyが実際に返す着地位置と同じ形(x:1, y:0, h:1 → 下端がちょうど1.0)を使う。
    const contact: AABB[] = [{ x: 1, y: 0, w: 1, h: 1 }];

    expect(breakableSpriteStage(damage, 1, 1)).toBe(1);

    let sawStage2 = false;
    let sawStage3 = false;
    let destroyed = false;

    for (let i = 0; i < 200; i++) {
      const result = updateBreakableContacts(currentGrid, damage, contact, DT);
      currentGrid = result.grid;
      damage = result.damage;

      if (currentGrid.get(1, 1) === BlockType.Empty) {
        destroyed = true;
        break;
      }
      const stage = breakableSpriteStage(damage, 1, 1);
      if (stage === 2) sawStage2 = true;
      if (stage === 3) sawStage3 = true;
    }

    expect(sawStage2).toBe(true);
    expect(sawStage3).toBe(true);
    expect(destroyed).toBe(true);
  });

  it('横から接している(壁のように押し当てている)だけでも蓄積が進む', () => {
    const grid = new TileGrid(4, 4);
    grid.set(2, 1, BlockType.Breakable);
    // (2,1)の左隣に接しているAABB(重ならない): 右端がちょうど x=2
    const contact: AABB[] = [{ x: 1, y: 1, w: 1, h: 1 }];

    const result = updateBreakableContacts(grid, EMPTY_BREAKABLE_DAMAGE, contact, DT);
    expect(result.damage.get('2,1')).toBeCloseTo(DT, 10);
  });

  it('離れているタイルはダメージが蓄積しない(同一参照を返す)', () => {
    const grid = new TileGrid(4, 4);
    grid.set(1, 1, BlockType.Breakable);
    const farAway: AABB = { x: 3, y: 3, w: 1, h: 1 };
    const result = updateBreakableContacts(grid, EMPTY_BREAKABLE_DAMAGE, [farAway], DT);
    expect(result.grid).toBe(grid);
    expect(result.damage).toBe(EMPTY_BREAKABLE_DAMAGE);
  });

  it('接触AABBが1つも無ければダメージが蓄積しない(同一参照を返す)', () => {
    const grid = new TileGrid(4, 4);
    grid.set(1, 1, BlockType.Breakable);
    const result = updateBreakableContacts(grid, EMPTY_BREAKABLE_DAMAGE, [], DT);
    expect(result.grid).toBe(grid);
    expect(result.damage).toBe(EMPTY_BREAKABLE_DAMAGE);
  });

  it('pruneBreakableDamage: グリッド上でBreakableでなくなったタイルのエントリを削除する', () => {
    const grid = new TileGrid(4, 4); // (1,1)はEmpty=破壊済み想定
    const damage = new Map([['1,1', 0.5]]);
    const pruned = pruneBreakableDamage(grid, damage);
    expect(pruned.has('1,1')).toBe(false);
  });
});

describe('落ちるブロック', () => {
  it('乗られると震え(shaking)を経て落下エンティティ化し、元のグリッドからは消える', () => {
    const grid = new TileGrid(4, 4);
    grid.set(1, 1, BlockType.Falling);
    const stander: AABB = { x: 1, y: 0, w: 1, h: 1 }; // (1,1)の上に立っている

    let blocks = triggerFallingBlocks(grid, [], [stander]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.phase).toBe('shaking');

    let currentGrid = grid;
    let becameFalling = false;
    for (let i = 0; i < 60; i++) {
      const result = updateFallingBlocks(currentGrid, blocks, GRAVITY, MAX_FALL_SPEED, DT, 4);
      currentGrid = result.grid;
      blocks = result.blocks;
      if (blocks[0]?.phase === 'falling') {
        becameFalling = true;
        break;
      }
    }

    expect(becameFalling).toBe(true);
    expect(currentGrid.get(1, 1)).toBe(BlockType.Empty);
  });

  it('画面外まで落下すると消滅する(リストから除外される)', () => {
    const grid = new TileGrid(4, 20);
    let blocks: FallingBlockState[] = [{ id: 'x', x: 1, y: 1, phase: 'falling', timer: 0, velocity: { x: 0, y: 0 } }];
    let currentGrid = grid;
    let gone = false;
    for (let i = 0; i < 600; i++) {
      const result = updateFallingBlocks(currentGrid, blocks, GRAVITY, MAX_FALL_SPEED, DT, 10);
      currentGrid = result.grid;
      blocks = result.blocks;
      if (blocks.length === 0) {
        gone = true;
        break;
      }
    }
    expect(gone).toBe(true);
  });

  it('同じ発生源タイルは、既にアクティブなら再トリガーしない', () => {
    const grid = new TileGrid(4, 4);
    grid.set(1, 1, BlockType.Falling);
    const stander: AABB = { x: 1, y: 0, w: 1, h: 1 };
    const first = triggerFallingBlocks(grid, [], [stander]);
    const second = triggerFallingBlocks(grid, first, [stander]);
    expect(second).toHaveLength(1);
  });
});
