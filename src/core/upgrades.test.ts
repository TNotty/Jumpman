import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_STATS,
  MAX_UPGRADE_LEVEL,
  decreaseUpgrade,
  derivePlayerStats,
  downgradeRefund,
  increaseUpgrade,
  isTerrainUnlocked,
  unlockTerrain,
  upgradeCost,
  zeroUpgradeLevels,
} from './upgrades';
import type { TerrainDefinition } from './types';

describe('upgradeCost / downgradeRefund', () => {
  it('コストはレベルL→L+1でL+1コイン(1,2,3,...,10)', () => {
    for (let level = 0; level < MAX_UPGRADE_LEVEL; level++) {
      expect(upgradeCost(level)).toBe(level + 1);
    }
  });

  it('返還はレベルL→L-1でLコイン(上げた時と同額のlossless返還)', () => {
    for (let level = 1; level <= MAX_UPGRADE_LEVEL; level++) {
      expect(downgradeRefund(level)).toBe(level);
    }
  });

  it('0→10まで1つずつ上げた合計コストは55枚(1+2+...+10)', () => {
    let total = 0;
    for (let level = 0; level < MAX_UPGRADE_LEVEL; level++) {
      total += upgradeCost(level);
    }
    expect(total).toBe(55);
  });
});

describe('economy(コスト/返還/レベル境界/wallet不足拒否)', () => {
  it('レベル0→1: コスト1枚、wallet 1以上で成功する', () => {
    const levels = zeroUpgradeLevels();
    const result = increaseUpgrade(levels, 'hp', 1);
    expect(result.ok).toBe(true);
    expect(result.levels.hp).toBe(1);
    expect(result.walletDelta).toBe(-1);
  });

  it('wallet不足(コスト未満)なら拒否され、レベル・wallet変化は無い', () => {
    const levels = { ...zeroUpgradeLevels(), speed: 3 }; // 次コストは4
    const result = increaseUpgrade(levels, 'speed', 3);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_wallet');
    expect(result.levels.speed).toBe(3);
    expect(result.walletDelta).toBe(0);
  });

  it('最大レベル(10)からはさらに上げられない(walletが十分でも拒否)', () => {
    const levels = { ...zeroUpgradeLevels(), jump: MAX_UPGRADE_LEVEL };
    const result = increaseUpgrade(levels, 'jump', 9999);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('max_level');
    expect(result.levels.jump).toBe(MAX_UPGRADE_LEVEL);
    expect(result.walletDelta).toBe(0);
  });

  it('レベル0からは下げられない(拒否・walletDelta 0)', () => {
    const levels = zeroUpgradeLevels();
    const result = decreaseUpgrade(levels, 'manaRegen');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('min_level');
    expect(result.levels.manaRegen).toBe(0);
    expect(result.walletDelta).toBe(0);
  });

  it('レベル5から下げると4になり、5コイン返還される(上げた時と同額)', () => {
    const levels = { ...zeroUpgradeLevels(), manaMax: 5 };
    const result = decreaseUpgrade(levels, 'manaMax');
    expect(result.ok).toBe(true);
    expect(result.levels.manaMax).toBe(4);
    expect(result.walletDelta).toBe(5);
  });

  it('上げてから下げると、コストと返還が完全に相殺する(loss無し)', () => {
    let levels = zeroUpgradeLevels();
    let wallet = 10;

    const up = increaseUpgrade(levels, 'hp', wallet);
    expect(up.ok).toBe(true);
    levels = up.levels;
    wallet += up.walletDelta;
    expect(wallet).toBe(9); // 10 - 1

    const down = decreaseUpgrade(levels, 'hp');
    expect(down.ok).toBe(true);
    levels = down.levels;
    wallet += down.walletDelta;
    expect(wallet).toBe(10); // 9 + 1、元通り
    expect(levels.hp).toBe(0);
  });

  it('他の項目のレベルには影響しない(項目ごとに独立)', () => {
    const levels = { ...zeroUpgradeLevels(), speed: 2, jump: 1 };
    const result = increaseUpgrade(levels, 'speed', 100);
    expect(result.levels).toEqual({ hp: 0, speed: 3, jump: 1, manaRegen: 0, manaMax: 0 });
  });
});

