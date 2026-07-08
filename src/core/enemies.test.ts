import { describe, expect, it } from 'vitest';
import { TileGrid } from './grid';
import { createEnemyState, resetEnemy, updateEnemy } from './enemies';
import { BlockType, EnemyType } from './types';

const DT = 1 / 60;

describe('スライム: 壁反転・崖から落ちる', () => {
  it('壁に当たったら反転する', () => {
    const grid = new TileGrid(8, 3);
    for (let x = 0; x < 8; x++) grid.set(x, 2, BlockType.Normal); // 床
    for (let y = 0; y <= 2; y++) grid.set(5, y, BlockType.Normal); // x=5 に壁

    let enemy = createEnemyState({ type: EnemyType.Slime, x: 1, y: 1, dir: 1 }, 0);
    let flipped = false;
    for (let i = 0; i < 300 && !flipped; i++) {
      enemy = updateEnemy(enemy, grid, DT);
      if (enemy.dir === -1) flipped = true;
    }

    expect(flipped).toBe(true);
    expect(enemy.dir).toBe(-1);
  });

  it('崖(足元に床が無い)では反転せず、そのまま歩いて落下する', () => {
    const grid = new TileGrid(8, 4);
    for (let x = 0; x <= 3; x++) grid.set(x, 3, BlockType.Normal); // 床はx=3まで

    let enemy = createEnemyState({ type: EnemyType.Slime, x: 1, y: 2, dir: 1 }, 0);
    let fellIntoPit = false;
    for (let i = 0; i < 200 && !fellIntoPit; i++) {
      enemy = updateEnemy(enemy, grid, DT);
      if (enemy.y > 3.5) fellIntoPit = true; // 床の高さ(row3)を大きく超えて落下した
    }

    expect(fellIntoPit).toBe(true);
    expect(enemy.dir).toBe(1); // 壁が無いので反転していない
  });
});

describe('カエル: 常時ジャンプ移動・壁でも反転しない', () => {
  it('接地するたびに再ジャンプし続ける(空中で静止しない)', () => {
    const grid = new TileGrid(20, 3);
    for (let x = 0; x < 20; x++) grid.set(x, 2, BlockType.Normal);

    let enemy = createEnemyState({ type: EnemyType.Frog, x: 1, y: 1, dir: 1 }, 0);
    let leftGroundAtLeastOnce = false;
    for (let i = 0; i < 300; i++) {
      enemy = updateEnemy(enemy, grid, DT);
      if (!enemy.grounded) leftGroundAtLeastOnce = true;
    }

    expect(leftGroundAtLeastOnce).toBe(true);
    expect(enemy.x).toBeGreaterThan(1); // 前進している
  });

  it('壁に当たっても反転しない', () => {
    const grid = new TileGrid(8, 3);
    for (let x = 0; x < 8; x++) grid.set(x, 2, BlockType.Normal);
    for (let y = 0; y <= 2; y++) grid.set(5, y, BlockType.Normal); // x=5 に壁

    let enemy = createEnemyState({ type: EnemyType.Frog, x: 1, y: 1, dir: 1 }, 0);
    let everFlipped = false;
    for (let i = 0; i < 600; i++) {
      enemy = updateEnemy(enemy, grid, DT);
      if (enemy.dir !== 1) everFlipped = true;
    }

    expect(everFlipped).toBe(false);
    expect(enemy.dir).toBe(1);
  });
});

describe('鳥: 等高度直進・壁反転・重力無効', () => {
  it('重力の影響を受けず高度が一定のまま、壁で反転する', () => {
    const grid = new TileGrid(8, 3);
    for (let y = 0; y < 3; y++) grid.set(5, y, BlockType.Normal); // x=5 に壁のみ(床は無い)

    let enemy = createEnemyState({ type: EnemyType.Bird, x: 1, y: 1, dir: 1 }, 0);
    const startY = enemy.y;
    let flipped = false;
    for (let i = 0; i < 300 && !flipped; i++) {
      enemy = updateEnemy(enemy, grid, DT);
      if (enemy.dir === -1) flipped = true;
    }

    expect(flipped).toBe(true);
    expect(enemy.y).toBeCloseTo(startY, 5); // 床が無くても落下しない(重力無効)
  });
});

describe('トゲ接触ダメージ', () => {
  it('接触し続けるとHPが減少し、0になると消滅(alive=false)する', () => {
    const grid = new TileGrid(8, 3);
    for (let x = 0; x < 8; x++) grid.set(x, 2, BlockType.Normal); // 床
    grid.set(3, 1, BlockType.Spike); // 進路上のトゲ

    let enemy = createEnemyState({ type: EnemyType.Slime, x: 1, y: 1, dir: 1 }, 0);
    let steps = 0;
    while (enemy.alive && steps < 300) {
      enemy = updateEnemy(enemy, grid, DT);
      steps += 1;
    }

    expect(enemy.alive).toBe(false);
    expect(enemy.hp).toBe(0);
  });

  it('死亡済みの敵は更新しても状態が変化しない', () => {
    const grid = new TileGrid(8, 3);
    const enemy = { ...createEnemyState({ type: EnemyType.Slime, x: 1, y: 1, dir: 1 }, 0), alive: false, hp: 0 };
    const result = updateEnemy(enemy, grid, DT);
    expect(result).toEqual(enemy);
  });
});

describe('createEnemyState / resetEnemy', () => {
  it('createEnemyStateはENEMY_STATSのHPで初期化する', () => {
    const slime = createEnemyState({ type: EnemyType.Slime, x: 3, y: 4, dir: -1 }, 7);
    expect(slime.hp).toBe(2);
    expect(slime.id).toBe(7);
    expect(slime.alive).toBe(true);
    expect(slime.spawn).toEqual({ type: EnemyType.Slime, x: 3, y: 4, dir: -1 });
  });

  it('resetEnemyは初期配置・HP・生存状態を復元する', () => {
    const spawned = createEnemyState({ type: EnemyType.Bird, x: 5, y: 2, dir: 1 }, 1);
    const drifted = { ...spawned, x: 40, y: 20, dir: -1 as const, hp: 0, alive: false, velocity: { x: 9, y: 9 } };
    const reset = resetEnemy(drifted);
    expect(reset.x).toBe(5);
    expect(reset.y).toBe(2);
    expect(reset.dir).toBe(1);
    expect(reset.hp).toBe(1); // bird hp
    expect(reset.alive).toBe(true);
    expect(reset.velocity).toEqual({ x: 0, y: 0 });
  });
});
