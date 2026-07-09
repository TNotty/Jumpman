// ステージ/地形マスタJSONの型+手書きバリデーション(zod等は不使用)。
import type { CheckpointDefinition, CoinDefinition, EnemyDefinition, ManaConfig, StageData, TerrainDefinition, TerrainMaster, Vec2 } from '../core/types';
import { EnemyType } from '../core/types';

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface ValidationFailure {
  ok: false;
  errors: string[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const VALID_TILE_CHARS = new Set(['.', 'N', 'B', 'S', 'F']);
const VALID_ENEMY_TYPES: ReadonlySet<string> = new Set(Object.values(EnemyType));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validatePoint(
  value: unknown,
  field: string,
  width: number,
  height: number,
  errors: string[],
): Vec2 {
  if (!isObject(value) || !isFiniteNumber(value['x']) || !isFiniteNumber(value['y'])) {
    errors.push(`${field} は { x: number, y: number } である必要があります`);
    return { x: 0, y: 0 };
  }
  const x = value['x'];
  const y = value['y'];
  if (x < 0 || x >= width) {
    errors.push(`${field}.x はステージ幅(0〜${width - 1})の範囲内である必要があります: ${x}`);
  }
  if (y < 0 || y >= height) {
    errors.push(`${field}.y はステージ高さ(0〜${height - 1})の範囲内である必要があります: ${y}`);
  }
  return { x, y };
}

function validateCheckpoints(
  value: unknown,
  width: number,
  height: number,
  errors: string[],
): CheckpointDefinition[] {
  if (!Array.isArray(value)) {
    errors.push('checkpoints は配列である必要があります');
    return [];
  }
  return value.map((entry, index) => validatePoint(entry, `checkpoints[${index}]`, width, height, errors));
}

/**
 * コイン配置。枚数は5枚を推奨するが、スキーマ自体は0枚以上を許容する(枚数チェックは
 * エディタ側の警告表示に委ねる)。coinsフィールド自体が無い場合(後方互換: coins追加前の
 * ステージJSON)は空配列として扱う。
 */
function validateCoins(value: unknown, width: number, height: number, errors: string[]): CoinDefinition[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('coins は配列である必要があります');
    return [];
  }
  return value.map((entry, index) => validatePoint(entry, `coins[${index}]`, width, height, errors));
}

function validateEnemies(
  value: unknown,
  width: number,
  height: number,
  errors: string[],
): EnemyDefinition[] {
  if (!Array.isArray(value)) {
    errors.push('enemies は配列である必要があります');
    return [];
  }
  const result: EnemyDefinition[] = [];
  value.forEach((entry, index) => {
    const field = `enemies[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${field} はオブジェクトである必要があります`);
      return;
    }
    const type = entry['type'];
    if (typeof type !== 'string' || !VALID_ENEMY_TYPES.has(type)) {
      errors.push(`${field}.type は ${Array.from(VALID_ENEMY_TYPES).join('/')} のいずれかである必要があります: ${String(type)}`);
      return;
    }
    const point = validatePoint(entry, field, width, height, errors);
    const dir = entry['dir'];
    if (dir !== 1 && dir !== -1) {
      errors.push(`${field}.dir は 1 または -1 である必要があります: ${String(dir)}`);
      return;
    }
    result.push({ type: type as EnemyType, x: point.x, y: point.y, dir });
  });
  return result;
}

function validateMana(value: unknown, errors: string[]): ManaConfig {
  if (
    !isObject(value) ||
    !isFiniteNumber(value['initial']) ||
    !isFiniteNumber(value['max']) ||
    !isFiniteNumber(value['regenPerSec'])
  ) {
    errors.push('mana は { initial: number, max: number, regenPerSec: number } である必要があります');
    return { initial: 0, max: 0, regenPerSec: 0 };
  }
  const initial = value['initial'];
  const max = value['max'];
  const regenPerSec = value['regenPerSec'];
  if (initial < 0) errors.push('mana.initial は 0 以上である必要があります');
  if (max < 0) errors.push('mana.max は 0 以上である必要があります');
  if (regenPerSec < 0) errors.push('mana.regenPerSec は 0 以上である必要があります');
  if (initial > max) errors.push('mana.initial は mana.max 以下である必要があります');
  return { initial, max, regenPerSec };
}

function validateTiles(value: unknown, width: number, height: number, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push('tiles は配列である必要があります');
    return [];
  }
  if (value.length !== height) {
    errors.push(`tiles の行数(${value.length})が height(${height})と一致しません`);
  }
  const rows: string[] = [];
  value.forEach((row, y) => {
    if (typeof row !== 'string') {
      errors.push(`tiles[${y}] は文字列である必要があります`);
      rows.push('');
      return;
    }
    if (row.length !== width) {
      errors.push(`tiles[${y}] の長さ(${row.length})が width(${width})と一致しません`);
    }
    for (let x = 0; x < row.length; x++) {
      const char = row[x];
      if (char !== undefined && !VALID_TILE_CHARS.has(char)) {
        errors.push(`tiles[${y}][${x}] は不正なタイル文字です: '${char}'`);
      }
    }
    rows.push(row);
  });
  return rows;
}

