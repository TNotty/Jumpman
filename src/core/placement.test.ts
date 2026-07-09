import { describe, expect, it } from 'vitest';
import { TileGrid } from './grid';
import { anchoredBaseTileX, applyErase, applyPlacement, checkErase, checkPlacement, expandTerrainCells } from './placement';
import { BlockType, EnemyType } from './types';
import type { AABB, EnemyState, ManaState, TerrainDefinition } from './types';

const MANA: ManaState = { current: 10, max: 50, regenPerSec: 1 };
const JUMPMAN_AABB: AABB = { x: 0, y: 0, w: 0.6, h: 1.5 }; // グリッドから離れた位置(重ならない)

const H3: TerrainDefinition = { id: 'h3', name: '横3マス', cost: 3, unlocked: true, unlockCost: 0, grid: ['NNN'] };
const U_SHAPE: TerrainDefinition = { id: 'u', name: 'コの字', cost: 5, unlocked: true, unlockCost: 0, grid: ['NNN', 'N.N'] };
const LOCKED: TerrainDefinition = { id: 'locked', name: 'ロック中', cost: 1, unlocked: false, unlockCost: 5, grid: ['N'] };

function makeEnemy(x: number, y: number, alive = true): EnemyState {
  return {
    id: 0,
    type: EnemyType.Slime,
    x,
    y,
    dir: -1,
    velocity: { x: 0, y: 0 },
    hp: 2,
    alive,
    grounded: true,
    spawn: { type: EnemyType.Slime, x, y, dir: -1 },
  };
}

describe('expandTerrainCells', () => {
  it("'.'は形状に含めない(コの字の穴)", () => {
    const cells = expandTerrainCells(U_SHAPE, 10, 10);
    expect(cells).toHaveLength(5); // NNN + N.N の N は5個
    expect(cells.find((c) => c.x === 11 && c.y === 11)).toBeUndefined(); // 穴の位置
    expect(cells.every((c) => c.type === BlockType.Normal)).toBe(true);
  });
});

describe('anchoredBaseTileX', () => {
  it("'right'(指の右に生成): タップ位置がそのまま基準点(左端)になる。従来のマウスと同じ挙動", () => {
    expect(anchoredBaseTileX(20, 5, 'right')).toBe(20);
    expect(anchoredBaseTileX(20, 1, 'right')).toBe(20);
  });

  it("'left'(指の左に生成): 幅5の地形はタップ位置が右端になるよう基準点が4マス左にずれる", () => {
    expect(anchoredBaseTileX(20, 5, 'left')).toBe(16); // 16..20の5マス、右端が20(タップ位置)
  });

  it("幅1(消去スロット相当)は 'left'/'right' どちらでもオフセット0で同じ結果になる", () => {
    expect(anchoredBaseTileX(20, 1, 'left')).toBe(20);
    expect(anchoredBaseTileX(20, 1, 'right')).toBe(20);
  });

  it('グリッド左端付近など負の座標になり得る場合でもクランプせずそのまま返す(範囲外判定はplacement側に委ねる)', () => {
    expect(anchoredBaseTileX(2, 5, 'left')).toBe(-2);
  });

  it('地形幅が0(不正/未定義)でも最低幅1として扱いオフセット0になる', () => {
    expect(anchoredBaseTileX(20, 0, 'left')).toBe(20);
  });
});

