import { describe, expect, it } from 'vitest';
import { computeBackingStoreSize, needsResize } from './canvasResize';

describe('computeBackingStoreSize', () => {
  it('dpr=1のときはCSS px値をそのまま丸めたものになる', () => {
    expect(computeBackingStoreSize(390, 600, 1)).toEqual({ width: 390, height: 600 });
  });

  it('dpr>1のときはCSS px × dprになる(retinaでも滲まないように高解像度化)', () => {
    expect(computeBackingStoreSize(390, 600, 2)).toEqual({ width: 780, height: 1200 });
    expect(computeBackingStoreSize(390, 600, 3)).toEqual({ width: 1170, height: 1800 });
  });

  it('小数のCSS px × dprは四捨五入される', () => {
    expect(computeBackingStoreSize(390.4, 600.6, 2.5)).toEqual({
      width: Math.round(390.4 * 2.5),
      height: Math.round(600.6 * 2.5),
    });
  });

  it('0以下のサイズは最小1にクランプする(レイアウト前の0幅/0高さの保険)', () => {
    expect(computeBackingStoreSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
    expect(computeBackingStoreSize(-5, 10, 2)).toEqual({ width: 1, height: 20 });
  });

  it('横長・縦長どちらの表示サイズでも、幅と高さそれぞれ独立にdprを乗じるだけで非等方スケールは発生しない', () => {
    // 縦画面(横<縦)
    const portrait = computeBackingStoreSize(360, 780, 2);
    expect(portrait.width / 360).toBeCloseTo(2);
    expect(portrait.height / 780).toBeCloseTo(2);
    // 横画面(横>縦)
    const landscape = computeBackingStoreSize(780, 360, 2);
    expect(landscape.width / 780).toBeCloseTo(2);
    expect(landscape.height / 360).toBeCloseTo(2);
  });
});

describe('needsResize', () => {
  it('幅・高さが両方とも同じなら false', () => {
    expect(needsResize({ width: 100, height: 200 }, { width: 100, height: 200 })).toBe(false);
  });

  it('幅か高さのどちらかが違えば true', () => {
    expect(needsResize({ width: 100, height: 200 }, { width: 101, height: 200 })).toBe(true);
    expect(needsResize({ width: 100, height: 200 }, { width: 100, height: 201 })).toBe(true);
    expect(needsResize({ width: 100, height: 200 }, { width: 50, height: 50 })).toBe(true);
  });
});
