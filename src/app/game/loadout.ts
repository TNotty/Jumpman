// セーブデータのloadout(8枠、地形IDまたはnull)を実際のTerrainDefinitionへ解決する純関数。
// core層はセーブ/loadoutの概念を一切知らない(GameState.terrainMasterは単に
// (TerrainDefinition|null)[]を受け取るだけ)。app層がここでloadoutを解決してから渡すことで、
// core層の純粋性を保つ。
//
// ロック判定はこの関数が一手に引き受ける(呼び出し側での反映漏れを構造的に防ぐため)。
// input.ts/core/game.ts/core/placement.tsはいずれもTerrainDefinition.unlockedフラグしか
// 見ないため、コインで解放した地形(save.unlockedTerrainIds)をパレットに含める場合は、
// ここで返すTerrainDefinitionのunlockedをtrueへ差し替えてから渡す必要がある。
import type { TerrainDefinition } from '../../core/types';
import { isTerrainUnlocked } from '../../core/upgrades';
import type { Loadout } from '../../data/saveData';

/**
 * loadoutの各スロット(地形IDまたはnull)を、渡された地形マスタ(id引き)から解決し、
 * 同じ長さの (TerrainDefinition | null)[] にする。
 * 次のいずれの場合も対応スロットは null(空枠。パレット上は選択不可)になる:
 * - loadoutのそのスロットが最初からnull(未設定の空枠)
 * - loadoutにIDはあるが、地形マスタにそのIDのエントリが存在しない
 *   (例: 地形マスタエディタでID変更/削除された後、古いloadoutが参照している場合の後方互換)
 *
 * unlockedTerrainIds(セーブデータでコイン解放済みの地形ID一覧)にIDが含まれる地形は、
 * 地形マスタ側のunlocked:falseに関わらず、返すTerrainDefinitionのunlockedをtrueにした
 * コピーへ差し替える(isTerrainUnlockedで判定)。これによりinput.ts/core側は従来どおり
 * .unlockedフラグだけを見ればよく、unlockedTerrainIdsを個別に意識する必要が無い。
 */
export function resolveLoadoutPalette(
  loadout: Loadout,
  terrainMaster: readonly TerrainDefinition[],
  unlockedTerrainIds: readonly string[] = [],
): (TerrainDefinition | null)[] {
  const byId = new Map(terrainMaster.map((terrain) => [terrain.id, terrain] as const));
  return loadout.map((id) => {
    if (id === null) return null;
    const terrain = byId.get(id);
    if (!terrain) return null;
    return isTerrainUnlocked(terrain, unlockedTerrainIds) ? { ...terrain, unlocked: true } : terrain;
  });
}
