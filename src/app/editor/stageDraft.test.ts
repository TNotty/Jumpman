import { describe, expect, it } from 'vitest';
import {
  createBlankDraft,
  eraseAt,
  fromStageData,
  getTile,
  isStageDraftLike,
  resizeDraft,
  setGoal,
  setStart,
  setTile,
  toStageData,
  toggleCheckpoint,
  toggleEnemy,
  updateMana,
  updateMeta,
} from './stageDraft';
import { validateStage } from '../../data/schema';
import { BlockType, EnemyType } from '../../core/types';

describe('createBlankDraft', () => {
  it('指定サイズの空タイル・未配置のスタート/ゴールで初期化する', () => {
    const draft = createBlankDraft('s1', 5, 3);
    expect(draft.width).toBe(5);
    expect(draft.height).toBe(3);
    expect(draft.tiles).toEqual(['.....', '.....', '.....']);
    expect(draft.start).toBeNull();
    expect(draft.goal).toBeNull();
    expect(draft.checkpoints).toEqual([]);
    expect(draft.enemies).toEqual([]);
  });
});

describe('setTile / getTile', () => {
  it('セルを設定し、同じ値を読み出せる', () => {
    let draft = createBlankDraft('s1', 5, 3);
    draft = setTile(draft, 2, 1, BlockType.Breakable);
    expect(getTile(draft, 2, 1)).toBe(BlockType.Breakable);
    expect(draft.tiles[1]).toBe('..B..');
  });

  it('範囲外は無視される(同一参照を返す)', () => {
    const draft = createBlankDraft('s1', 5, 3);
    const result = setTile(draft, 99, 99, BlockType.Normal);
    expect(result).toBe(draft);
  });
});

describe('setStart / setGoal', () => {
  it('1個のみ保持し、再設定で移動する', () => {
    let draft = createBlankDraft('s1', 10, 5);
    draft = setStart(draft, { x: 1, y: 1 });
    expect(draft.start).toEqual({ x: 1, y: 1 });
    draft = setStart(draft, { x: 3, y: 2 });
    expect(draft.start).toEqual({ x: 3, y: 2 }); // 移動(1個のみ)
  });

  it('ゴールも同様に1個のみ保持する', () => {
    let draft = createBlankDraft('s1', 10, 5);
    draft = setGoal(draft, { x: 8, y: 4 });
    draft = setGoal(draft, { x: 9, y: 4 });
    expect(draft.goal).toEqual({ x: 9, y: 4 });
  });
});

describe('toggleCheckpoint / toggleEnemy', () => {
  it('同じセルをもう一度指定すると削除される(トグル)', () => {
    let draft = createBlankDraft('s1', 10, 5);
    draft = toggleCheckpoint(draft, { x: 4, y: 2 });
    expect(draft.checkpoints).toEqual([{ x: 4, y: 2 }]);
    draft = toggleCheckpoint(draft, { x: 4, y: 2 });
    expect(draft.checkpoints).toEqual([]);
  });

  it('敵は種別付きで配置・削除できる', () => {
    let draft = createBlankDraft('s1', 10, 5);
    draft = toggleEnemy(draft, { x: 4, y: 2 }, EnemyType.Frog);
    expect(draft.enemies).toEqual([{ type: EnemyType.Frog, x: 4, y: 2, dir: -1 }]);
    draft = toggleEnemy(draft, { x: 4, y: 2 }, EnemyType.Bird);
    expect(draft.enemies).toEqual([]); // 既存を削除(種別は問わない)
  });
});

describe('eraseAt', () => {
  it('ブロック・スタート/ゴール/チェックポイント/敵をまとめて消去する', () => {
    let draft = createBlankDraft('s1', 10, 5);
    draft = setTile(draft, 3, 3, BlockType.Normal);
    draft = setStart(draft, { x: 3, y: 3 });
    draft = toggleCheckpoint(draft, { x: 3, y: 3 });
    draft = toggleEnemy(draft, { x: 3, y: 3 }, EnemyType.Slime);

    draft = eraseAt(draft, { x: 3, y: 3 });

    expect(getTile(draft, 3, 3)).toBe(BlockType.Empty);
    expect(draft.start).toBeNull();
    expect(draft.checkpoints).toEqual([]);
    expect(draft.enemies).toEqual([]);
  });
});

