// 論理スプライト名+フレーム選択 → drawImage 呼び出し。描画コードはこの関数経由でのみ画像を描く。
import type { AssetStore } from './assets';

/**
 * 指定した論理スプライト名・フレーム番号を destX/destY/destW/destH の矩形に描画する。
 * frameIndex はスプライトシート内で横方向に並んだフレームのインデックス(0始まり)。
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  name: string,
  frameIndex: number,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
): void {
  const sprite = assets.get(name);
  const frame = ((frameIndex % sprite.frames) + sprite.frames) % sprite.frames;
  const sx = frame * sprite.frameW;
  ctx.drawImage(sprite.image, sx, 0, sprite.frameW, sprite.frameH, destX, destY, destW, destH);
}
