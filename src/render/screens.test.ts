import { describe, expect, it } from 'vitest';
import { coinAlpha, computeDemoRunX, computeTitleBobOffset, stageSelectBoxRect } from './screens';

describe('coinAlpha', () => {
  it('取得済み(collected=true)は半透明(0.35)になる(HUD側drawCoinsのtaken?0.35:1と揃える)', () => {
    expect(coinAlpha(true)).toBe(0.35);
  });

  it('未取得(collected=false)は不透明(1)になる', () => {
    expect(coinAlpha(false)).toBe(1);
  });
});

describe('computeTitleBobOffset(タイトルロゴの上下ボブ)', () => {
  it('animTime=0では0を返す', () => {
    expect(computeTitleBobOffset(0)).toBe(0);
  });

  it('常に-8〜8の範囲に収まる(振幅8pxのサインカーブ)', () => {
    for (let t = 0; t < 10; t += 0.1) {
      const offset = computeTitleBobOffset(t);
      expect(offset).toBeGreaterThanOrEqual(-8);
      expect(offset).toBeLessThanOrEqual(8);
    }
  });
});

describe('computeDemoRunX(タイトル画面のデモ走行、GameState不要の見た目だけの疑似ループ)', () => {
  it('animTime=0ではx=0から始まる', () => {
    expect(computeDemoRunX(0, 1000)).toBe(0);
  });

  it('時間が進むほどxが増える(loopWidthPxに達する前)', () => {
    const a = computeDemoRunX(1, 1000);
    const b = computeDemoRunX(2, 1000);
    expect(b).toBeGreaterThan(a);
  });

  it('常に0以上loopWidthPx未満に収まる(ループする)', () => {
    for (let t = 0; t < 60; t += 0.5) {
      const x = computeDemoRunX(t, 500);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(500);
    }
  });

  it('loopWidthPxが0以下なら常に0(0除算を避ける)', () => {
    expect(computeDemoRunX(5, 0)).toBe(0);
    expect(computeDemoRunX(5, -10)).toBe(0);
  });
});

describe('stageSelectBoxRect(ステージ選択のヒットテスト座標: カード化しても変更しないことを保証する回帰テスト)', () => {
  it('1枠目(index=0)の矩形は既存の座標(2列×5行、560x96、上端170px)のまま', () => {
    expect(stageSelectBoxRect(0)).toEqual({ x: 60, y: 170, w: 560, h: 96 });
  });

  it('2枠目(index=1、1列目の隣)は同じ行でx方向に(w+gapX)だけずれる', () => {
    const first = stageSelectBoxRect(0);
    const second = stageSelectBoxRect(1);
    expect(second.y).toBe(first.y);
    expect(second.x).toBe(first.x + first.w + 40);
  });

  it('3枠目(index=2、次の行の1列目)は1枠目からy方向に(h+gapY)だけずれる', () => {
    const first = stageSelectBoxRect(0);
    const third = stageSelectBoxRect(2);
    expect(third.x).toBe(first.x);
    expect(third.y).toBe(first.y + first.h + 14);
  });

  it('10枠(index=0〜9)すべてが画面(1280x768)の範囲内に収まる', () => {
    for (let i = 0; i < 10; i++) {
      const rect = stageSelectBoxRect(i);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(1280);
      expect(rect.y + rect.h).toBeLessThanOrEqual(768);
    }
  });
});
