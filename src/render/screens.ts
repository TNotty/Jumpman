// タイトル/ステージ選択/クリア画面。ゲームプレイ中(renderer.ts)とは別の、シーン単位の画面描画。
// core を一切知らない純粋な画面描画+当たり判定用の矩形計算(main.tsのクリックルーティングと共有する)。
import { GAME_AREA_HEIGHT, JUMPMAN_HEIGHT, JUMPMAN_WIDTH, LOGICAL_HEIGHT, LOGICAL_WIDTH, TILE_SIZE } from '../core/constants';
import type { AssetStore } from './assets';
import type { BackgroundLayers } from './background';
import { drawBackground } from './background';
import { selectJumpmanSprite } from './renderer';
import { drawSprite } from './sprites';
import { getTheme } from './themes';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/**
 * drawBackground自体はGAME_AREA_HEIGHT分しか塗らないため、画面全体(パレット領域相当の
 * 高さも含む)を毎フレーム塗り直す(以前の単色fillRect一発と同じく、前フレームの内容が
 * 透けて残らないようにするために必要)。
 */
function fillBelowGameArea(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, GAME_AREA_HEIGHT, LOGICAL_WIDTH, LOGICAL_HEIGHT - GAME_AREA_HEIGHT);
}

// --- タイトル画面 -------------------------------------------------------

/** タイトルロゴの上下ボブ量(px)。純関数として切り出し、範囲をテストできるようにする。 */
export function computeTitleBobOffset(animTime: number): number {
  return Math.sin(animTime * 1.2) * 8;
}

const DEMO_RUN_SPEED_PX_PER_SEC = 90;

/**
 * タイトル画面のデモ走行ジャンプマンのX座標(px)を求める純関数。GameStateを一切使わない
 * 見た目だけの疑似ループ(loopWidthPxに達したら0に巻き戻る=画面右端まで来たら左端に戻る)。
 */
export function computeDemoRunX(animTime: number, loopWidthPx: number): number {
  if (loopWidthPx <= 0) return 0;
  return (animTime * DEMO_RUN_SPEED_PX_PER_SEC) % loopWidthPx;
}

/**
 * タイトル画面を描画する。
 * background指定時はP2のパララックス背景(草原)を流用し、その手前で画面下部をデモ走行する
 * ジャンプマン(P3の走りアニメを再利用、GameState不要の見た目だけの疑似走行)を描く。
 * assets/background/animTimeは省略可能(その場合は従来どおりの単色背景+デモ演出なし)。
 */