describe('checkPlacement', () => {
  it('通常配置は許可され、cellsToPlaceに形状全体が含まれる', () => {
    const grid = new TileGrid(20, 20);
    const result = checkPlacement(grid, H3, 10, 10, JUMPMAN_AABB, [], MANA);
    expect(result.ok).toBe(true);
    expect(result.cellsToPlace).toHaveLength(3);
  });

  it('ジャンプマンと重なるセルを含む配置は拒否される', () => {
    const grid = new TileGrid(20, 20);
    const aabb: AABB = { x: 10, y: 10, w: 0.6, h: 1.5 };
    const result = checkPlacement(grid, H3, 10, 10, aabb, [], MANA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('blocked_by_entity');
    expect(result.cellsToPlace).toHaveLength(0);
  });

  it('生存中の敵と重なるセルを含む配置は拒否されるが、死亡済みの敵とは重なってもよい', () => {
    const grid = new TileGrid(20, 20);
    const aliveEnemy = makeEnemy(10, 10, true);
    const rejected = checkPlacement(grid, H3, 10, 10, JUMPMAN_AABB, [aliveEnemy], MANA);
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('blocked_by_entity');

    const deadEnemy = makeEnemy(10, 10, false);
    const accepted = checkPlacement(grid, H3, 10, 10, JUMPMAN_AABB, [deadEnemy], MANA);
    expect(accepted.ok).toBe(true);
  });

  it('既存ブロックと重なるセルはスキップされるが、配置自体は許可されコスト満額扱いになる', () => {
    const grid = new TileGrid(20, 20);
    grid.set(11, 10, BlockType.Normal); // H3(10,10)-(12,10)の中央セルに既存ブロック
    const result = checkPlacement(grid, H3, 10, 10, JUMPMAN_AABB, [], MANA);
    expect(result.ok).toBe(true);
    expect(result.cellsToPlace).toHaveLength(2); // 中央セルはスキップ
    expect(result.cellsToPlace.some((c) => c.x === 11 && c.y === 10)).toBe(false);
  });

  it('マナ不足なら拒否される', () => {
    const grid = new TileGrid(20, 20);
    const poorMana: ManaState = { current: 1, max: 50, regenPerSec: 1 };
    const result = checkPlacement(grid, H3, 10, 10, JUMPMAN_AABB, [], poorMana);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_mana');
  });

  it('ロック中の地形は拒否される', () => {
    const grid = new TileGrid(20, 20);
    const result = checkPlacement(grid, LOCKED, 10, 10, JUMPMAN_AABB, [], MANA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('locked');
  });

  it('全セルが既存ブロック上(実効セル0)なら no_effect で拒否される(コストは徴収されない)', () => {
    const grid = new TileGrid(20, 20);
    grid.set(10, 10, BlockType.Normal);
    grid.set(11, 10, BlockType.Normal);
    grid.set(12, 10, BlockType.Normal); // H3の3マスすべてに既存ブロック
    const result = checkPlacement(grid, H3, 10, 10, JUMPMAN_AABB, [], MANA);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_effect');
    expect(result.cellsToPlace).toHaveLength(0);
  });

  it('全セルが範囲外(実効セル0)なら no_effect で拒否される', () => {
    const grid = new TileGrid(20, 20);
    const result = checkPlacement(grid, H3, 100, 100, JUMPMAN_AABB, [], MANA); // グリッド外
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_effect');
    expect(result.cellsToPlace).toHaveLength(0);
  });

  it('一部のセルだけが成立する場合(部分スキップ)は従来どおり許可される(回帰確認)', () => {
    const grid = new TileGrid(20, 20);
    grid.set(11, 10, BlockType.Normal); // 中央セルのみ既存ブロック
    const result = checkPlacement(grid, H3, 10, 10, JUMPMAN_AABB, [], MANA);
    expect(result.ok).toBe(true);
    expect(result.cellsToPlace).toHaveLength(2);
  });
});

describe('applyPlacement', () => {
  it('cellsToPlaceの内容をグリッドに書き込んだ新しいグリッドを返す(元は変更しない)', () => {
    const grid = new TileGrid(20, 20);
    const result = checkPlacement(grid, H3, 10, 10, JUMPMAN_AABB, [], MANA);
    const next = applyPlacement(grid, result.cellsToPlace);

    expect(grid.get(10, 10)).toBe(BlockType.Empty); // 元のグリッドは不変
    expect(next.get(10, 10)).toBe(BlockType.Normal);
    expect(next.get(11, 10)).toBe(BlockType.Normal);
    expect(next.get(12, 10)).toBe(BlockType.Normal);
  });
});

describe('checkErase / applyErase', () => {
  it('既存ブロック(ステージ由来含む)は消去できる', () => {
    const grid = new TileGrid(20, 20);
    grid.set(5, 5, BlockType.Normal);
    const result = checkErase(grid, 5, 5, MANA, 3);
    expect(result.ok).toBe(true);
    const next = applyErase(grid, 5, 5);
    expect(next.get(5, 5)).toBe(BlockType.Empty);
    expect(grid.get(5, 5)).toBe(BlockType.Normal); // 元は不変
  });

  it('空マスの消去は no_effect', () => {
    const grid = new TileGrid(20, 20);
    const result = checkErase(grid, 5, 5, MANA, 3);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_effect');
  });

  it('マナ不足なら insufficient_mana', () => {
    const grid = new TileGrid(20, 20);
    grid.set(5, 5, BlockType.Normal);
    const poorMana: ManaState = { current: 1, max: 50, regenPerSec: 1 };
    const result = checkErase(grid, 5, 5, poorMana, 3);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_mana');
  });

  it('範囲外は out_of_grid', () => {
    const grid = new TileGrid(20, 20);
    const result = checkErase(grid, 99, 99, MANA, 3);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('out_of_grid');
  });
});