describe('derivePlayerStats', () => {
  it('レベル0(未強化)は基礎値と一致する(既存の定数と同じ)', () => {
    const stats = derivePlayerStats(zeroUpgradeLevels());
    expect(stats.maxHp).toBe(5);
    expect(stats.runSpeed).toBe(3);
    expect(stats.jumpVelocity).toBe(-17);
    expect(stats.manaRegenMultiplier).toBe(1);
    expect(stats.manaMaxBonus).toBe(0);
  });

  it('DEFAULT_PLAYER_STATSはレベル0相当のPlayerStatsと一致する', () => {
    expect(DEFAULT_PLAYER_STATS).toEqual(derivePlayerStats(zeroUpgradeLevels()));
  });

  it('hp lv3: 最大HPが5+3=8になる', () => {
    const stats = derivePlayerStats({ ...zeroUpgradeLevels(), hp: 3 });
    expect(stats.maxHp).toBe(8);
  });

  it('hp lv10(最大): 最大HPが5+10=15になる', () => {
    const stats = derivePlayerStats({ ...zeroUpgradeLevels(), hp: MAX_UPGRADE_LEVEL });
    expect(stats.maxHp).toBe(15);
  });

  it('speed lv10(最大): 走行速度が3×2=6(2倍)になる', () => {
    const stats = derivePlayerStats({ ...zeroUpgradeLevels(), speed: MAX_UPGRADE_LEVEL });
    expect(stats.runSpeed).toBe(6);
  });

  it('jump lv10(最大): ジャンプ初速が-17×2=-34になる', () => {
    const stats = derivePlayerStats({ ...zeroUpgradeLevels(), jump: MAX_UPGRADE_LEVEL });
    expect(stats.jumpVelocity).toBe(-34);
  });

  it('manaRegen lv10(最大): 回復倍率が1+2=3(3倍)になる', () => {
    const stats = derivePlayerStats({ ...zeroUpgradeLevels(), manaRegen: MAX_UPGRADE_LEVEL });
    expect(stats.manaRegenMultiplier).toBe(3);
  });

  it('manaMax lv10(最大): マナ上限ボーナスが+50になる', () => {
    const stats = derivePlayerStats({ ...zeroUpgradeLevels(), manaMax: MAX_UPGRADE_LEVEL });
    expect(stats.manaMaxBonus).toBe(50);
  });

  it('複数項目を同時に強化しても各項目は独立に効果へ反映される', () => {
    const stats = derivePlayerStats({ hp: 2, speed: 5, jump: 0, manaRegen: 1, manaMax: 4 });
    expect(stats.maxHp).toBe(7);
    expect(stats.runSpeed).toBeCloseTo(3 * 1.5);
    expect(stats.jumpVelocity).toBe(-17);
    expect(stats.manaRegenMultiplier).toBeCloseTo(1.2);
    expect(stats.manaMaxBonus).toBe(20);
  });
});

describe('unlockTerrain', () => {
  it('walletが足りていれば解放し、walletから正確にunlockCost分だけ消費する', () => {
    const result = unlockTerrain(10, [], 'h3', 4);
    expect(result.ok).toBe(true);
    expect(result.wallet).toBe(6);
    expect(result.unlockedTerrainIds).toEqual(['h3']);
  });

  it('wallet不足なら拒否され、wallet・unlockedTerrainIdsとも変化しない', () => {
    const result = unlockTerrain(2, ['v5'], 'h3', 4);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_wallet');
    expect(result.wallet).toBe(2);
    expect(result.unlockedTerrainIds).toEqual(['v5']);
  });

  it('既に解放済み(unlockedTerrainIdsに含まれる)なら拒否し、二重消費しない', () => {
    const result = unlockTerrain(100, ['h3'], 'h3', 4);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already_unlocked');
    expect(result.wallet).toBe(100); // 消費されない
    expect(result.unlockedTerrainIds).toEqual(['h3']);
  });

  it('解放は返還不可の恒久操作である(解放後、コストちょうど分walletが減ったままになる)', () => {
    const result = unlockTerrain(5, [], 'spike', 5);
    expect(result.ok).toBe(true);
    expect(result.wallet).toBe(0);
  });
});

describe('isTerrainUnlocked', () => {
  const baseTerrain: TerrainDefinition = {
    id: 'h5',
    name: '横5マス',
    cost: 3,
    unlocked: true,
    unlockCost: 0,
    grid: ['NNNNN'],
  };
  const lockedTerrain: TerrainDefinition = {
    id: 'spike',
    name: 'トゲ',
    cost: 3,
    unlocked: false,
    unlockCost: 5,
    grid: ['S'],
  };

  it('terrain.unlocked=trueな地形は常に解放済み扱い(unlockedTerrainIdsに関わらず)', () => {
    expect(isTerrainUnlocked(baseTerrain, [])).toBe(true);
  });

  it('unlocked=falseでも、unlockedTerrainIdsに含まれていれば解放済み扱い', () => {
    expect(isTerrainUnlocked(lockedTerrain, ['spike'])).toBe(true);
  });

  it('unlocked=falseかつunlockedTerrainIdsに含まれなければ未解放', () => {
    expect(isTerrainUnlocked(lockedTerrain, ['v5'])).toBe(false);
    expect(isTerrainUnlocked(lockedTerrain, [])).toBe(false);
  });
});