describe('resizeDraft', () => {
  it('縮小: タイルを切り詰め、範囲外に出たエンティティを取り除く', () => {
    let draft = createBlankDraft('s1', 10, 5);
    draft = setTile(draft, 8, 4, BlockType.Normal);
    draft = setStart(draft, { x: 1, y: 1 });
    draft = setGoal(draft, { x: 9, y: 4 }); // 縮小後に範囲外になる
    draft = toggleCheckpoint(draft, { x: 9, y: 0 }); // 縮小後に範囲外になる

    // 高さはMIN_DRAFT_SIZE(4)未満を指定してもclampされるため、あえて4を指定する
    draft = resizeDraft(draft, 5, 4);

    expect(draft.width).toBe(5);
    expect(draft.height).toBe(4);
    expect(draft.tiles).toHaveLength(4);
    expect(draft.tiles.every((row) => row.length === 5)).toBe(true);
    expect(draft.start).toEqual({ x: 1, y: 1 }); // 範囲内なので保持
    expect(draft.goal).toBeNull(); // 範囲外(x=9はwidth5の範囲外)なので消える
    expect(draft.checkpoints).toEqual([]); // 範囲外(x=9はwidth5の範囲外)なので消える
  });

  it('拡大: 既存タイルを保持し、拡張部分は空で埋める', () => {
    let draft = createBlankDraft('s1', 4, 2);
    draft = setTile(draft, 1, 1, BlockType.Spike);

    draft = resizeDraft(draft, 6, 4);

    expect(draft.width).toBe(6);
    expect(draft.height).toBe(4);
    expect(getTile(draft, 1, 1)).toBe(BlockType.Spike); // 既存内容は保持
    expect(draft.tiles[0]).toBe('......');
    expect(draft.tiles[3]).toBe('......'); // 拡張された行は空
  });

  it('最小・最大サイズにclampする', () => {
    const draft = createBlankDraft('s1', 10, 10);
    const tooSmall = resizeDraft(draft, 0, -5);
    expect(tooSmall.width).toBeGreaterThanOrEqual(4);
    expect(tooSmall.height).toBeGreaterThanOrEqual(4);
    const tooBig = resizeDraft(draft, 100000, 100000);
    expect(tooBig.width).toBeLessThanOrEqual(400);
    expect(tooBig.height).toBeLessThanOrEqual(400);
  });
});

describe('updateMeta / updateMana', () => {
  it('メタ情報とマナ設定を部分更新できる', () => {
    let draft = createBlankDraft('s1', 10, 5);
    draft = updateMeta(draft, { name: 'テスト用ステージ', theme: 'cave' });
    draft = updateMana(draft, { max: 80 });
    expect(draft.name).toBe('テスト用ステージ');
    expect(draft.theme).toBe('cave');
    expect(draft.mana).toEqual({ initial: 10, max: 80, regenPerSec: 1 });
  });
});

describe('toStageData', () => {
  it('スタート/ゴール未設定はエラーになる(スキーマ検証に進まない)', () => {
    const draft = createBlankDraft('s1', 10, 5);
    const result = toStageData(draft);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('スタート'))).toBe(true);
    expect(result.errors.some((e) => e.includes('ゴール'))).toBe(true);
  });

  it('妥当なドラフトは validateStage を通る StageData になる(スキーマ往復)', () => {
    let draft = createBlankDraft('roundtrip', 10, 5);
    draft = setTile(draft, 0, 4, BlockType.Normal);
    draft = setTile(draft, 9, 4, BlockType.Normal);
    draft = setStart(draft, { x: 0, y: 3 });
    draft = setGoal(draft, { x: 9, y: 3 });
    draft = updateMeta(draft, { name: '往復テスト' });

    const result = toStageData(draft);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    if (!result.ok || !result.value) return;

    // 出力されたStageDataを実際にvalidateStageへ通しても成功する(二重に確認)
    const revalidated = validateStage(result.value);
    expect(revalidated.ok).toBe(true);
  });

  it('fromStageDataで読み込んだ内容はtoStageDataで元と同じ内容に往復できる', () => {
    let seed = createBlankDraft('seed', 8, 6);
    seed = setTile(seed, 0, 5, BlockType.Normal);
    seed = setTile(seed, 7, 5, BlockType.Normal);
    seed = setStart(seed, { x: 0, y: 4 });
    seed = setGoal(seed, { x: 7, y: 4 });
    seed = toggleCheckpoint(seed, { x: 3, y: 4 });
    seed = toggleEnemy(seed, { x: 4, y: 4 }, EnemyType.Bird);

    const firstResult = toStageData(seed);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok || !firstResult.value) return;

    const reloaded = fromStageData(firstResult.value);
    const secondResult = toStageData(reloaded);
    expect(secondResult.ok).toBe(true);
    expect(secondResult.value).toEqual(firstResult.value);
  });
});

describe('isStageDraftLike', () => {
  it('createBlankDraftの出力(start/goal未設定)を受理する', () => {
    expect(isStageDraftLike(createBlankDraft('s1', 5, 5))).toBe(true);
  });

  it('壊れたデータ(必須フィールド欠落・別の型)は拒否する', () => {
    expect(isStageDraftLike(null)).toBe(false);
    expect(isStageDraftLike('not an object')).toBe(false);
    expect(isStageDraftLike({})).toBe(false);
    expect(isStageDraftLike({ id: 's1', name: 'x' })).toBe(false); // 他フィールド欠落
  });
});
