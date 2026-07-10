import { describe, expect, it } from 'vitest';
import {
  FADE_DURATION,
  advanceTransition,
  beginFadeOut,
  computeFadeAlpha,
  createIdleTransition,
  isTransitioning,
} from './sceneTransition';

describe('createIdleTransition / isTransitioning', () => {
  it('初期状態はidleで、isTransitioningはfalse', () => {
    const t = createIdleTransition();
    expect(t.state).toBe('idle');
    expect(isTransitioning(t)).toBe(false);
  });

  it('fadeOut/fadeInはisTransitioning=true', () => {
    expect(isTransitioning({ state: 'fadeOut', elapsed: 0 })).toBe(true);
    expect(isTransitioning({ state: 'fadeIn', elapsed: 0 })).toBe(true);
  });
});

describe('computeFadeAlpha', () => {
  it('idle中は常に0(透明)', () => {
    expect(computeFadeAlpha(createIdleTransition())).toBe(0);
  });

  it('fadeOut開始直後は0に近く、進むほど1に近づく', () => {
    expect(computeFadeAlpha({ state: 'fadeOut', elapsed: 0 })).toBe(0);
    expect(computeFadeAlpha({ state: 'fadeOut', elapsed: FADE_DURATION / 2 })).toBeCloseTo(0.5, 5);
    expect(computeFadeAlpha({ state: 'fadeOut', elapsed: FADE_DURATION })).toBe(1);
  });

  it('fadeIn開始直後は1(真っ黒)に近く、進むほど0に近づく', () => {
    expect(computeFadeAlpha({ state: 'fadeIn', elapsed: 0 })).toBe(1);
    expect(computeFadeAlpha({ state: 'fadeIn', elapsed: FADE_DURATION / 2 })).toBeCloseTo(0.5, 5);
    expect(computeFadeAlpha({ state: 'fadeIn', elapsed: FADE_DURATION })).toBe(0);
  });

  it('elapsedがdurationを超えてもalphaは0〜1にクランプされる', () => {
    expect(computeFadeAlpha({ state: 'fadeOut', elapsed: FADE_DURATION * 2 })).toBe(1);
    expect(computeFadeAlpha({ state: 'fadeIn', elapsed: FADE_DURATION * 2 })).toBe(0);
  });
});

describe('advanceTransition', () => {
  it('idle中はdtが経過しても何も変化しない', () => {
    const result = advanceTransition(createIdleTransition(), 1);
    expect(result.next).toEqual(createIdleTransition());
    expect(result.fadeOutJustCompleted).toBe(false);
  });

  it('fadeOut中はelapsedが進むだけで、durationに達するまではfadeOutのまま', () => {
    const result = advanceTransition(beginFadeOut(), FADE_DURATION / 2);
    expect(result.next).toEqual({ state: 'fadeOut', elapsed: FADE_DURATION / 2 });
    expect(result.fadeOutJustCompleted).toBe(false);
  });

  it('fadeOutがdurationに達するとfadeInへ切り替わり、fadeOutJustCompleted=trueになる', () => {
    const result = advanceTransition(beginFadeOut(), FADE_DURATION);
    expect(result.next).toEqual({ state: 'fadeIn', elapsed: 0 });
    expect(result.fadeOutJustCompleted).toBe(true);
  });

  it('fadeOutを超過するdtでも1回でfadeInへ切り替わる(取りこぼさない)', () => {
    const result = advanceTransition(beginFadeOut(), FADE_DURATION * 3);
    expect(result.next.state).toBe('fadeIn');
    expect(result.fadeOutJustCompleted).toBe(true);
  });

  it('fadeIn中はelapsedが進むだけで、durationに達するまではfadeInのまま(fadeOutJustCompletedは常にfalse)', () => {
    const result = advanceTransition({ state: 'fadeIn', elapsed: 0 }, FADE_DURATION / 2);
    expect(result.next).toEqual({ state: 'fadeIn', elapsed: FADE_DURATION / 2 });
    expect(result.fadeOutJustCompleted).toBe(false);
  });

  it('fadeInがdurationに達するとidleへ戻る', () => {
    const result = advanceTransition({ state: 'fadeIn', elapsed: 0 }, FADE_DURATION);
    expect(result.next).toEqual({ state: 'idle', elapsed: 0 });
    expect(result.fadeOutJustCompleted).toBe(false);
  });

  it('完全な往復(fadeOut→fadeIn→idle)をシミュレートすると、途中で一度だけfadeOutJustCompletedがtrueになる', () => {
    let transition = beginFadeOut();
    let completions = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      const result = advanceTransition(transition, dt);
      transition = result.next;
      if (result.fadeOutJustCompleted) completions += 1;
    }
    expect(completions).toBe(1);
    expect(transition.state).toBe('idle');
  });
});
