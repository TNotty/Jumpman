import { describe, expect, it } from 'vitest';
import { validateStage } from './schema';

function baseStage(): Record<string, unknown> {
  return {
    version: 1,
    id: 'stage_test',
    name: 'テストステージ',
    theme: 'grass',
    width: 4,
    height: 3,
    tiles: ['....', '....', 'NNNN'],
    start: { x: 0, y: 1 },
    goal: { x: 3, y: 1 },
    checkpoints: [{ x: 2, y: 1 }],
    enemies: [{ type: 'slime', x: 1, y: 1, dir: -1 }],
    mana: { initial: 10, max: 50, regenPerSec: 1 },
    eraseCost: 3,
  };
}

describe('validateStage', () => {
  it('正常なステージデータを受理する', () => {
    const result = validateStage(baseStage());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('stage_test');
      expect(result.value.tiles).toHaveLength(3);
      expect(result.value.enemies[0]?.type).toBe('slime');
    }
  });

  it('tiles の行数がheightと一致しない場合は拒否する', () => {
    const data = baseStage();
    data['tiles'] = ['....', '....']; // height=3だが2行しかない
    const result = validateStage(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('tiles'))).toBe(true);
    }
  });

  it('tiles の行の長さがwidthと一致しない場合は拒否する', () => {
    const data = baseStage();
    data['tiles'] = ['....', '...', 'NNNN']; // 2行目の長さが3(width=4のはず)
    const result = validateStage(data);
    expect(result.ok).toBe(false);
  });

  it('不正なタイル文字を拒否する', () => {
    const data = baseStage();
    data['tiles'] = ['....', '.X..', 'NNNN']; // 'X' は凡例にない
    const result = validateStage(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('不正なタイル文字'))).toBe(true);
    }
  });

  it('start がステージ範囲外の場合は拒否する', () => {
    const data = baseStage();
    data['start'] = { x: 99, y: 1 };
    const result = validateStage(data);
    expect(result.ok).toBe(false);
  });

  it('enemies の type が不正な場合は拒否する', () => {
    const data = baseStage();
    data['enemies'] = [{ type: 'dragon', x: 1, y: 1, dir: -1 }];
    const result = validateStage(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('enemies[0].type'))).toBe(true);
    }
  });

  it('mana.initial が mana.max を超える場合は拒否する', () => {
    const data = baseStage();
    data['mana'] = { initial: 100, max: 50, regenPerSec: 1 };
    const result = validateStage(data);
    expect(result.ok).toBe(false);
  });

  it('オブジェクトでないデータを拒否する', () => {
    const result = validateStage('not an object');
    expect(result.ok).toBe(false);
  });
});
