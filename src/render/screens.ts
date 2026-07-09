// タイトル/ステージ選択/クリア画面。ゲームプレイ中(renderer.ts)とは別の、シーン単位の画面描画。
// core を一切知らない純粋な画面描画+当たり判定用の矩形計算(main.tsのクリックルーティングと共有する)。
import { GAME_AREA_HEIGHT, LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../core/constants';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// --- タイトル画面 -------------------------------------------------------

export function drawTitleScreen(ctx: CanvasRenderingContext2D, blink: boolean): void {
  ctx.save();
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ジャンプマン', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 - 60);

  if (blink) {
    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#f1c40f';
    ctx.fillText('クリックしてスタート', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 60);
  }
  ctx.restore();
}

// --- ステージ選択画面 -----------------------------------------------------

export interface StageMeta {
  id: string;
  name: string;
  theme: string;
  /** このステージの総コイン数 */
  coinCount: number;
  /** 取得済みコインのindex集合(セーブデータ由来) */
  collectedCoinIndices: ReadonlySet<number>;
}

/**
 * コインの取得状態→描画不透明度。取得済みは半透明(0.35)、未取得は不透明(1)にする
 * (renderer.ts の drawCoins の taken ? 0.35 : 1 とHUD側の見た目を揃える)。
 * 単体テスト用に切り出した純関数。
 */
export function coinAlpha(collected: boolean): number {
  return collected ? 0.35 : 1;
}

/**
 * ステージ選択枠の内側にコインアイコンをcoinCount個、横並びで描く。取得済みは半透明、
 * 未取得は不透明にする(ゲーム内HUDのコイン表示と同じ見た目を揃える。coinAlpha参照)。
 * assetsに依存させず(screens.tsは既存どおりctxプリミティブのみで描く)、
 * 簡易な円で表現する(HUD側の所持コイン表示と似た見た目)。
 */
function drawStageCoinRow(ctx: CanvasRenderingContext2D, rect: Rect, meta: StageMeta): void {
  if (meta.coinCount <= 0) return;
  const radius = 7;
  const gap = 6;
  const totalWidth = meta.coinCount * (radius * 2) + (meta.coinCount - 1) * gap;
  const startX = rect.x + rect.w / 2 - totalWidth / 2 + radius;
  const y = rect.y + rect.h - 18;

  for (let i = 0; i < meta.coinCount; i++) {
    const cx = startX + i * (radius * 2 + gap);
    const collected = meta.collectedCoinIndices.has(i);
    ctx.save();
    ctx.globalAlpha = coinAlpha(collected);
    ctx.fillStyle = '#f1c40f';
    ctx.beginPath();
    ctx.arc(cx, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#a9720a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

// 5ステージ(以上)でも画面(LOGICAL_HEIGHT=768)からはみ出さないよう、縦1列ではなく2列グリッドで
// 配置する。1枠は480x90のときより大きく(560x100)なり、タッチでも押しやすいサイズを維持する。
const STAGE_BOX_COLS = 2;
const STAGE_BOX_W = 560;
const STAGE_BOX_H = 100;
const STAGE_BOX_GAP_X = 40;
const STAGE_BOX_GAP_Y = 20;
const STAGE_BOX_TOP = 190;

export function stageSelectBoxRect(index: number): Rect {
  const col = index % STAGE_BOX_COLS;
  const row = Math.floor(index / STAGE_BOX_COLS);
  const totalWidth = STAGE_BOX_COLS * STAGE_BOX_W + (STAGE_BOX_COLS - 1) * STAGE_BOX_GAP_X;
  const startX = (LOGICAL_WIDTH - totalWidth) / 2;
  return {
    x: startX + col * (STAGE_BOX_W + STAGE_BOX_GAP_X),
    y: STAGE_BOX_TOP + row * (STAGE_BOX_H + STAGE_BOX_GAP_Y),
    w: STAGE_BOX_W,
    h: STAGE_BOX_H,
  };
}

export function drawStageSelectScreen(ctx: CanvasRenderingContext2D, stages: readonly StageMeta[]): void {
  ctx.save();
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ステージ選択', LOGICAL_WIDTH / 2, 120);

  stages.forEach((stage, index) => {
    const rect = stageSelectBoxRect(index);
    ctx.fillStyle = '#1b2b3a';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    ctx.fillStyle = '#ffffff';
    ctx.font = '24px sans-serif';
    // コイン列を枠の下側に描くため、名前は少し上に寄せる
    ctx.fillText(stage.name, rect.x + rect.w / 2, rect.y + rect.h / 2 - 10);

    drawStageCoinRow(ctx, rect, stage);
  });
  ctx.restore();
}

// --- クリア画面のボタン(ゲーム画面の上に重ねて描画する) ---------------------

const CLEAR_BUTTON_W = 260;
const CLEAR_BUTTON_H = 56;
const CLEAR_BUTTON_Y = GAME_AREA_HEIGHT / 2 + 70;

export function clearNextButtonRect(): Rect {
  return { x: LOGICAL_WIDTH / 2 - CLEAR_BUTTON_W - 12, y: CLEAR_BUTTON_Y, w: CLEAR_BUTTON_W, h: CLEAR_BUTTON_H };
}

export function clearTitleButtonRect(): Rect {
  return { x: LOGICAL_WIDTH / 2 + 12, y: CLEAR_BUTTON_Y, w: CLEAR_BUTTON_W, h: CLEAR_BUTTON_H };
}

function drawButton(ctx: CanvasRenderingContext2D, rect: Rect, label: string): void {
  ctx.fillStyle = '#1b2b3a';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = '#f1c40f';
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = '#ffffff';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

export function drawClearButtons(ctx: CanvasRenderingContext2D, hasNext: boolean): void {
  ctx.save();
  if (hasNext) {
    drawButton(ctx, clearNextButtonRect(), '次のステージへ');
  }
  drawButton(ctx, clearTitleButtonRect(), 'タイトルへ');
  ctx.restore();
}
