// キャンバス論理座標(0..LOGICAL_WIDTH, 0..LOGICAL_HEIGHT)上の領域判定。
// タッチ操作はタッチ開始要素(キャンバス)でtouchmove/touchendが発火し続けるため、指がキャンバスの
// 外(あるいは論理座標でキャンバスの範囲外)へ出た状態で離した場合でも座標自体は計算できてしまう。
// そのまま地形生成/消去やパレット選択の判定に使うと、画面外で指を離しても配置が実行されてしまう
// バグになるため、判定を純関数として切り出し、input.ts側で'outside'を弾く。
import { GAME_AREA_HEIGHT, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './constants';

/**
 * 'game'   : ゲーム領域内(0<=x<LOGICAL_WIDTH, 0<=y<GAME_AREA_HEIGHT)。地形生成/消去の対象。
 * 'palette': パレット領域内(0<=x<LOGICAL_WIDTH, GAME_AREA_HEIGHT<=y<LOGICAL_HEIGHT)。スロット選択の対象。
 * 'outside': どちらでもない(キャンバスの外・負座標・論理幅/高さ超え)。何もしない(完全キャンセル)。
 */
export type ScreenRegion = 'game' | 'palette' | 'outside';

/** キャンバス論理座標(x, y)がどの領域に属するかを判定する純関数(DOM非依存)。 */
export function classifyScreenPoint(x: number, y: number): ScreenRegion {
  if (x < 0 || x >= LOGICAL_WIDTH || y < 0 || y >= LOGICAL_HEIGHT) {
    return 'outside';
  }
  return y >= GAME_AREA_HEIGHT ? 'palette' : 'game';
}
