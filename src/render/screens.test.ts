import { describe, expect, it } from 'vitest';
import { coinAlpha } from './screens';

describe('coinAlpha', () => {
  it('取得済み(collected=true)は半透明(0.35)になる(HUD側drawCoinsのtaken?0.35:1と揃える)', () => {
    expect(coinAlpha(true)).toBe(0.35);
  });

  it('未取得(collected=false)は不透明(1)になる', () => {
    expect(coinAlpha(false)).toBe(1);
  });
});
