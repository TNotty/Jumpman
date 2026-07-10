// renderer: GameState を Canvas 2D に描画する。core への参照は読み取り専用(coreは render を知らない)。
import {
  GAME_AREA_HEIGHT,
  JUMPMAN_HEIGHT,
  JUMPMAN_WIDTH,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PALETTE_HEIGHT,
  PALETTE_SLOT_COUNT,
  TILE_SIZE,
} from '../core/constants';
import { breakableSpriteStage } from '../core/blocks';
import type { GameState } from '../core/game';
import type { TileGrid } from '../core/grid';
import { jumpmanAABB } from '../core/jumpman';
import { checkErase, checkPlacement } from '../core/placement';
import { BlockType, EnemyType, GameStatus } from '../core/types';
import type { CoinState, PaletteSlot, TerrainDefinition } from '../core/types';
import type { AssetStore } from './assets';
import type { BackgroundLayers } from './background';
import { drawBackground } from './background';
import type { CameraState } from './camera';
import type { EffectsManagerView } from './effects';
import { drawSprite } from './sprites';
import type { ThemeDefinition } from './themes';
import { getTheme } from './themes';

/**
 * BlockType(+テーマ+壊れるブロックの見た目段階) → 論理スプライト名。
 * マップエディタ(app/editor)もゲームと同じ見た目にするためこの関数を再利用する。
 */
export function blockSpriteName(type: BlockType, theme: string, breakableStage: 1 | 2 | 3 = 1): string | null {
  switch (type) {
    case BlockType.Normal:
      return theme === 'grass' ? 'block_normal_grass' : 'block_normal_cave';
    case BlockType.Breakable:
      return `block_breakable_${breakableStage}`;
    case BlockType.Spike:
      return 'block_spike';
    case BlockType.Falling:
      return 'block_falling';
    case BlockType.Empty:
    default:
      return null;
  }
}

/** EnemyType → 論理スプライト名。マップエディタも同じ見た目にするためこの関数を再利用する。 */
export function enemySpriteName(type: EnemyType): string {
  switch (type) {
    case EnemyType.Slime:
      return 'slime';
    case EnemyType.Frog:
      return 'frog';
    case EnemyType.Bird:
      return 'bird';
    default:
      return 'slime';
  }
}

/**
 * 通常ブロック(N)のオートタイリング用: 上下左右の隣接セルが非固体(=空いている)かどうかを
 * 判定する純関数。core層のTileGrid.isSolid()をそのまま使う(壊れる/トゲ/落ちるブロックも
 * 「固体として隣接している」とみなす=通常ブロック同士の境目だけでなく、他種別のブロックと
 * 隣接していても「囲まれている」と判定してよいため)。grid/x/yだけを受け取る純粋な読み取りで、
 * 描画には一切触れない(render/renderer.test.tsで単体テストする)。
 */
export interface TileEdgeFlags {
  topOpen: boolean;
  bottomOpen: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
}

export function computeTileEdgeFlags(grid: TileGrid, x: number, y: number): TileEdgeFlags {
  return {
    topOpen: !grid.isSolid(x, y - 1),
    bottomOpen: !grid.isSolid(x, y + 1),
    leftOpen: !grid.isSolid(x - 1, y),
    rightOpen: !grid.isSolid(x + 1, y),
  };
}

/**
 * 通常ブロックのスプライトの上に、隣接状況に応じた縁取り/内部陰影を手続き描画で重ねる
 * (アセット差し替えではなく既存スプライトへの上塗りなので、差し替え可能な構造を壊さない。
 * プレイヤーが生成した通常ブロックにも同じ判定がそのまま効く)。
 * - 四方すべて塞がっている(囲まれている): 暗めの内部模様を重ねる。
 * - 上が空: 上端にハイライトの縁(草原=草の縁、洞窟=ハイライトの縁)。
 * - 左/右が空: その側に陰影の縁。
 * - 角(上+左または上+右が両方空): 縁が丸く折り返るハイライトを角に追加する。
 */
