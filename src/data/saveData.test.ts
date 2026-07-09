// セーブデータのスキーマ検証(デフォルト値・破損フォールバック)と、localStorage経由の読み書きを検証する。
// loadSaveData/saveSaveDataはwindow.localStorageに触れるため、このプロジェクトのvitest環境
// (node、DOM無し)では window をテスト内でスタブする(src/platform/navigation.test.ts と同じ方式)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOADOUT_SIZE,
  SAVE_DATA_STORAGE_KEY,
  SAVE_DATA_VERSION,
  defaultSaveData,
  loadSaveData,
  saveSaveData,
  validateSaveData,
} from './saveData';

describe('defaultSaveData', () => {
  it('要求されたスキーマどおりの既定値を返す', () => {
    const data = defaultSaveData();
    expect(data.version).toBe(1);
    expect(data.wallet).toBe(0);
    expect(data.collected).toEqual({});
    expect(data.upgrades).toEqual({ hp: 0, speed: 0, jump: 0, manaRegen: 0, manaMax: 0 });
    expect(data.unlockedTerrainIds).toEqual([]);
    expect(data.loadout).toEqual(['h5', 'v3', 'u', null, null, null, null, null]);
    expect(data.loadout).toHaveLength(LOADOUT_SIZE);
    expect(data.clearedStageIds).toEqual([]);
  });

  it('呼び出しごとに独立したオブジェクトを返す(参照共有によるミューテーション汚染が無い)', () => {
    const a = defaultSaveData();
    const b = defaultSaveData();
    a.wallet = 999;
    a.loadout[0] = 'changed';
    a.upgrades.hp = 5;
    a.clearedStageIds.push('stage01');
    expect(b.wallet).toBe(0);
    expect(b.loadout[0]).toBe('h5');
    expect(b.upgrades.hp).toBe(0);
    expect(b.clearedStageIds).toEqual([]);
  });
});

describe('validateSaveData', () => {
  it('正常なセーブデータをそのまま受理する', () => {
    const raw = {
      version: 1,
      wallet: 12,
      collected: { stage01: [0, 2, 4] },
      upgrades: { hp: 2, speed: 1, jump: 0, manaRegen: 3, manaMax: 1 },
      unlockedTerrainIds: ['h3', 'spike'],
      loadout: ['h5', 'v3', 'u', 'h3', null, null, null, null],
      clearedStageIds: ['stage01', 'stage02'],
    };
    const result = validateSaveData(raw);
    expect(result).toEqual(raw);
  });

  it('nullやオブジェクトでない値は既定値にフォールバックする(例外を投げない)', () => {
    expect(validateSaveData(null)).toEqual(defaultSaveData());
    expect(validateSaveData(undefined)).toEqual(defaultSaveData());
    expect(validateSaveData('broken')).toEqual(defaultSaveData());
    expect(validateSaveData(42)).toEqual(defaultSaveData());
    expect(validateSaveData([1, 2, 3])).toEqual(defaultSaveData());
  });

  it('壊れているのは一部フィールドだけでも、そのフィールドだけ既定値になり他は救出される', () => {
    const raw = {
      wallet: -5, // 不正(負数)→既定値0にフォールバック
      collected: { stage01: [0, 1] }, // 正常→維持
      upgrades: 'not an object', // 不正→既定値にフォールバック
      unlockedTerrainIds: ['h3'], // 正常→維持
      loadout: null, // 不正→既定値にフォールバック
    };
    const result = validateSaveData(raw);
    expect(result.wallet).toBe(0);
    expect(result.collected).toEqual({ stage01: [0, 1] });
    expect(result.upgrades).toEqual({ hp: 0, speed: 0, jump: 0, manaRegen: 0, manaMax: 0 });
    expect(result.unlockedTerrainIds).toEqual(['h3']);
    expect(result.loadout).toEqual(defaultSaveData().loadout);
    // clearedStageIds はこのフィクスチャに含まれていない(=既存セーブにフィールドが無いケースを兼ねる)。
    // 例外を投げず既定値(空配列)にフォールバックする(後方互換)。
    expect(result.clearedStageIds).toEqual([]);
  });

  it('clearedStageIds: 空文字でない文字列のみを残し、重複を除去する(unlockedTerrainIdsと同じ検証方針)', () => {
    const result = validateSaveData({ clearedStageIds: ['stage01', 'stage02', 'stage01', '', 42, null] });
    expect(result.clearedStageIds.sort()).toEqual(['stage01', 'stage02']);
  });

  it('clearedStageIds が配列でない場合は既定値(空配列)にフォールバックする', () => {
    expect(validateSaveData({ clearedStageIds: 'not-an-array' }).clearedStageIds).toEqual([]);
    expect(validateSaveData({ clearedStageIds: null }).clearedStageIds).toEqual([]);
  });

  it('collected の値は重複を除去し昇順にする。負数・非整数は取り除く', () => {
    const result = validateSaveData({ collected: { stage01: [3, 1, 1, -1, 2.5, 0] } });
    expect(result.collected).toEqual({ stage01: [0, 1, 3] });
  });

  it('loadout は常に8要素になる(短ければnullで埋め、長ければ切り詰める)', () => {
    const short = validateSaveData({ loadout: ['h5'] });
    expect(short.loadout).toEqual(['h5', null, null, null, null, null, null, null]);

    const long = validateSaveData({ loadout: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] });
    expect(long.loadout).toHaveLength(LOADOUT_SIZE);
    expect(long.loadout).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('loadout の空文字列やnull以外の不正値はnull(空枠)として扱う', () => {
    const result = validateSaveData({ loadout: ['h5', '', 42, null, {}, 'v3', null, null] });
    expect(result.loadout).toEqual(['h5', null, null, null, null, 'v3', null, null]);
  });

  it('version は常に現在のバージョン(1)に正規化される', () => {
    const result = validateSaveData({ version: 999 });
    expect(result.version).toBe(SAVE_DATA_VERSION);
  });
});

describe('loadSaveData / saveSaveData(localStorage経由の読み書き)', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string): string | null => store.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          store.set(key, value);
        },
        removeItem: (key: string): void => {
          store.delete(key);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('localStorageに何も無ければ既定値を返す', () => {
    expect(loadSaveData()).toEqual(defaultSaveData());
  });

  it('saveSaveDataで保存した内容をloadSaveDataで復元できる(往復一致)', () => {
    const data = {
      version: 1 as const,
      wallet: 7,
      collected: { stage02: [1, 3] },
      upgrades: { hp: 1, speed: 0, jump: 2, manaRegen: 0, manaMax: 0 },
      unlockedTerrainIds: ['h3'],
      loadout: ['h5', 'v3', 'u', null, null, null, null, null],
      clearedStageIds: ['stage01'],
    };
    saveSaveData(data);
    expect(loadSaveData()).toEqual(data);
    expect(store.has(SAVE_DATA_STORAGE_KEY)).toBe(true);
  });

  it('localStorageの内容が壊れたJSON文字列の場合、例外を投げず既定値にフォールバックする', () => {
    store.set(SAVE_DATA_STORAGE_KEY, '{not valid json');
    expect(loadSaveData()).toEqual(defaultSaveData());
  });

  it('localStorageの内容が有効なJSONだが不正な形(配列等)の場合も既定値にフォールバックする', () => {
    store.set(SAVE_DATA_STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadSaveData()).toEqual(defaultSaveData());
  });
});
