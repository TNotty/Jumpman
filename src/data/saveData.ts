// セーブデータのスキーマ+検証+デフォルト値+読み書き(app層専用。core層はこれを直接知らない)。
// v5-2で追加される強化画面(upgrades)もこのスキーマにそのまま乗る。versionはスキーマの
// 互換性マイグレーション用(将来値が変わる際、ここでversion別の変換関数を分岐させる想定。
// 現時点ではv1のみなので分岐は無い)。
//
// data/schema.ts(ステージ/地形マスタJSON用)とは検証方針が異なる点に注意:
// schema.tsはユーザー作成コンテンツ(エディタで作る/読み込むファイル)を対象にしており、
// 不正な値は errors を伴って「拒否」する(作者に直させる)。
// 対してセーブデータはアプリ内部の永続状態であり、壊れていてもユーザーをブロックしてはならない
// ため、フィールド単位で既定値へ寛容にフォールバックする(絶対に例外を投げない・全体を
// 握りつぶさない)方針にしている。
import { loadJSON, saveJSON } from '../platform/storage';

export const SAVE_DATA_STORAGE_KEY = 'jumpman:save';
export const SAVE_DATA_VERSION = 1;

export interface SaveDataUpgrades {
  hp: number;
  speed: number;
  jump: number;
  manaRegen: number;
  manaMax: number;
}

/** パレット8枠固定。各要素は地形ID、または空枠を表すnull */
export type Loadout = (string | null)[];

export const LOADOUT_SIZE = 8;

export interface SaveData {
  version: 1;
  wallet: number;
  /** ステージIDごとに取得済みコインのindex配列(重複無し、昇順) */
  collected: Record<string, number[]>;
  upgrades: SaveDataUpgrades;
  unlockedTerrainIds: string[];
  loadout: Loadout;
  /**
   * クリア済みステージIDの一覧(重複無し、順不同)。ステージ選択画面のアンロック判定
   * (クリア済み + 未クリアの最初の1つだけ選択可能)に使う。既存セーブ(このフィールドが
   * 追加される前)は空配列扱い(=stage01のみ選択可能から再開する、後方互換)。
   */
  clearedStageIds: string[];
}

const DEFAULT_UPGRADES: SaveDataUpgrades = { hp: 0, speed: 0, jump: 0, manaRegen: 0, manaMax: 0 };
const DEFAULT_LOADOUT: Loadout = ['h5', 'v3', 'u', null, null, null, null, null];

/** 既定のセーブデータ(初回起動・破損データのフォールバック先) */
export function defaultSaveData(): SaveData {
  return {
    version: SAVE_DATA_VERSION,
    wallet: 0,
    collected: {},
    upgrades: { ...DEFAULT_UPGRADES },
    unlockedTerrainIds: [],
    loadout: [...DEFAULT_LOADOUT],
    clearedStageIds: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateUpgrades(value: unknown): SaveDataUpgrades {
  if (!isObject(value)) return { ...DEFAULT_UPGRADES };
  const pick = (key: keyof SaveDataUpgrades): number =>
    isNonNegativeFiniteNumber(value[key]) ? (value[key] as number) : DEFAULT_UPGRADES[key];
  return {
    hp: pick('hp'),
    speed: pick('speed'),
    jump: pick('jump'),
    manaRegen: pick('manaRegen'),
    manaMax: pick('manaMax'),
  };
}

function validateCollected(value: unknown): Record<string, number[]> {
  if (!isObject(value)) return {};
  const result: Record<string, number[]> = {};
  for (const [stageId, rawIndices] of Object.entries(value)) {
    if (!Array.isArray(rawIndices)) continue;
    const indices = rawIndices.filter(
      (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0,
    );
    result[stageId] = Array.from(new Set(indices)).sort((a, b) => a - b);
  }
  return result;
}

function validateLoadout(value: unknown): Loadout {
  if (!Array.isArray(value)) return [...DEFAULT_LOADOUT];
  const loadout: Loadout = [];
  for (let i = 0; i < LOADOUT_SIZE; i++) {
    const entry: unknown = value[i];
    loadout.push(typeof entry === 'string' && entry.length > 0 ? entry : null);
  }
  return loadout;
}

function validateUnlockedTerrainIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return Array.from(new Set(ids));
}

/** clearedStageIds も unlockedTerrainIds と同じ形(空文字でない文字列配列、重複除去)なので検証ロジックを共有する */
function validateClearedStageIds(value: unknown): string[] {
  return validateUnlockedTerrainIds(value);
}

/**
 * 未検証の値(localStorageから読んだJSON.parse直後などの unknown)をセーブデータとして
 * 検証・正規化する。オブジェクトでない・フィールドが欠けている・型が違う等、壊れている場合でも
 * 例外を投げず、壊れたフィールドだけ既定値にフォールバックした有効な SaveData を返す
 * (セーブ全体を握りつぶして初期化してしまうことは避ける: 例えばwalletだけ壊れていても
 * loadoutは救出する)。
 */
export function validateSaveData(data: unknown): SaveData {
  const fallback = defaultSaveData();
  if (!isObject(data)) return fallback;
  return {
    version: SAVE_DATA_VERSION,
    wallet: isNonNegativeFiniteNumber(data['wallet']) ? data['wallet'] : fallback.wallet,
    collected: validateCollected(data['collected']),
    upgrades: validateUpgrades(data['upgrades']),
    unlockedTerrainIds: validateUnlockedTerrainIds(data['unlockedTerrainIds']),
    loadout: validateLoadout(data['loadout']),
    clearedStageIds: validateClearedStageIds(data['clearedStageIds']),
  };
}

/** localStorageからセーブデータを読み込む。存在しない/壊れている場合は既定値を返す(例外を投げない) */
export function loadSaveData(): SaveData {
  const raw = loadJSON<unknown>(SAVE_DATA_STORAGE_KEY);
  if (raw === null) return defaultSaveData();
  return validateSaveData(raw);
}

/** セーブデータをlocalStorageへ書き込む */
export function saveSaveData(data: SaveData): void {
  saveJSON(SAVE_DATA_STORAGE_KEY, data);
}
