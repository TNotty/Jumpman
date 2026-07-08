import { describe, expect, it } from 'vitest';
import { canAfford, regenerate, spend } from './mana';

describe('mana.regenerate', () => {
  it('経過時間分だけ回復する', () => {
    const mana = { current: 10, max: 50, regenPerSec: 1 };
    const result = regenerate(mana, 5);
    expect(result.current).toBe(15);
  });

  it('上限を超えて回復しない(clamp)', () => {
    const mana = { current: 48, max: 50, regenPerSec: 1 };
    const result = regenerate(mana, 10);
    expect(result.current).toBe(50);
  });

  it('regenPerSecが0以下なら変化しない(同一参照を返す)', () => {
    const mana = { current: 10, max: 50, regenPerSec: 0 };
    const result = regenerate(mana, 5);
    expect(result).toBe(mana);
  });
});

describe('mana.canAfford / spend', () => {
  it('現在値がコスト以上ならtrue', () => {
    expect(canAfford({ current: 3, max: 50, regenPerSec: 1 }, 3)).toBe(true);
    expect(canAfford({ current: 2, max: 50, regenPerSec: 1 }, 3)).toBe(false);
  });

  it('spend: コストを消費する', () => {
    const mana = { current: 10, max: 50, regenPerSec: 1 };
    const result = spend(mana, 3);
    expect(result.current).toBe(7);
  });

  it('spend: 0未満にはならない(既にcanAffordで確認されている前提だが安全側でclamp)', () => {
    const mana = { current: 2, max: 50, regenPerSec: 1 };
    const result = spend(mana, 5);
    expect(result.current).toBe(0);
  });
});
