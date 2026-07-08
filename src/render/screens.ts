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
}

const STAGE_BOX_W = 480;
const STAGE_BOX_H = 90;
const STAGE_BOX_GAP = 24;
const STAGE_BOX_TOP = 220;

export function stageSelectBoxRect(index: number): Rect {
  return {
    x: (LOGICAL_WIDTH - STAGE_BOX_W) / 2,
    y: STAGE_BOX_TOP + index * (STAGE_BOX_H + STAGE_BOX_GAP),
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
    ctx.fillText(stage.name, rect.x + rect.w / 2, rect.y + rect.h / 2);
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
