// ステージ選択のアンロック判定(クリア済み + 未クリアの最初の1つだけが選択可能)を扱う純関数。
// core層はステージ選択/セーブの概念を知らないため、この判定はapp層に置く
// (loadout.tsと同じ責務分離: SaveData型そのものではなく、呼び出し側が取り出した
// clearedStageIds(文字列配列)とステージID順序だけを引数にする)。

/** orderedStageIds の並び順で見て、最初にクリアされていないステージIDを返す(全クリア済みならnull) */
export function firstUnclearedStageId(orderedStageIds: readonly string[], clearedStageIds: readonly string[]): string | null {
  const clearedSet = new Set(clearedStageIds);
  for (const id of orderedStageIds) {
    if (!clearedSet.has(id)) return id;
  }
  return null;
}

/**
 * 指定ステージが選択可能か(クリア済み、または未クリアの最初の1つ)。
 * 初期状態(clearedStageIds=[])では orderedStageIds の先頭(通常stage01)が
 * 「未クリアの最初の1つ」に該当するため、常に選択可能になる(特別扱い不要)。
 */
export function isStageSelectable(
  stageId: string,
  orderedStageIds: readonly string[],
  clearedStageIds: readonly string[],
): boolean {
  if (clearedStageIds.includes(stageId)) return true;
  return firstUnclearedStageId(orderedStageIds, clearedStageIds) === stageId;
}

/**
 * ゴール到達時にclearedStageIdsへstageIdを追加した新しい配列を返す(純関数)。
 * 既にクリア済みなら同じ内容の新しい配列をそのまま返す(重複追加しない、何度クリアしても
 * 増えない)。main.ts はこの関数の戻り値をSaveDataへ書き戻してsaveSaveData()するだけの
 * 薄いラッパーにする(DOM/localStorageに依存する箇所をこの純関数の外に押し出し、
 * 「クリア→次ステージ解放」の実際の判定ロジックを単体テストできるようにするため)。
 */
export function applyStageCleared(clearedStageIds: readonly string[], stageId: string): string[] {
  if (clearedStageIds.includes(stageId)) return [...clearedStageIds];
  return [...clearedStageIds, stageId];
}
