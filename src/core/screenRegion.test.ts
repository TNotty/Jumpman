import { describe, expect, it } from 'vitest';
import { GAME_AREA_HEIGHT, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './constants';
import { classifyScreenPoint } from './screenRegion';

describe('classifyScreenPoint', () => {
  it('ゲーム領域の内側は game', () => {
    expect(classifyScreenPoint(0, 0)).toBe('game');
    expect(classifyScreenPoint(640, 300)).toBe('game');
    expect(classifyScreenPoint(LOGICAL_WIDTH - 1, GAME_AREA_HEIGHT - 1)).toBe('game');
  });

  it('パレット領域の内側は palette', () => {
    expect(classifyScreenPoint(0, GAME_AREA_HEIGHT)).toBe('palette');
    expect(classifyScreenPoint(640, GAME_AREA_HEIGHT + 10)).toBe('palette');
    expect(classifyScreenPoint(LOGICAL_WIDTH - 1, LOGICAL_HEIGHT - 1)).toBe('palette');
  });

  it('境界値: y=GAME_AREA_HEIGHT-1はgame、y=GAME_AREA_HEIGHTはpalette', () => {
    expect(classifyScreenPoint(100, GAME_AREA_HEIGHT - 1)).toBe('game');
    expect(classifyScreenPoint(100, GAME_AREA_HEIGHT)).toBe('palette');
  });

  it('境界値: x=0は内側、x=LOGICAL_WIDTHは外側', () => {
    expect(classifyScreenPoint(0, 100)).toBe('game');
    expect(classifyScreenPoint(LOGICAL_WIDTH, 100)).toBe('outside');
  });

  it('境界値: y=LOGICAL_HEIGHT-1は内側(palette)、y=LOGICAL_HEIGHTは外側', () => {
    expect(classifyScreenPoint(100, LOGICAL_HEIGHT - 1)).toBe('palette');
    expect(classifyScreenPoint(100, LOGICAL_HEIGHT)).toBe('outside');
  });

  it('負の座標やキャンバス外(画面外で指を離したケース)は outside', () => {
    expect(classifyScreenPoint(-1, 100)).toBe('outside');
    expect(classifyScreenPoint(100, -1)).toBe('outside');
    expect(classifyScreenPoint(-50, -50)).toBe('outside');
    expect(classifyScreenPoint(LOGICAL_WIDTH + 200, 100)).toBe('outside');
    expect(classifyScreenPoint(100, LOGICAL_HEIGHT + 200)).toBe('outside');
  });
});