function drawTileAutoTileOverlay(
  ctx: CanvasRenderingContext2D,
  theme: ThemeDefinition,
  destX: number,
  destY: number,
  edges: TileEdgeFlags,
): void {
  const { topOpen, leftOpen, rightOpen, bottomOpen } = edges;

  if (!topOpen && !leftOpen && !rightOpen && !bottomOpen) {
    ctx.save();
    ctx.fillStyle = theme.tile.innerShade;
    ctx.fillRect(destX, destY, TILE_SIZE, TILE_SIZE);
    ctx.restore();
    return;
  }

  const edgeThickness = Math.max(2, Math.round(TILE_SIZE * 0.14));
  ctx.save();

  if (topOpen) {
    ctx.fillStyle = theme.tile.edgeHighlight;
    ctx.fillRect(destX, destY, TILE_SIZE, edgeThickness);
  }
  if (leftOpen) {
    ctx.fillStyle = theme.tile.edgeShadow;
    ctx.fillRect(destX, destY, edgeThickness, TILE_SIZE);
  }
  if (rightOpen) {
    ctx.fillStyle = theme.tile.edgeShadow;
    ctx.fillRect(destX + TILE_SIZE - edgeThickness, destY, edgeThickness, TILE_SIZE);
  }

  // 角: 上端のハイライトが角で丸く折り返っているように見せる三角形を追加する
  if (topOpen && leftOpen) {
    ctx.fillStyle = theme.tile.edgeHighlight;
    ctx.beginPath();
    ctx.moveTo(destX, destY);
    ctx.lineTo(destX + edgeThickness * 2, destY);
    ctx.lineTo(destX, destY + edgeThickness * 2);
    ctx.closePath();
    ctx.fill();
  }
  if (topOpen && rightOpen) {
    ctx.fillStyle = theme.tile.edgeHighlight;
    ctx.beginPath();
    ctx.moveTo(destX + TILE_SIZE, destY);
    ctx.lineTo(destX + TILE_SIZE - edgeThickness * 2, destY);
    ctx.lineTo(destX + TILE_SIZE, destY + edgeThickness * 2);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function drawTiles(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
  effects?: EffectsManagerView,
): void {
  const { grid } = state;
  const theme = getTheme(state.stage.theme);
  const firstCol = Math.max(0, Math.floor(camera.x / TILE_SIZE));
  const lastCol = Math.min(grid.width - 1, Math.ceil((camera.x + LOGICAL_WIDTH) / TILE_SIZE));

  for (let y = 0; y < grid.height; y++) {
    for (let x = firstCol; x <= lastCol; x++) {
      const type = grid.get(x, y);
      const stage = type === BlockType.Breakable ? breakableSpriteStage(state.breakableDamage, x, y) : 1;
      const spriteName = blockSpriteName(type, state.stage.theme, stage);
      if (spriteName === null) continue;
      const destX = x * TILE_SIZE - camera.x;
      const destY = y * TILE_SIZE - camera.y;

      const draw = (): void => {
        drawSprite(ctx, assets, spriteName, 0, destX, destY, TILE_SIZE, TILE_SIZE);
        // オートタイリングの縁取り/内部陰影は通常ブロックのみ(壊れる/トゲ/落ちるブロックは
        // 区別が重要なため現状のスプライトのまま、という要件どおり対象外にする)。
        if (type === BlockType.Normal) {
          drawTileAutoTileOverlay(ctx, theme, destX, destY, computeTileEdgeFlags(grid, x, y));
        }
      };

      // 地形生成直後のセルは0→1のバウンスするポップアニメで出現させる(effects省略時は常に1=通常表示)。
      const popScale = effects?.getPlacementPopScale(x, y) ?? 1;
      if (popScale < 1) {
        const cx = destX + TILE_SIZE / 2;
        const cy = destY + TILE_SIZE / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(popScale, popScale);
        ctx.translate(-cx, -cy);
        draw();
        ctx.restore();
      } else {
        draw();
      }
    }
  }
}

/** 落下フェーズに入った落ちるブロックのみ描画する(震え中はまだグリッド側で描画されている) */
function drawFallingBlocks(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
): void {
  for (const block of state.fallingBlocks) {
    if (block.phase !== 'falling') continue;
    const destX = block.x * TILE_SIZE - camera.x;
    const destY = block.y * TILE_SIZE - camera.y;
    drawSprite(ctx, assets, 'block_falling', 0, destX, destY, TILE_SIZE, TILE_SIZE);
  }
}

/**
 * 旗をせん断変形(スキュー)で左右に揺らして「なびき」を表現する。ポール側(左端)を固定軸にし、
 * サインカーブで角度を揺らす(新規アセット不要、描画変形のみ)。x位置ごとに位相をずらして
 * 複数の旗が同期して揺れないようにする。
 */
function drawWavingFlag(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  spriteName: string,
  destX: number,
  destY: number,
  flagW: number,
  flagH: number,
  animTime: number,
  phase: number,
): void {
  const skew = Math.sin(animTime * 3 + phase) * 0.08;
  ctx.save();
  // ポール側(左端・下端=旗竿の付け根)を不動点にしてせん断する
  ctx.transform(1, 0, skew, 1, destX, destY + flagH);
  drawSprite(ctx, assets, spriteName, 0, 0, -flagH, flagW, flagH);
  ctx.restore();
}

function drawFlags(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
  animTime: number,
): void {
  const flagW = TILE_SIZE;
  const flagH = TILE_SIZE * 1.5;

  const goalX = state.stage.goal.x * TILE_SIZE - camera.x;
  const goalY = (state.stage.goal.y + 1) * TILE_SIZE - flagH - camera.y;
  drawWavingFlag(ctx, assets, 'goal_flag', goalX, goalY, flagW, flagH, animTime, 0);

  for (const checkpoint of state.checkpoints) {
    const cpX = checkpoint.x * TILE_SIZE - camera.x;
    const cpY = (checkpoint.y + 1) * TILE_SIZE - flagH - camera.y;
    ctx.save();
    ctx.globalAlpha = checkpoint.activated ? 1 : 0.5;
    drawWavingFlag(ctx, assets, 'checkpoint_flag', cpX, cpY, flagW, flagH, animTime, checkpoint.x);
    ctx.restore();
  }
}

/**
 * コインの描画状態。
 * - 'dim': このステージへの入場時点(createGameState呼び出し時点)で既にセーブデータ上
 *   取得済みだった(permanentlyCollected)。再訪時の目印として半透明で描き続ける。
 * - 'hidden': 今回のセッション中に新規取得した(collectedThisSession)。取得済みという状態は
 *   即座に「消える」ことでフィードバックする(半透明表示はしない。死亡→チェックポイント復帰でも
 *   collectedThisSessionはリセットされないため、再出現しない=消えたまま)。
 * - 'normal': 未取得。通常表示。
 * 純関数として切り出し、単体テスト可能にしている(coreに依存しないread-onlyなCoinState判定)。
 */
export function coinRenderState(coin: Pick<CoinState, 'permanentlyCollected' | 'collectedThisSession'>): 'dim' | 'hidden' | 'normal' {
  if (coin.permanentlyCollected) return 'dim';
  if (coin.collectedThisSession) return 'hidden';
  return 'normal';
}

/**
 * コインを描画する。'hidden'(今回のセッションで新規取得済み)は描画自体をスキップする
 * (即座に消える)。'dim'(再訪時点で既に取得済み)は半透明で描き続ける。軽い上下ふわふわ
 * アニメと、横方向のスケール振動による疑似回転(coin.svgを横に縮めて伸ばすことで
 * 縦軸回転しているように見せる。新規アセット不要)をanimTimeで付ける。
 */
function drawCoins(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
  animTime: number,
): void {
  state.coins.forEach((coin, index) => {
    const renderState = coinRenderState(coin);
    if (renderState === 'hidden') return;
    const bob = Math.sin(animTime * 3 + index) * 3;
    const destX = coin.x * TILE_SIZE - camera.x;
    const destY = coin.y * TILE_SIZE - camera.y + bob;
    // 0に近づくほど「真横から見た薄い縁」に見える(疑似回転)。0.15を下限にして完全に潰れないようにする。
    const spinScaleX = Math.max(0.15, Math.abs(Math.cos(animTime * 2.2 + index)));
    const cx = destX + TILE_SIZE / 2;
    const cy = destY + TILE_SIZE / 2;
    ctx.save();
    ctx.globalAlpha = renderState === 'dim' ? 0.35 : 1;
    ctx.translate(cx, cy);
    ctx.scale(spinScaleX, 1);
    ctx.translate(-cx, -cy);
    drawSprite(ctx, assets, 'coin', 0, destX, destY, TILE_SIZE, TILE_SIZE);
    ctx.restore();
  });
}

function drawEnemies(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
  animTime: number,
): void {
  const frame = Math.floor(animTime * 4) % 2;
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const destX = enemy.x * TILE_SIZE - camera.x;
    const destY = enemy.y * TILE_SIZE - camera.y;
    drawSprite(ctx, assets, enemySpriteName(enemy.type), frame, destX, destY, TILE_SIZE, TILE_SIZE);
  }
}

function drawJumpman(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
  animTime: number,
  effects?: EffectsManagerView,
): void {
  const { jumpman } = state;
  const destX = jumpman.position.x * TILE_SIZE - camera.x;
  const destY = jumpman.position.y * TILE_SIZE - camera.y;
  const destW = JUMPMAN_WIDTH * TILE_SIZE;
  const destH = JUMPMAN_HEIGHT * TILE_SIZE;

  const spriteName = jumpman.grounded ? 'jumpman_run' : 'jumpman_jump';
  const frame = jumpman.grounded ? Math.floor(animTime * 8) % 4 : 0;

  ctx.save();
  if (jumpman.invincibleTimer > 0 && Math.floor(animTime * 10) % 2 === 0) {
    ctx.globalAlpha = 0.4;
  }

  // squash&stretch: 着地/ジャンプ踏切イベントに合わせた描画変形のみ(当たり判定=JUMPMAN_WIDTH/
  // HEIGHTには一切影響しない)。足元(スプライトの下端中央)を不動点にして拡縮する。
  const { scaleX, scaleY } = effects?.getSquashStretch() ?? { scaleX: 1, scaleY: 1 };
  if (scaleX !== 1 || scaleY !== 1) {
    const anchorX = destX + destW / 2;
    const anchorY = destY + destH;
    ctx.translate(anchorX, anchorY);
    ctx.scale(scaleX, scaleY);
    ctx.translate(-anchorX, -anchorY);
  }

  drawSprite(ctx, assets, spriteName, frame, destX, destY, destW, destH);
  ctx.restore();
}

/**
 * HP表示の直下に所持コイン数(コインアイコン+数値)を描く。walletCountはセーブデータ由来の値を
 * app層が渡す(core/GameStateはwalletを持たない=セーブの概念を知らないため)。
 */
function drawHud(ctx: CanvasRenderingContext2D, state: GameState, walletCount: number): void {
  ctx.save();
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.fillText('HP', 12, 10);

  // 最大HPは強化(hp)で5〜15まで変わるため、定数ではなくstate.playerStats.maxHp(実効値)を使う。
  const heartSize = 18;
  for (let i = 0; i < state.playerStats.maxHp; i++) {
    const x = 48 + i * (heartSize + 4);
    const y = 10;
    ctx.fillStyle = i < state.jumpman.hp ? '#e74c3c' : '#4a4a4a';
    ctx.fillRect(x, y, heartSize, heartSize);
  }

  const coinRowY = 10 + heartSize + 8;
  ctx.fillStyle = '#f1c40f';
  ctx.beginPath();
  ctx.arc(21, coinRowY + 9, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a9720a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '18px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(walletCount), 40, coinRowY + 10);
  ctx.restore();
}

// --- パレットHUD(下部128px): 8枠・形状プレビュー・コスト・選択枠・マナバー ---------------

const SLOT_W = 100;
const SLOT_H = 90;
const SLOT_GAP = 8;
const SLOT_MARGIN_X = 16;
const SLOT_MARGIN_Y = 16;

export function paletteSlotRect(index: number): { x: number; y: number; w: number; h: number } {
  return {
    x: SLOT_MARGIN_X + index * (SLOT_W + SLOT_GAP),
    y: GAME_AREA_HEIGHT + SLOT_MARGIN_Y,
    w: SLOT_W,
    h: SLOT_H,
  };
}

/** 消去スロットの矩形。8個の地形スロット(index 0-7)の右隣(index 8相当の位置)に独立して1枠配置する */
export function eraserSlotRect(): { x: number; y: number; w: number; h: number } {
  return paletteSlotRect(PALETTE_SLOT_COUNT);
}

/** 地形の形状を矩形の色塗りで縮小プレビューする。マップ/地形マスタエディタからも再利用する。 */
export function drawTerrainShapePreview(
  ctx: CanvasRenderingContext2D,
  terrain: TerrainDefinition,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const rows = terrain.grid;
  const gridW = rows[0]?.length ?? 1;
  const gridH = rows.length;
  const cell = Math.max(2, Math.min(w / gridW, h / gridH));
  const offsetX = x + (w - cell * gridW) / 2;
  const offsetY = y + (h - cell * gridH) / 2;

  for (let ry = 0; ry < gridH; ry++) {
    const row = rows[ry] ?? '';
    for (let rx = 0; rx < row.length; rx++) {
      const char = row[rx];
      if (char === undefined || char === '.') continue;
      ctx.fillStyle = char === 'S' ? '#e74c3c' : '#c0895a';
      ctx.fillRect(offsetX + rx * cell, offsetY + ry * cell, Math.max(1, cell - 1), Math.max(1, cell - 1));
    }
  }
}

/**
 * パレット8枠(形状プレビュー・コスト・選択枠・ロック表示)を描画する。
 * ゲーム本体(GameState経由。loadout由来で空枠はnull)と地形マスタエディタ(プレーンな配列)の
 * 双方から再利用する。null(空枠)は選択不可であることが分かる専用の見た目で描く。
 */
export function drawPaletteSlots(
  ctx: CanvasRenderingContext2D,
  terrains: readonly (TerrainDefinition | null)[],
  selectedSlot: PaletteSlot,
): void {
  const count = Math.min(PALETTE_SLOT_COUNT, terrains.length);
  for (let i = 0; i < count; i++) {
    const terrain = terrains[i];
    const rect = paletteSlotRect(i);
    const selected = i === selectedSlot;

    if (!terrain) {
      // 空枠(loadoutの未設定スロット): 選択不可であることが分かる控えめな見た目にする
      ctx.save();
      ctx.fillStyle = '#161616';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = '#555555';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('空き', rect.x + rect.w / 2, rect.y + rect.h / 2);
      ctx.restore();
      continue;
    }

    ctx.save();
    ctx.fillStyle = terrain.unlocked ? '#2b2b2b' : '#1a1a1a';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    ctx.strokeStyle = selected ? '#f1c40f' : '#555555';
    ctx.lineWidth = selected ? 3 : 1;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

    if (terrain.unlocked) {
      drawTerrainShapePreview(ctx, terrain, rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 28);
    } else {
      ctx.fillStyle = '#555555';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('未解放', rect.x + rect.w / 2, rect.y + rect.h / 2 - 8);
    }

    ctx.fillStyle = terrain.unlocked ? '#ffffff' : '#777777';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${terrain.name} (${terrain.cost})`, rect.x + rect.w / 2, rect.y + rect.h - 4);
    ctx.restore();
  }
}

/** 消去スロット(ゴミ箱アイコン+消去コスト表示)を描画する。8地形スロットの右に独立した1枠として置く */
export function drawEraserSlot(ctx: CanvasRenderingContext2D, selected: boolean, cost: number): void {
  const rect = eraserSlotRect();

  ctx.save();
  ctx.fillStyle = '#2b1a1a';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  ctx.strokeStyle = selected ? '#f1c40f' : '#555555';
  ctx.lineWidth = selected ? 3 : 1;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

  // ゴミ箱風のアイコン(簡易): 蓋+本体の矩形
  const iconCx = rect.x + rect.w / 2;
  const iconTop = rect.y + 14;
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = 2;
  ctx.strokeRect(iconCx - 16, iconTop + 10, 32, 34);
  ctx.beginPath();
  ctx.moveTo(iconCx - 22, iconTop + 10);
  ctx.lineTo(iconCx + 22, iconTop + 10);
  ctx.moveTo(iconCx - 8, iconTop + 4);
  ctx.lineTo(iconCx + 8, iconTop + 4);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`消去 (${cost})`, rect.x + rect.w / 2, rect.y + rect.h - 4);
  ctx.restore();
}

function drawManaBar(ctx: CanvasRenderingContext2D, state: GameState): void {
  const barX = LOGICAL_WIDTH - 240;
  const barY = GAME_AREA_HEIGHT + PALETTE_HEIGHT / 2 - 12;
  const barW = 216;
  const barH = 24;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('マナ', barX, barY - 4);

  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(barX, barY, barW, barH);
  const ratio = state.mana.max > 0 ? Math.max(0, Math.min(1, state.mana.current / state.mana.max)) : 0;
  ctx.fillStyle = '#3498db';
  ctx.fillRect(barX, barY, barW * ratio, barH);
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.fillStyle = '#ffffff';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.floor(state.mana.current)} / ${state.mana.max}`, barX + barW / 2, barY + barH / 2 + 1);
  ctx.restore();
}

function drawPaletteArea(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.save();
  const y = GAME_AREA_HEIGHT;
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, y, LOGICAL_WIDTH, PALETTE_HEIGHT);
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, y + 1, LOGICAL_WIDTH - 2, PALETTE_HEIGHT - 2);
  ctx.restore();

  // 消去スロットは地形マスタの有無に関わらず常時使えるため、8地形スロットとは独立に描画する
  drawEraserSlot(ctx, state.selectedSlot === 'eraser', state.stage.eraseCost);

  if (state.terrainMaster.length === 0) {
    ctx.save();
    ctx.fillStyle = '#888888';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('地形マスタ未読込', 16, y + PALETTE_HEIGHT / 2);
    ctx.restore();
    return;
  }

  drawPaletteSlots(ctx, state.terrainMaster, state.selectedSlot);
  drawManaBar(ctx, state);
}

