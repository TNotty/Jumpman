// 多層パララックス背景。テーマ(grass/cave)ごとの色・パラメータは render/themes.ts に集約されており、
// このファイルは手続き描画のロジックのみを持つ(新テーマ追加時にここを変更する必要は無い)。
//
// パフォーマンス方針: 各層の形状(シルエットのパス)はテーマ切替時(createBackgroundLayers呼び出し時)
// に1回だけシード固定の擬似乱数で生成し、横方向にタイル可能な帯としてオフスクリーンcanvasへ
// プリレンダする。毎フレームの描画はプリレンダ済みcanvasをdrawImageで繰り返し並べるだけにし、
// パスの再構築(beginPath/lineTo等)を避ける。洞窟の結晶の微発光だけは点滅アニメが必要なため
// 毎フレーム別途(数個程度の)arcを描く軽量な追加パスにしている。
//
// 鉄則: core層には一切依存しない(GameStateを読まない、camera.tsの型のみ参照する読み取り専用)。
import { GAME_AREA_HEIGHT, LOGICAL_WIDTH } from '../core/constants';
import type { CameraState } from './camera';
import { getTheme } from './themes';
import type { ThemeDefinition } from './themes';

// --- 決定論的乱数(mulberry32)。シード固定でテーマ切替のたびに同じ形状を再現する ---------------

function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Harmonic {
  k: number; // 整数波数(パターン幅で必ず1周する=タイル境界で連続になる)
  amp: number;
  phase: number;
}

function buildHarmonics(rng: () => number, count: number, baseAmp: number): Harmonic[] {
  const harmonics: Harmonic[] = [];
  for (let i = 1; i <= count; i++) {
    harmonics.push({ k: i, amp: (baseAmp / i) * (0.5 + rng() * 0.5), phase: rng() * Math.PI * 2 });
  }
  return harmonics;
}

function silhouetteOffset(x: number, width: number, harmonics: readonly Harmonic[]): number {
  let offset = 0;
  for (const h of harmonics) {
    offset += Math.sin((2 * Math.PI * h.k * x) / width + h.phase) * h.amp;
  }
  return offset;
}

/**
 * 山/丘/岩壁のような「下端(または上端)から生えるシルエット」を幅widthの帯にプリレンダする。
 * anchor='bottom'なら下端から上に向かって波打つ稜線(山・丘)、'top'なら上端から下に垂れる
 * 稜線(洞窟の岩壁の張り出し・鍾乳石の帯)になる。widthをちょうど1周期にしてあるため、
 * 横に並べて繰り返し描画しても継ぎ目が出ない。
 */
function renderSilhouetteStrip(
  width: number,
  height: number,
  baseYFraction: number,
  amplitude: number,
  color: string,
  anchor: 'bottom' | 'top',
  rng: () => number,
  harmonicCount: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const harmonics = buildHarmonics(rng, harmonicCount, amplitude);
  const baseY = anchor === 'bottom' ? height * baseYFraction : height * baseYFraction;

  ctx.fillStyle = color;
  ctx.beginPath();
  if (anchor === 'bottom') {
    ctx.moveTo(0, height);
    for (let x = 0; x <= width; x += 4) {
      ctx.lineTo(x, baseY - silhouetteOffset(x, width, harmonics));
    }
    ctx.lineTo(width, height);
  } else {
    ctx.moveTo(0, 0);
    for (let x = 0; x <= width; x += 4) {
      ctx.lineTo(x, baseY + silhouetteOffset(x, width, harmonics));
    }
    ctx.lineTo(width, 0);
  }
  ctx.closePath();
  ctx.fill();
  return canvas;
}

function renderCloudStrip(width: number, height: number, color: string, rng: () => number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = color;
  const cloudCount = 4;
  for (let i = 0; i < cloudCount; i++) {
    const cx = ((i + 0.5) / cloudCount) * width + (rng() - 0.5) * (width / cloudCount) * 0.6;
    const cy = height * (0.15 + rng() * 0.3);
    const scale = 0.6 + rng() * 0.7;
    drawCloudPuff(ctx, cx, cy, scale);
  }
  return canvas;
}

function drawCloudPuff(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number): void {
  const puffs = [
    { dx: -28, dy: 4, r: 16 },
    { dx: -8, dy: -6, r: 20 },
    { dx: 16, dy: 0, r: 18 },
    { dx: 34, dy: 6, r: 13 },
  ];
  ctx.beginPath();
  for (const p of puffs) {
    ctx.moveTo(cx + (p.dx + p.r) * scale, cy + p.dy * scale);
    ctx.arc(cx + p.dx * scale, cy + p.dy * scale, p.r * scale, 0, Math.PI * 2);
  }
  ctx.fill();
}

export interface GlowPoint {
  x: number;
  y: number;
  radius: number;
  phase: number;
  speed: number;
}

