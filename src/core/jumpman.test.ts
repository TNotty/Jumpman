import { describe, expect, it } from 'vitest';
import { TileGrid } from './grid';
import { applyDamage, createJumpman, isDead, isFallDeath, respawn, shouldJump, updateJumpman } from './jumpman';
import { BlockType } from './types';
import type { AABB } from './types';
import { INVINCIBLE_DURATION, JUMPMAN_MAX_HP, KNOCKBACK_VX, KNOCKBACK_VY } from './constants';

function makeGroundGrid(): TileGrid {
  // 8x8。row6を床として全面solidにしておく
  const grid = new TileGrid(12, 8);
  for (let x = 0; x < 12; x++) {
    grid.set(x, 6, BlockType.Normal);
  }
  return grid;
}

describe('shouldJump', () => {
  it('崖(前方の足元に床が無い)なら接地中はジャンプする', () => {
    const grid = makeGroundGrid();
    // x=6 から先の床を消して崖にする
    for (let x = 6; x < 12; x++) {
      grid.set(x, 6, BlockType.Empty);
    }
    const aabb: AABB = { x: 5, y: 4.5, w: 0.6, h: 1.5 }; // 足元 y=6, x範囲[5,5.6]
    expect(shouldJump(grid, aabb, 1, true, 0)).toBe(true);
  });

  it('壁(前方に壁)なら接地中はジャンプする(壁優先)', () => {
    const grid = makeGroundGrid();
    // x=6 に床から立ち上がる壁を作る(縦方向にsolidを積む)
    for (let y = 3; y <= 6; y++) {
      grid.set(6, y, BlockType.Normal);
    }
    // 壁センサーは前方0.05タイルしか見ないため、壁のすぐ手前まで接近した位置で検証する
    const aabb: AABB = { x: 5.4, y: 4.5, w: 0.6, h: 1.5 };
    expect(shouldJump(grid, aabb, 1, true, 0)).toBe(true);
  });

  it('崖でも壁でもなければジャンプしない', () => {
    const grid = makeGroundGrid();
    const aabb: AABB = { x: 5, y: 4.5, w: 0.6, h: 1.5 };
    expect(shouldJump(grid, aabb, 1, true, 0)).toBe(false);
  });

  it('空中(非接地)では崖・壁があっても発火しない', () => {
    const grid = makeGroundGrid();
    for (let x = 6; x < 12; x++) {
      grid.set(x, 6, BlockType.Empty);
    }
    const aabb: AABB = { x: 5, y: 4.5, w: 0.6, h: 1.5 };
    expect(shouldJump(grid, aabb, 1, false, 0)).toBe(false);
  });

  it('ジャンプ後のクールダウン中は発火しない', () => {
    const grid = makeGroundGrid();
    for (let x = 6; x < 12; x++) {
      grid.set(x, 6, BlockType.Empty);
    }
    const aabb: AABB = { x: 5, y: 4.5, w: 0.6, h: 1.5 };
    expect(shouldJump(grid, aabb, 1, true, 0.05)).toBe(false);
  });
});

describe('isFallDeath / respawn', () => {
  it('ステージ高さ + 2 を超えると落下死と判定する', () => {
    expect(isFallDeath({ x: 0, y: 22.1 }, 20)).toBe(true);
    expect(isFallDeath({ x: 0, y: 22 }, 20)).toBe(false);
    expect(isFallDeath({ x: 0, y: 0 }, 20)).toBe(false);
  });

  it('respawn はrespawnPointへ戻し、HP全快・速度リセット・無敵解除する', () => {
    const jumpman = {
      ...createJumpman({ x: 2, y: 5 }),
      position: { x: 40, y: 22.5 },
      velocity: { x: 6, y: 20 },
      hp: 1,
      invincibleTimer: 1.5,
      jumpCooldown: 0.05,
    };
    const result = respawn(jumpman);
    expect(result.position).toEqual({ x: 2, y: 5 });
    expect(result.velocity.y).toBe(0);
    expect(result.hp).toBe(5);
    expect(result.invincibleTimer).toBe(0);
    expect(result.jumpCooldown).toBe(0);
  });

  it('updateJumpman自体は落下死しても自動復帰しない(復帰の統括はgame.tsが行う契約)', () => {
    // 床の無いグリッド(全面空)。updateJumpmanは物理更新のみを行い、
    // 復帰(敵の初期化を含む横断的な処理)はgame.tsのrespawnAtCheckpointが担当する。
    const grid = new TileGrid(6, 5); // 全マスEmpty
    let jumpman = createJumpman({ x: 1, y: 0 });

    let becameFallDeath = false;
    for (let i = 0; i < 300 && !becameFallDeath; i++) {
      jumpman = updateJumpman(jumpman, grid, 1 / 60);
      if (isFallDeath(jumpman.position, grid.height)) {
        becameFallDeath = true;
      }
    }

    expect(becameFallDeath).toBe(true);
    // updateJumpman はここでpositionをrespawnPointへ戻さない(次のフレームも落下し続ける)
    expect(jumpman.position).not.toEqual(jumpman.respawnPoint);
  });
});

describe('applyDamage / isDead', () => {
  it('被弾するとHPが減り、ノックバック速度が設定され、無敵時間が付与される', () => {
    const jumpman = createJumpman({ x: 0, y: 0 });
    const result = applyDamage(jumpman, 1);
    expect(result.hp).toBe(JUMPMAN_MAX_HP - 1);
    expect(result.velocity).toEqual({ x: KNOCKBACK_VX, y: KNOCKBACK_VY });
    expect(result.invincibleTimer).toBe(INVINCIBLE_DURATION);
  });

  it('無敵中は被弾しても状態が変化しない(同一参照を返す)', () => {
    const jumpman = { ...createJumpman({ x: 0, y: 0 }), invincibleTimer: 1.0 };
    const result = applyDamage(jumpman, 1);
    expect(result).toBe(jumpman);
  });

  it('HPは0未満にならない', () => {
    const jumpman = { ...createJumpman({ x: 0, y: 0 }), hp: 1 };
    const result = applyDamage(jumpman, 99);
    expect(result.hp).toBe(0);
  });

  it('isDead: HPが0以下ならtrue', () => {
    expect(isDead({ ...createJumpman({ x: 0, y: 0 }), hp: 0 })).toBe(true);
    expect(isDead({ ...createJumpman({ x: 0, y: 0 }), hp: 1 })).toBe(false);
  });

  it('無敵タイマーはupdateJumpmanで毎フレーム減算される', () => {
    const grid = new TileGrid(10, 10);
    const jumpman = { ...createJumpman({ x: 1, y: 1 }), invincibleTimer: 0.05 };
    const result = updateJumpman(jumpman, grid, 1 / 60);
    expect(result.invincibleTimer).toBeCloseTo(0.05 - 1 / 60, 5);
  });
});
