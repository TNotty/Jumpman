import { describe, expect, it } from 'vitest';
import { applyStageCleared, firstUnclearedStageId, isStageSelectable } from './stageUnlock';

const ORDER = ['stage01', 'stage02', 'stage03', 'stage04', 'stage05'];

describe('firstUnclearedStageId', () => {
  it('クリア済みが無ければ先頭(stage01)を返す', () => {
    expect(firstUnclearedStageId(ORDER, [])).toBe('stage01');
  });

  it('stage01のみクリア済みならstage02を返す', () => {
    expect(firstUnclearedStageId(ORDER, ['stage01'])).toBe('stage02');
  });

  it('全てクリア済みならnullを返す', () => {
    expect(firstUnclearedStageId(ORDER, [...ORDER])).toBeNull();
  });

  it('順不同・重複ありのclearedStageIdsでも正しく判定する', () => {
    expect(firstUnclearedStageId(ORDER, ['stage02', 'stage01', 'stage01'])).toBe('stage03');
  });
});

describe('isStageSelectable', () => {
  it('初期状態(クリア済み無し)ではstage01のみ選択可能', () => {
    expect(isStageSelectable('stage01', ORDER, [])).toBe(true);
    expect(isStageSelectable('stage02', ORDER, [])).toBe(false);
    expect(isStageSelectable('stage03', ORDER, [])).toBe(false);
  });

  it('stage01をクリア済みにすると、stage01(クリア済み)とstage02(次の1つ)が選択可能になる', () => {
    const cleared = ['stage01'];
    expect(isStageSelectable('stage01', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage02', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage03', ORDER, cleared)).toBe(false);
  });

  it('クリア済みステージは常に選択可能(後戻りしてやり直せる)', () => {
    const cleared = ['stage01', 'stage02', 'stage03'];
    expect(isStageSelectable('stage01', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage02', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage03', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage04', ORDER, cleared)).toBe(true); // 次の1つ
    expect(isStageSelectable('stage05', ORDER, cleared)).toBe(false); // まだ先
  });

  it('全ステージクリア済みなら全て選択可能', () => {
    expect(isStageSelectable('stage05', ORDER, [...ORDER])).toBe(true);
  });

  it('orderedStageIdsに存在しないIDは選択不可', () => {
    expect(isStageSelectable('does-not-exist', ORDER, [])).toBe(false);
  });
});

describe('applyStageCleared', () => {
  it('未クリアのステージIDを追加する', () => {
    expect(applyStageCleared([], 'stage01')).toEqual(['stage01']);
    expect(applyStageCleared(['stage01'], 'stage02')).toEqual(['stage01', 'stage02']);
  });

  it('既にクリア済みのステージIDは重複追加しない(同じ内容のまま)', () => {
    expect(applyStageCleared(['stage01', 'stage02'], 'stage01')).toEqual(['stage01', 'stage02']);
  });

  it('引数の配列を書き換えない(新しい配列を返す)', () => {
    const before = ['stage01'];
    const after = applyStageCleared(before, 'stage02');
    expect(before).toEqual(['stage01']);
    expect(after).toEqual(['stage01', 'stage02']);
    expect(after).not.toBe(before);
  });
});

describe('クリア→解放の統合(applyStageCleared → isStageSelectable)', () => {
  it('初期状態ではstage01のみ選択可能。stage01クリア後はstage02も選択可能になる', () => {
    let cleared: string[] = [];
    expect(isStageSelectable('stage01', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage02', ORDER, cleared)).toBe(false);

    cleared = applyStageCleared(cleared, 'stage01');
    expect(isStageSelectable('stage01', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage02', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage03', ORDER, cleared)).toBe(false);
  });

  it('順番にクリアしていくと、その都度次のステージだけが新たに解放される(全10本相当の連鎖)', () => {
    const order = Array.from({ length: 10 }, (_, i) => `stage${String(i + 1).padStart(2, '0')}`);
    let cleared: string[] = [];
    for (let i = 0; i < order.length; i++) {
      const stageId = order[i];
      if (stageId === undefined) continue;
      // クリアする前は選択可能(=未クリアの最初の1つ)、クリア後も引き続き選択可能(クリア済み)
      expect(isStageSelectable(stageId, order, cleared), `${stageId} クリア前`).toBe(true);
      cleared = applyStageCleared(cleared, stageId);
      expect(isStageSelectable(stageId, order, cleared), `${stageId} クリア後`).toBe(true);

      // クリア直後は「次の1つ」だけが新たに解放され、その先(2つ以上先)はまだロックのまま
      const next = order[i + 1];
      if (next !== undefined) {
        expect(isStageSelectable(next, order, cleared), `${next} はクリア直後に解放されるはず`).toBe(true);
      }
      const afterNext = order[i + 2];
      if (afterNext !== undefined) {
        expect(isStageSelectable(afterNext, order, cleared), `${afterNext} はまだ解放されていないはず`).toBe(false);
      }
    }
    expect(cleared).toEqual(order);
  });

  it('同じステージを2回クリアしても、次のステージの解放状態は変わらない(冪等)', () => {
    let cleared: string[] = [];
    cleared = applyStageCleared(cleared, 'stage01');
    cleared = applyStageCleared(cleared, 'stage01'); // 2回目(既にクリア済み)
    expect(cleared).toEqual(['stage01']);
    expect(isStageSelectable('stage02', ORDER, cleared)).toBe(true);
    expect(isStageSelectable('stage03', ORDER, cleared)).toBe(false);
  });
});