/** 未検証の値(JSON.parse直後)をステージデータとして検証する */
export function validateStage(data: unknown): ValidationResult<StageData> {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { ok: false, errors: ['ステージデータはオブジェクトである必要があります'] };
  }

  if (data['version'] !== 1) {
    errors.push(`version は 1 である必要があります: ${String(data['version'])}`);
  }
  if (!isNonEmptyString(data['id'])) {
    errors.push('id は空でない文字列である必要があります');
  }
  if (!isNonEmptyString(data['name'])) {
    errors.push('name は空でない文字列である必要があります');
  }
  if (!isNonEmptyString(data['theme'])) {
    errors.push('theme は空でない文字列である必要があります');
  }

  const width = isFiniteNumber(data['width']) && data['width'] > 0 ? data['width'] : 0;
  if (width <= 0) {
    errors.push('width は正の数値である必要があります');
  }
  const height = isFiniteNumber(data['height']) && data['height'] > 0 ? data['height'] : 0;
  if (height <= 0) {
    errors.push('height は正の数値である必要があります');
  }

  const tiles = validateTiles(data['tiles'], width, height, errors);
  const start = validatePoint(data['start'], 'start', width, height, errors);
  const goal = validatePoint(data['goal'], 'goal', width, height, errors);
  const checkpoints = validateCheckpoints(data['checkpoints'], width, height, errors);
  const enemies = validateEnemies(data['enemies'], width, height, errors);
  const mana = validateMana(data['mana'], errors);
  const coins = validateCoins(data['coins'], width, height, errors);

  const eraseCost = data['eraseCost'];
  if (!isFiniteNumber(eraseCost) || eraseCost < 0) {
    errors.push('eraseCost は 0 以上の数値である必要があります');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      version: 1,
      id: data['id'] as string,
      name: data['name'] as string,
      theme: data['theme'] as string,
      width,
      height,
      tiles,
      start,
      goal,
      checkpoints,
      enemies,
      mana,
      eraseCost: eraseCost as number,
      coins,
    },
  };
}

function validateTerrainGrid(value: unknown, field: string, errors: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field}.grid は空でない配列である必要があります`);
    return [];
  }
  const width = typeof value[0] === 'string' ? value[0].length : 0;
  const rows: string[] = [];
  value.forEach((row, y) => {
    if (typeof row !== 'string' || row.length === 0) {
      errors.push(`${field}.grid[${y}] は空でない文字列である必要があります`);
      rows.push('');
      return;
    }
    if (row.length !== width) {
      errors.push(`${field}.grid[${y}] の長さ(${row.length})が1行目(${width})と一致しません`);
    }
    for (let x = 0; x < row.length; x++) {
      const char = row[x];
      if (char !== undefined && !VALID_TILE_CHARS.has(char)) {
        errors.push(`${field}.grid[${y}][${x}] は不正なタイル文字です: '${char}'`);
      }
    }
    rows.push(row);
  });
  return rows;
}

function validateTerrainDefinition(value: unknown, index: number, errors: string[]): TerrainDefinition | null {
  const field = `terrains[${index}]`;
  if (!isObject(value)) {
    errors.push(`${field} はオブジェクトである必要があります`);
    return null;
  }
  const id = value['id'];
  const name = value['name'];
  const cost = value['cost'];
  const unlocked = value['unlocked'];
  // unlockCost は後方互換のため無ければ0扱い(既存の同梱terrainMaster.jsonにこのフィールドが
  // 追加される前のカスタムJSON・オートセーブ済みドラフトを読み込んでも壊れないようにするため)。
  const unlockCostRaw = value['unlockCost'];
  const unlockCost = unlockCostRaw === undefined ? 0 : unlockCostRaw;

  if (!isNonEmptyString(id)) errors.push(`${field}.id は空でない文字列である必要があります`);
  if (!isNonEmptyString(name)) errors.push(`${field}.name は空でない文字列である必要があります`);
  if (!isFiniteNumber(cost) || cost < 0) errors.push(`${field}.cost は0以上の数値である必要があります`);
  if (typeof unlocked !== 'boolean') errors.push(`${field}.unlocked は真偽値である必要があります`);
  if (!isFiniteNumber(unlockCost) || unlockCost < 0) errors.push(`${field}.unlockCost は0以上の数値である必要があります`);

  const grid = validateTerrainGrid(value['grid'], field, errors);

  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(name) ||
    !isFiniteNumber(cost) ||
    cost < 0 ||
    typeof unlocked !== 'boolean' ||
    !isFiniteNumber(unlockCost) ||
    unlockCost < 0 ||
    grid.length === 0
  ) {
    return null;
  }

  return { id, name, cost, unlocked, unlockCost, grid };
}

/** 未検証の値(JSON.parse直後)を地形マスタデータとして検証する */
export function validateTerrainMaster(data: unknown): ValidationResult<TerrainMaster> {
  const errors: string[] = [];

  if (!isObject(data)) {
    return { ok: false, errors: ['地形マスタデータはオブジェクトである必要があります'] };
  }

  if (data['version'] !== 1) {
    errors.push(`version は 1 である必要があります: ${String(data['version'])}`);
  }

  const terrainsRaw = data['terrains'];
  if (!Array.isArray(terrainsRaw)) {
    errors.push('terrains は配列である必要があります');
    return { ok: false, errors };
  }

  const terrains: TerrainDefinition[] = [];
  const seenIds = new Set<string>();
  terrainsRaw.forEach((entry, index) => {
    const terrain = validateTerrainDefinition(entry, index, errors);
    if (terrain === null) return;
    if (seenIds.has(terrain.id)) {
      errors.push(`terrains[${index}].id が重複しています: ${terrain.id}`);
      return;
    }
    seenIds.add(terrain.id);
    terrains.push(terrain);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { version: 1, terrains } };
}
