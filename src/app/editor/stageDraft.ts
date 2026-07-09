// マップエディタの編集中データ(StageDraft)を扱う純関数群。DOM/Canvasには一切依存しない
// (テスト可能な形に切り出す)。保存時は toStageData() で core/data/schema.ts の validateStage を
// 通した StageData に変換する。core/grid.ts・core/types.ts の型・文字凡例をそのまま再利用する。
import { validateStage } from '../../data/schema';
import { BLOCK_CHAR_MAP, BLOCK_TYPE_CHAR, BlockType } from '../../core/types';
import type { CheckpointDefinition, CoinDefinition, EnemyDefinition, EnemyType, StageData, Vec2 } from '../../core/types';

/** コインの推奨枚数。エディタはこの枚数と異なる場合に警告を出す(保存/テストプレイ自体はブロックしない) */
export const RECOMMENDED_COIN_COUNT = 5;

/**
 * 編集中のステージ。StageData とほぼ同形だが、start/goal は未配置(null)を許容する。
 * 保存(toStageData)時に未配置であればエラーとして報告する。
 */
export interface StageDraft {
  version: 1;
  id: string;
  name: string;
  theme: string;
  width: number;
  height: number;
  /** BLOCK_CHAR_MAP の文字による行文字列配列。常に height行×width文字を維持する */
  tiles: string[];
  start: Vec2 | null;
  goal: Vec2 | null;
  checkpoints: CheckpointDefinition[];
  enemies: EnemyDefinition[];
  coins: CoinDefinition[];
  mana: { initial: number; max: number; regenPerSec: number };
  eraseCost: number;
}

export const DEFAULT_DRAFT_WIDTH = 30;
export const DEFAULT_DRAFT_HEIGHT = 12;
export const MIN_DRAFT_SIZE = 4;
export const MAX_DRAFT_SIZE = 400;

function blankRow(width: number): string {
  return '.'.repeat(width);
}

function blankTiles(width: number, height: number): string[] {
  return Array.from({ length: height }, () => blankRow(width));
}

export function createBlankDraft(id = 'new_stage', width = DEFAULT_DRAFT_WIDTH, height = DEFAULT_DRAFT_HEIGHT): StageDraft {
  return {
    version: 1,
    id,
    name: '新しいステージ',
    theme: 'grass',
    width,
    height,
    tiles: blankTiles(width, height),
    start: null,
    goal: null,
    checkpoints: [],
    enemies: [],
    coins: [],
    mana: { initial: 10, max: 50, regenPerSec: 1 },
    eraseCost: 3,
  };
}

/** 既存の StageData を編集用ドラフトへ変換する(読込時に使用) */
export function fromStageData(data: StageData): StageDraft {
  return {
    version: 1,
    id: data.id,
    name: data.name,
    theme: data.theme,
    width: data.width,
    height: data.height,
    tiles: [...data.tiles],
    start: { ...data.start },
    goal: { ...data.goal },
    checkpoints: data.checkpoints.map((cp) => ({ ...cp })),
    enemies: data.enemies.map((enemy) => ({ ...enemy })),
    coins: data.coins.map((coin) => ({ ...coin })),
    mana: { ...data.mana },
    eraseCost: data.eraseCost,
  };
}

function inBounds(draft: StageDraft, x: number, y: number): boolean {
  return x >= 0 && x < draft.width && y >= 0 && y < draft.height;
}

function withinGrid(point: Vec2 | null, width: number, height: number): boolean {
  return point !== null && point.x >= 0 && point.x < width && point.y >= 0 && point.y < height;
}

/**
 * 幅・高さを変更する。既存タイルは左上を基準に保持し、はみ出す部分は切り詰め、
 * 拡張した部分は空('.')で埋める。範囲外に出たスタート/ゴール/チェックポイント/敵は取り除く。
 */
export function resizeDraft(draft: StageDraft, width: number, height: number): StageDraft {
  const nextWidth = Math.max(MIN_DRAFT_SIZE, Math.min(MAX_DRAFT_SIZE, Math.floor(width)));
  const nextHeight = Math.max(MIN_DRAFT_SIZE, Math.min(MAX_DRAFT_SIZE, Math.floor(height)));

  const tiles: string[] = [];
  for (let y = 0; y < nextHeight; y++) {
    const sourceRow = draft.tiles[y] ?? '';
    let row = sourceRow.slice(0, nextWidth);
    if (row.length < nextWidth) {
      row += blankRow(nextWidth - row.length);
    }
    tiles.push(row);
  }

  return {
    ...draft,
    width: nextWidth,
    height: nextHeight,
    tiles,
    start: withinGrid(draft.start, nextWidth, nextHeight) ? draft.start : null,
    goal: withinGrid(draft.goal, nextWidth, nextHeight) ? draft.goal : null,
    checkpoints: draft.checkpoints.filter((cp) => withinGrid(cp, nextWidth, nextHeight)),
    enemies: draft.enemies.filter((enemy) => withinGrid(enemy, nextWidth, nextHeight)),
  };
}

