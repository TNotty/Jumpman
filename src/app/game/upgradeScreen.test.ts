import { describe, expect, it } from 'vitest';
import { formatLevelDots } from './upgradeScreen';

describe('formatLevelDots(レベルのドット表示 ●●●○○...)', () => {
  it('level=3, max=10なら●3個+○7個になる', () => {
    expect(formatLevelDots(3, 10)).toBe('●●●○○○○○○○');
    expect(formatLevelDots(3, 10)).toHaveLength(10);
  });

  it('level=0なら全て○', () => {
    expect(formatLevelDots(0, 10)).toBe('○○○○○○○○○○');
  });

  it('level=maxなら全て●', () => {
    expect(formatLevelDots(10, 10)).toBe('●●●●●●●●●●');
  });

  it('level<0はクランプされ、全て○として扱われる', () => {
    expect(formatLevelDots(-2, 5)).toBe('○○○○○');
  });

  it('level>maxはクランプされ、全て●として扱われる', () => {
    expect(formatLevelDots(99, 5)).toBe('●●●●●');
  });

  it('max=0なら空文字列', () => {
    expect(formatLevelDots(0, 0)).toBe('');
  });

  it('max<0は0として扱われ、空文字列になる', () => {
    expect(formatLevelDots(3, -1)).toBe('');
  });
});