/** 消去スロット選択中のプレビュー: 消去対象マスに枠を描く(消去可=白枠/不可=赤枠) */
function drawErasePreview(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: CameraState,
  hoverTile: { x: number; y: number },
): void {
  const check = checkErase(state.grid, hoverTile.x, hoverTile.y, state.mana, state.stage.eraseCost);
  const destX = hoverTile.x * TILE_SIZE - camera.x;
  const destY = hoverTile.y * TILE_SIZE - camera.y;

  ctx.save();
  ctx.strokeStyle = check.ok ? '#ffffff' : '#ff3b3b';
  ctx.lineWidth = 3;
  ctx.strokeRect(destX + 2, destY + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  ctx.restore();
}

/** カーソル/タッチ位置に応じたプレビューを描画する。消去スロット選択中は消去対象マスの赤/白枠、
 * それ以外は選択中の地形の半透明プレビュー(可=白/不可=赤)。 */
function drawPlacementPreview(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  camera: CameraState,
  hoverTile: { x: number; y: number } | null,
): void {
  if (!hoverTile) return;

  if (state.selectedSlot === 'eraser') {
    drawErasePreview(ctx, state, camera, hoverTile);
    return;
  }

  const terrain = state.terrainMaster[state.selectedSlot];
  if (!terrain) return;

  const check = checkPlacement(
    state.grid,
    terrain,
    hoverTile.x,
    hoverTile.y,
    jumpmanAABB(state.jumpman.position),
    state.enemies,
    state.mana,
  );

  const rows = terrain.grid;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = check.ok ? '#ffffff' : '#ff3b3b';
  for (let ry = 0; ry < rows.length; ry++) {
    const row = rows[ry] ?? '';
    for (let rx = 0; rx < row.length; rx++) {
      const char = row[rx];
      if (char === undefined || char === '.') continue;
      const destX = (hoverTile.x + rx) * TILE_SIZE - camera.x;
      const destY = (hoverTile.y + ry) * TILE_SIZE - camera.y;
      ctx.fillRect(destX, destY, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.restore();
}

function drawClearOverlay(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, GAME_AREA_HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ステージクリア!', LOGICAL_WIDTH / 2, GAME_AREA_HEIGHT / 2);
  ctx.restore();
}

/** 被弾時の画面端の赤いビネットフラッシュ(screen-space、alpha=0なら何もしない前提で呼び出し側がガードする) */
function drawVignette(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.save();
  const cx = LOGICAL_WIDTH / 2;
  const cy = GAME_AREA_HEIGHT / 2;
  const gradient = ctx.createRadialGradient(cx, cy, GAME_AREA_HEIGHT * 0.25, cx, cy, GAME_AREA_HEIGHT * 0.75);
  gradient.addColorStop(0, 'rgba(200, 0, 0, 0)');
  gradient.addColorStop(1, `rgba(200, 0, 0, ${0.55 * alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, GAME_AREA_HEIGHT);
  ctx.restore();
}

/**
 * ゲーム画面全体を描画する唯一の入口。
 * walletCount: セーブデータ由来の所持コイン総数(HUD表示用)。app層が渡す(coreはセーブを知らない)。
 * effects: パーティクル+画面演出(EffectsManager)。省略時(未指定)は全ての演出を無効化した
 *   従来どおりの描画になる(既存の呼び出し元・テストとの後方互換)。
 */
export function renderGame(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
  animTime: number,
  hoverTile: { x: number; y: number } | null = null,
  walletCount = 0,
  effects?: EffectsManagerView,
  background?: BackgroundLayers,
): void {
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, LOGICAL_WIDTH, GAME_AREA_HEIGHT);
  ctx.clip();

  // 被弾時の画面振動(4px程度・0.2s)とゴール到達時のズームインを、クリップ矩形はそのままに
  // 内容だけへ適用する(clipを先に確定させてから変形するので、クリップ自体は揺れない)。
  const shake = effects?.getShakeOffset() ?? { x: 0, y: 0 };
  const zoom = effects?.getZoomScale() ?? 1;
  if (shake.x !== 0 || shake.y !== 0 || zoom !== 1) {
    const centerX = LOGICAL_WIDTH / 2;
    const centerY = GAME_AREA_HEIGHT / 2;
    ctx.translate(shake.x, shake.y);
    ctx.translate(centerX, centerY);
    ctx.scale(zoom, zoom);
    ctx.translate(-centerX, -centerY);
  }

  // 多層パララックス背景(空グラデ+雲+遠景+近景)。background省略時(未指定)は従来どおりの
  // 単色の空フォールバックにする(既存の呼び出し元・テストとの後方互換)。
  if (background) {
    drawBackground(ctx, background, camera, animTime);
  } else {
    ctx.fillStyle = '#87ceeb';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, GAME_AREA_HEIGHT);
  }

  drawTiles(ctx, assets, state, camera, effects);
  drawFallingBlocks(ctx, assets, state, camera);
  drawFlags(ctx, assets, state, camera, animTime);
  drawCoins(ctx, assets, state, camera, animTime);
  drawEnemies(ctx, assets, state, camera, animTime);
  drawJumpman(ctx, assets, state, camera, animTime, effects);
  if (state.status !== GameStatus.Cleared) {
    drawPlacementPreview(ctx, state, camera, hoverTile);
  }
  effects?.renderParticles(ctx, camera);

  ctx.restore();

  const vignetteAlpha = effects?.getVignetteAlpha() ?? 0;
  if (vignetteAlpha > 0) {
    drawVignette(ctx, vignetteAlpha);
  }

  drawHud(ctx, state, walletCount);
  drawPaletteArea(ctx, state);

  if (state.status === GameStatus.Cleared) {
    drawClearOverlay(ctx);
  }
}