function replaceRowChar(row: string, x: number, char: string): string {
  return row.slice(0, x) + char + row.slice(x + 1);
}

/** 1マスにブロック(通常/壊れる/トゲ/落ちる/空)を設定する */
export function setTile(draft: StageDraft, x: number, y: number, type: BlockType): StageDraft {
  if (!inBounds(draft, x, y)) return draft;
  const char = BLOCK_TYPE_CHAR[type];
  const row = draft.tiles[y];
  if (row === undefined || row[x] === char) return draft;
  const tiles = [...draft.tiles];
  tiles[y] = replaceRowChar(row, x, char);
  return { ...draft, tiles };
}

export function getTile(draft: StageDraft, x: number, y: number): BlockType {
  if (!inBounds(draft, x, y)) return BlockType.Empty;
  const char = draft.tiles[y]?.[x] ?? '.';
  return BLOCK_CHAR_MAP[char] ?? BlockType.Empty;
}

/** スタート地点を設定する(1個のみ。既存があれば置き換える=移動) */
export function setStart(draft: StageDraft, point: Vec2): StageDraft {
  if (!inBounds(draft, point.x, point.y)) return draft;
  return { ...draft, start: { x: point.x, y: point.y } };
}

/** ゴール地点を設定する(1個のみ。既存があれば置き換える=移動) */
export function setGoal(draft: StageDraft, point: Vec2): StageDraft {
  if (!inBounds(draft, point.x, point.y)) return draft;
  return { ...draft, goal: { x: point.x, y: point.y } };
}

/** 指定セルに既にチェックポイントがあれば削除、無ければ追加する(クリックでトグル) */
export function toggleCheckpoint(draft: StageDraft, point: Vec2): StageDraft {
  if (!inBounds(draft, point.x, point.y)) return draft;
  const existingIndex = draft.checkpoints.findIndex((cp) => cp.x === point.x && cp.y === point.y);
  if (existingIndex >= 0) {
    const checkpoints = draft.checkpoints.filter((_, i) => i !== existingIndex);
    return { ...draft, checkpoints };
  }
  return { ...draft, checkpoints: [...draft.checkpoints, { x: point.x, y: point.y }] };
}

/** 指定セルに既に敵がいれば削除、無ければ指定種別の敵を追加する(クリックでトグル) */
export function toggleEnemy(draft: StageDraft, point: Vec2, type: EnemyType): StageDraft {
  if (!inBounds(draft, point.x, point.y)) return draft;
  const existingIndex = draft.enemies.findIndex((e) => e.x === point.x && e.y === point.y);
  if (existingIndex >= 0) {
    const enemies = draft.enemies.filter((_, i) => i !== existingIndex);
    return { ...draft, enemies };
  }
  return { ...draft, enemies: [...draft.enemies, { type, x: point.x, y: point.y, dir: -1 }] };
}

/** 指定セルに既にコインがあれば削除、無ければ追加する(クリック単発配置・再クリックで削除のトグル) */
export function toggleCoin(draft: StageDraft, point: Vec2): StageDraft {
  if (!inBounds(draft, point.x, point.y)) return draft;
  const existingIndex = draft.coins.findIndex((c) => c.x === point.x && c.y === point.y);
  if (existingIndex >= 0) {
    const coins = draft.coins.filter((_, i) => i !== existingIndex);
    return { ...draft, coins };
  }
  return { ...draft, coins: [...draft.coins, { x: point.x, y: point.y }] };
}

/** ブロック・スタート/ゴール/チェックポイント/敵/コインをまとめて消去する(消しゴム・右クリック消去用) */
export function eraseAt(draft: StageDraft, point: Vec2): StageDraft {
  if (!inBounds(draft, point.x, point.y)) return draft;
  let next = setTile(draft, point.x, point.y, BlockType.Empty);
  if (next.start && next.start.x === point.x && next.start.y === point.y) {
    next = { ...next, start: null };
  }
  if (next.goal && next.goal.x === point.x && next.goal.y === point.y) {
    next = { ...next, goal: null };
  }
  if (next.checkpoints.some((cp) => cp.x === point.x && cp.y === point.y)) {
    next = { ...next, checkpoints: next.checkpoints.filter((cp) => !(cp.x === point.x && cp.y === point.y)) };
  }
  if (next.enemies.some((e) => e.x === point.x && e.y === point.y)) {
    next = { ...next, enemies: next.enemies.filter((e) => !(e.x === point.x && e.y === point.y)) };
  }
  if (next.coins.some((c) => c.x === point.x && c.y === point.y)) {
    next = { ...next, coins: next.coins.filter((c) => !(c.x === point.x && c.y === point.y)) };
  }
  return next;
}

