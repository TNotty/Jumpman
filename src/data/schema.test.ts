import { describe, expect, it } from 'vitest';
import { validateStage, validateTerrainMaster } from './schema';

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

  it('coins フィールドが無い場合は空配列として受理する(coins追加前のステージJSONとの後方互換)', () => {
    const data = baseStage(); // baseStage()はcoinsを含まない
    const result = validateStage(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.coins).toEqual([]);
    }
  });

  it('coins が正しく設定されていれば受理し、値をそのまま返す', () => {
    const data = baseStage();
    data['coins'] = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
    const result = validateStage(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.coins).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    }
  });

  it('coins の座標がステージ範囲外の場合は拒否する', () => {
    const data = baseStage();
    data['coins'] = [{ x: 99, y: 1 }];
    const result = validateStage(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('coins[0]'))).toBe(true);
    }
  });

  it('coins が配列でない場合は拒否する', () => {
    const data = baseStage();
    data['coins'] = 'not an array';
    const result = validateStage(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('coins'))).toBe(true);
    }
  });
});

function baseTerrainMaster(): Record<string, unknown> {
  return {
    version: 1,
    terrains: [{ id: 'h3', name: '横3マス', cost: 2, unlocked: true, unlockCost: 0, grid: ['NNN'] }],
  };
}

describe('validateTerrainMaster', () => {
  it('正常な地形マスタデータ(unlockCost込み)を受理する', () => {
    const result = validateTerrainMaster(baseTerrainMaster());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terrains[0]?.unlockCost).toBe(0);
    }
  });

  it('unlockCost フィールドが無いエントリは0として扱う(unlockCost追加前のterrainMaster.jsonとの後方互換)', () => {
    const data = baseTerrainMaster();
    data['terrains'] = [{ id: 'h3', name: '横3マス', cost: 2, unlocked: false, grid: ['NNN'] }]; // unlockCostを省略
    const result = validateTerrainMaster(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terrains[0]?.unlockCost).toBe(0);
    }
  });

  it('unlockCost が指定されていればその値を使う', () => {
    const data = baseTerrainMaster();
    data['terrains'] = [{ id: 'spike', name: 'トゲ', cost: 3, unlocked: false, unlockCost: 5, grid: ['S'] }];
    const result = validateTerrainMaster(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terrains[0]?.unlockCost).toBe(5);
    }
  });

  it('unlockCost が負の場合は拒否する', () => {
    const data = baseTerrainMaster();
    data['terrains'] = [{ id: 'h3', name: '横3マス', cost: 2, unlocked: true, unlockCost: -1, grid: ['NNN'] }];
    const result = validateTerrainMaster(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('unlockCost'))).toBe(true);
    }
  });
});