export function drawTitleScreen(
  ctx: CanvasRenderingContext2D,
  blink: boolean,
  assets?: AssetStore,
  background?: BackgroundLayers,
  animTime = 0,
): void {
  ctx.save();

  if (background) {
    drawBackground(ctx, background, { x: 0, y: 0 }, animTime);
    fillBelowGameArea(ctx, '#0d1b2a');
  } else {
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  }

  if (assets && assets.has('jumpman_run')) {
    const demoW = JUMPMAN_WIDTH * TILE_SIZE;
    const demoH = JUMPMAN_HEIGHT * TILE_SIZE;
    const groundY = LOGICAL_HEIGHT - 110;
    const loopWidth = LOGICAL_WIDTH + demoW;
    const demoX = computeDemoRunX(animTime, loopWidth) - demoW;
    const { spriteName, frameIndex } = selectJumpmanSprite({
      grounded: true,
      velocityY: 0,
      facing: 1,
      invincible: false,
      showDeathPose: false,
      animTime,
    });
    // 走行の影(簡易な楕円)を足元に落として地に着いている感を出す
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(demoX + demoW / 2, groundY + demoH + 2, demoW * 0.55, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawSprite(ctx, assets, spriteName, frameIndex, demoX, groundY, demoW, demoH);
  }

  const bob = computeTitleBobOffset(animTime);
  const titleY = LOGICAL_HEIGHT / 2 - 80 + bob;
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#0d1b2a';
  ctx.strokeText('ジャンプマン', LOGICAL_WIDTH / 2, titleY);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffd23f';
  ctx.fillText('ジャンプマン', LOGICAL_WIDTH / 2, titleY);

  if (blink) {
    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#f1c40f';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 6;
    ctx.fillText('クリックしてスタート', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 90);
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
  /**
   * 選択可能か(クリア済み、または未クリアの最初の1つ)。falseならグレー表示+鍵マークにし、
   * タップ判定はmain.ts側(isStageSelectableを直接使う)で既に無効化されているが、
   * 見た目としてもロック中であることが分かるようにする。
   */
  selectable: boolean;
  /** クリア済みか(カードのチェックマーク表示用) */
  cleared: boolean;
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
  const radius = 6;
  const gap = 5;
  const totalWidth = meta.coinCount * (radius * 2) + (meta.coinCount - 1) * gap;
  const startX = rect.x + rect.w / 2 - totalWidth / 2 + radius;
  const y = rect.y + rect.h - 14;

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

// 10ステージが画面(1280x768)に収まるよう、2列×5行のグリッドで配置する。
// 5行分の高さ(170px開始〜768px)に収まるよう1枠は560x96(タッチ操作でも十分な高さ)にする。
// この矩形自体はタップ判定(main.ts)と共有しているため、カードの見た目を変えても座標は変えない。
const STAGE_BOX_COLS = 2;
const STAGE_BOX_W = 560;
const STAGE_BOX_H = 96;
const STAGE_BOX_GAP_X = 40;
const STAGE_BOX_GAP_Y = 14;
const STAGE_BOX_TOP = 170;
/** カードヘッダ(テーマ色の帯)の高さ */
const CARD_HEADER_H = 22;

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

function drawStageCard(ctx: CanvasRenderingContext2D, rect: Rect, meta: StageMeta, index: number, hovered: boolean): void {
  if (!meta.selectable) {
    // ロック中: グレー表示+鍵マーク(現行踏襲)。名前・コイン列は表示しない(タップも無効、判定はmain.ts側)。
    ctx.fillStyle = '#20242b';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#555a63';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    ctx.fillStyle = '#7a7f88';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔒 未解放', rect.x + rect.w / 2, rect.y + rect.h / 2);
    return;
  }

  const theme = getTheme(meta.theme);

  // カード本体
  ctx.fillStyle = '#16232f';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  // テーマ色のヘッダ帯(草原=緑系/洞窟=青灰系)
  ctx.fillStyle = theme.cardHeaderColor;
  ctx.fillRect(rect.x, rect.y, rect.w, CARD_HEADER_H);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`ステージ ${String(index + 1).padStart(2, '0')}`, rect.x + 10, rect.y + CARD_HEADER_H / 2 + 1);

  if (meta.cleared) {
    ctx.fillStyle = '#8ecb8e';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('✓ クリア済み', rect.x + rect.w - 10, rect.y + CARD_HEADER_H / 2 + 1);
  }

  // 選択中/ホバー時の枠発光
  if (hovered) {
    ctx.save();
    ctx.shadowColor = 'rgba(241, 196, 15, 0.9)';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = 'rgba(241, 196, 15, 0.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    ctx.restore();
  } else {
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // コイン列を枠の下側に描くため、名前はヘッダ直下〜コイン列の間の中央に寄せる
  ctx.fillText(meta.name, rect.x + rect.w / 2, rect.y + CARD_HEADER_H + (rect.h - CARD_HEADER_H) / 2 - 8);

  drawStageCoinRow(ctx, rect, meta);
}

/**
 * ステージ選択画面を描画する。
 * background指定時はP2のパララックス背景を流用する(カメラ固定=静止表示でよい)。
 * hoveredIndex指定時は該当カードの枠を発光させる(マウスホバーの視覚フィードバック)。
 */
export function drawStageSelectScreen(
  ctx: CanvasRenderingContext2D,
  stages: readonly StageMeta[],
  background?: BackgroundLayers,
  animTime = 0,
  hoveredIndex: number | null = null,
): void {
  ctx.save();

  if (background) {
    drawBackground(ctx, background, { x: 0, y: 0 }, animTime);
    fillBelowGameArea(ctx, '#0d1b2a');
    // 背景の上にほんのり暗いオーバーレイを敷き、カードの視認性を確保する
    ctx.fillStyle = 'rgba(6, 10, 16, 0.35)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  } else {
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 8;
  ctx.fillText('ステージ選択', LOGICAL_WIDTH / 2, 120);
  ctx.shadowColor = 'transparent';

  stages.forEach((stage, index) => {
    const rect = stageSelectBoxRect(index);
    drawStageCard(ctx, rect, stage, index, hoveredIndex === index);
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