export function updateMeta(
  draft: StageDraft,
  patch: Partial<Pick<StageDraft, 'id' | 'name' | 'theme' | 'eraseCost'>>,
): StageDraft {
  return { ...draft, ...patch };
}

export function updateMana(draft: StageDraft, patch: Partial<StageDraft['mana']>): StageDraft {
  return { ...draft, mana: { ...draft.mana, ...patch } };
}

export interface DraftToStageResult {
  ok: boolean;
  errors: string[];
  value?: StageData;
}

/**
 * ドラフトを保存可能な StageData に変換する。スタート/ゴール未配置はここで検出し、
 * それ以外の妥当性(タイル文字・範囲・マナ等)は schema.ts の validateStage に委譲する
 * (二重実装を避ける)。
 */
export function toStageData(draft: StageDraft): DraftToStageResult {
  const errors: string[] = [];
  if (!draft.start) errors.push('スタート地点が設定されていません');
  if (!draft.goal) errors.push('ゴール地点が設定されていません');
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const candidate = {
    version: 1,
    id: draft.id,
    name: draft.name,
    theme: draft.theme,
    width: draft.width,
    height: draft.height,
    tiles: draft.tiles,
    start: draft.start,
    goal: draft.goal,
    checkpoints: draft.checkpoints,
    enemies: draft.enemies,
    coins: draft.coins,
    mana: draft.mana,
    eraseCost: draft.eraseCost,
  };

  const result = validateStage(candidate);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, errors: [], value: result.value };
}

/**
 * 構造的なゆるいガード(オートセーブからの読込専用)。StageDraft は start/goal が null
 * を許容するなど validateStage の対象外の形をとるため、フルスキーマ検証(validateStage)は
 * 使わず、破損データでクラッシュしない程度の最小限の形チェックのみ行う。
 * coinsフィールドが無い(coins追加前の)古いオートセーブは意図的にfalseを返し、
 * createBlankDraft()にフォールバックさせる(coins無しのStageDraftをそのまま信用してしまうと
 * 後続処理がdraft.coinsに触れた際にクラッシュしうるため)。
 */
export function isStageDraftLike(value: unknown): value is StageDraft {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['id'] === 'string' &&
    typeof v['name'] === 'string' &&
    typeof v['theme'] === 'string' &&
    typeof v['width'] === 'number' &&
    typeof v['height'] === 'number' &&
    Array.isArray(v['tiles']) &&
    Array.isArray(v['checkpoints']) &&
    Array.isArray(v['enemies']) &&
    Array.isArray(v['coins']) &&
    typeof v['mana'] === 'object' &&
    v['mana'] !== null &&
    typeof v['eraseCost'] === 'number'
  );
}

export interface ResolveInitialDraftResult {
  draft: StageDraft;
  /** localStorageの editRequest キーを消去すべきか(存在した場合は成否に関わらず常にtrue) */
  shouldClearEditRequest: boolean;
  /** editRequestの検証に失敗した場合の警告文言(UIに表示する用)。無ければnull */
  warning: string | null;
}

/**
 * エディタ起動時、どのデータを初期ドラフトとして採用するかを決める純ロジック。
 * 優先順位: editRequest(ゲーム側の「エディタで開く」由来。あれば最優先で消去対象) →
 * オートセーブ(localStorage) → 空の新規ドラフト。
 * editRequestが存在すれば検証の成否に関わらず shouldClearEditRequest=true を返す
 * (壊れたeditRequestが残り続けて毎回警告が出るのを防ぎ、通常起動を汚さないため)。
 */
export function resolveInitialDraft(editRequestRaw: unknown, autosavedRaw: unknown): ResolveInitialDraftResult {
  if (editRequestRaw !== null && editRequestRaw !== undefined) {
    const result = validateStage(editRequestRaw);
    if (result.ok) {
      return { draft: fromStageData(result.value), shouldClearEditRequest: true, warning: null };
    }
    return {
      draft: resolveFromAutosave(autosavedRaw),
      shouldClearEditRequest: true,
      warning: `編集リクエストの読込に失敗したため、下書き/新規を使用します: ${result.errors.join(', ')}`,
    };
  }
  return { draft: resolveFromAutosave(autosavedRaw), shouldClearEditRequest: false, warning: null };
}

function resolveFromAutosave(autosavedRaw: unknown): StageDraft {
  if (autosavedRaw !== null && autosavedRaw !== undefined && isStageDraftLike(autosavedRaw)) {
    return autosavedRaw;
  }
  return createBlankDraft();
}
