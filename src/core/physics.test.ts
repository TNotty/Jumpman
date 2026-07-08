import { describe, expect, it } from 'vitest';
import { TileGrid } from './grid';
import { stepBody } from './physics';
import { BlockType } from './types';
import { FIXED_DT, GRAVITY, MAX_FALL_SPEED } from './constants';

describe('physics.stepBody', () => {
  it('落下: 床の上で停止する(接地・速度ゼロになる)', () => {
    const grid = new TileGrid(3, 10);
    for (let x = 0; x < 3; x++) {
      grid.set(x, 5, BlockType.Normal);
    }

    let position = { x: 1, y: 0 };
    let velocity = { x: 0, y: 0 };
    let grounded = false;

    for (let i = 0; i < 120; i++) {
      const result = stepBody(
        grid,
        { x: position.x, y: position.y, w: 1, h: 1 },
        velocity,
        GRAVITY,
        MAX_FALL_SPEED,
        FIXED_DT,
      );
      position = result.position;
      velocity = result.velocity;
      grounded = result.grounded;
    }

    expect(grounded).toBe(true);
    expect(position.y).toBeCloseTo(4, 5); // 床(row5)の上端=5、高さ1なので4に着地
    expect(velocity.y).toBe(0);
  });

  it('壁: 水平移動が壁で停止する(貫通しない)', () => {
    const grid = new TileGrid(6, 3);
    for (let y = 0; y < 3; y++) {
      grid.set(3, y, BlockType.Normal); // x=3 に縦の壁
    }

    let position = { x: 1, y: 1 };
    let velocity = { x: 6, y: 0 };
    let hitWall = false;

    for (let i = 0; i < 60; i++) {
      const result = stepBody(
        grid,
        { x: position.x, y: position.y, w: 1, h: 1 },
        velocity,
        0, // 重力なしでX軸のみ検証
        MAX_FALL_SPEED,
        FIXED_DT,
      );
      position = result.position;
      velocity = result.velocity;
      if (result.hitWall) hitWall = true;
    }

    expect(hitWall).toBe(true);
    expect(position.x).toBeCloseTo(2, 5); // 壁(x=3)の手前、幅1なので2で停止
    expect(velocity.x).toBe(0);
    expect(position.x).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('頭打ち: 上昇が天井で停止する', () => {
    const grid = new TileGrid(3, 5);
    for (let x = 0; x < 3; x++) {
      grid.set(x, 1, BlockType.Normal); // row1 が天井
    }

    // 天井(row1)の下端=2 に頭がぶつかるまでの間、複数ステップ回して確認
    let position = { x: 1, y: 3 };
    let velocity = { x: 0, y: -17 };
    let hitCeiling = false;
    for (let i = 0; i < 30; i++) {
      const step = stepBody(grid, { x: position.x, y: position.y, w: 1, h: 1 }, velocity, 0, MAX_FALL_SPEED, FIXED_DT);
      position = step.position;
      velocity = step.velocity;
      if (step.hitCeiling) hitCeiling = true;
      if (step.hitCeiling) break;
    }

    expect(hitCeiling).toBe(true);
    expect(position.y).toBeCloseTo(2, 5); // 天井(row1)の下端=2で停止
    expect(velocity.y).toBe(0);
  });

  it('トンネリングなし: 最大落下速度でも1タイル分の床を貫通しない', () => {
    const grid = new TileGrid(3, 10);
    for (let x = 0; x < 3; x++) {
      grid.set(x, 5, BlockType.Normal); // 1タイル厚の床
    }

    // 着地位置(y=4、床row5の上端5から高さ1を引いた値)の半歩手前まで最大落下速度で接近している状況を再現
    const closeAbove = 4 - MAX_FALL_SPEED * FIXED_DT * 0.5;
    const result = stepBody(
      grid,
      { x: 1, y: closeAbove, w: 1, h: 1 },
      { x: 0, y: MAX_FALL_SPEED },
      GRAVITY,
      MAX_FALL_SPEED,
      FIXED_DT,
    );

    expect(result.position.y).toBeCloseTo(4, 5); // 床の上(row5の上端=5、高さ1なので4)で止まる
    expect(result.position.y).toBeLessThanOrEqual(4 + 1e-6);
    expect(result.grounded).toBe(true);
  });
});