function buildGlowPoints(rng: () => number, width: number, height: number, count: number): GlowPoint[] {
  const points: GlowPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: rng() * width,
      y: height * (0.1 + rng() * 0.7),
      radius: 2 + rng() * 3,
      phase: rng() * Math.PI * 2,
      speed: 0.6 + rng() * 0.8,
    });
  }
  return points;
}

export interface BackgroundLayers {
  themeId: string;
  patternWidth: number;
  far: HTMLCanvasElement;
  mid: HTMLCanvasElement;
  cloud: HTMLCanvasElement | null;
  glowPoints: readonly GlowPoint[];
}

/** テーマ切替のたびに1回だけ呼ぶ(以降は同じインスタンスをdrawBackgroundへ渡し続ける)。 */
export function createBackgroundLayers(themeId: string, seed = 20260814): BackgroundLayers {
  const theme = getTheme(themeId);
  const patternWidth = 960;
  const height = GAME_AREA_HEIGHT;
  const rng = mulberry32(seed);

  const far = renderSilhouetteStrip(patternWidth, height, 0.72, 36, theme.farLayer.color, 'bottom', rng, 3);
  const midAnchor: 'bottom' | 'top' = theme.id === 'cave' ? 'top' : 'bottom';
  const midBaseFraction = theme.id === 'cave' ? 0.18 : 0.82;
  const mid = renderSilhouetteStrip(patternWidth, height, midBaseFraction, 46, theme.midLayer.color, midAnchor, rng, 5);

  const cloud = theme.cloud ? renderCloudStrip(patternWidth, height, theme.cloud.color, rng) : null;
  const glowPoints = theme.glowColor ? buildGlowPoints(rng, patternWidth, height, 10) : [];

  return { themeId, patternWidth, far, mid, cloud, glowPoints };
}

/** パターン幅を1周期として、camera.x×parallaxFactor 分だけずらしながら画面幅ぶん継ぎ目なく並べる */
function drawTiledLayer(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  patternWidth: number,
  camera: CameraState,
  parallaxFactor: number,
  alpha = 1,
): void {
  const scrollX = camera.x * parallaxFactor;
  const scrollY = camera.y * parallaxFactor;
  // 負値でも正しくラップするよう、まずは 0〜patternWidth の範囲に正規化する
  const offset = ((scrollX % patternWidth) + patternWidth) % patternWidth;
  ctx.save();
  if (alpha < 1) ctx.globalAlpha = alpha;
  let x = -offset;
  while (x < LOGICAL_WIDTH) {
    ctx.drawImage(canvas, x, -scrollY);
    x += patternWidth;
  }
  ctx.restore();
}

/**
 * 背景全体(空グラデーション+各パララックス層+ゆっくり明滅する結晶の発光)を描画する。
 * ゲーム領域(GAME_AREA_HEIGHT)のみを対象にする(呼び出し側=renderer.tsが既にその領域で
 * clip済みの状態で呼ぶ想定。パレット領域は一切触れない)。
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  layers: BackgroundLayers,
  camera: CameraState,
  animTime: number,
): void {
  const theme = getTheme(layers.themeId);
  drawSkyGradient(ctx, theme);

  if (layers.cloud && theme.cloud) {
    const autoScroll = animTime * theme.cloud.autoScrollPxPerSec;
    const cloudCamera: CameraState = { x: camera.x * theme.cloud.parallaxFactor + autoScroll, y: camera.y };
    drawTiledLayer(ctx, layers.cloud, layers.patternWidth, cloudCamera, 1, 0.9);
  }

  drawTiledLayer(ctx, layers.far, layers.patternWidth, camera, theme.farLayer.parallaxFactor);
  drawTiledLayer(ctx, layers.mid, layers.patternWidth, camera, theme.midLayer.parallaxFactor);

  if (theme.glowColor && layers.glowPoints.length > 0) {
    drawGlowPoints(ctx, layers, camera, theme, animTime);
  }
}

function drawSkyGradient(ctx: CanvasRenderingContext2D, theme: ThemeDefinition): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, GAME_AREA_HEIGHT);
  gradient.addColorStop(0, theme.sky.top);
  gradient.addColorStop(1, theme.sky.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, GAME_AREA_HEIGHT);
}

function drawGlowPoints(
  ctx: CanvasRenderingContext2D,
  layers: BackgroundLayers,
  camera: CameraState,
  theme: ThemeDefinition,
  animTime: number,
): void {
  if (!theme.glowColor) return;
  const parallaxFactor = theme.midLayer.parallaxFactor;
  const scrollX = camera.x * parallaxFactor;
  const scrollY = camera.y * parallaxFactor;
  const offset = ((scrollX % layers.patternWidth) + layers.patternWidth) % layers.patternWidth;

  ctx.save();
  for (let repeat = -offset; repeat < LOGICAL_WIDTH; repeat += layers.patternWidth) {
    for (const glow of layers.glowPoints) {
      const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(animTime * glow.speed + glow.phase));
      ctx.globalAlpha = pulse;
      ctx.fillStyle = theme.glowColor;
      ctx.beginPath();
      ctx.arc(repeat + glow.x, glow.y - scrollY, glow.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
