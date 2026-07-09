// renderer: GameState を Canvas 2D に描画する。core への参照は読み取り専用(coreは render を知らない)。
import {
  GAME_AREA_HEIGHT,
  JUMPMAN_HEIGHT,
  JUMPMAN_MAX_HP,
  JUMPMAN_WIDTH,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PALETTE_HEIGHT,
  PALETTE_SLOT_COUNT,
  TILE_SIZE,
} from '../core/constants';
import { breakableSpriteStage } from '../core/blocks';
import type { GameState } from '../core/game';
import { jumpmanAABB } from '../core/jumpman';
import { checkErase, checkPlacement } from '../core/placement';
import { BlockType, EnemyType, GameStatus } from '../core/types';
import type { PaletteSlot, TerrainDefinition } from '../core/types';
import type { AssetStore } from './assets';
import type { CameraState } from './camera';
import { drawSprite } from './sprites';

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

function drawTiles(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
): void {
  const { grid } = state;
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
      drawSprite(ctx, assets, spriteName, 0, destX, destY, TILE_SIZE, TILE_SIZE);
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

function drawFlags(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
): void {
  const flagW = TILE_SIZE;
  const flagH = TILE_SIZE * 1.5;

  const goalX = state.stage.goal.x * TILE_SIZE - camera.x;
  const goalY = (state.stage.goal.y + 1) * TILE_SIZE - flagH - camera.y;
  drawSprite(ctx, assets, 'goal_flag', 0, goalX, goalY, flagW, flagH);

  for (const checkpoint of state.checkpoints) {
    const cpX = checkpoint.x * TILE_SIZE - camera.x;
    const cpY = (checkpoint.y + 1) * TILE_SIZE - flagH - camera.y;
    ctx.save();
    ctx.globalAlpha = checkpoint.activated ? 1 : 0.5;
    drawSprite(ctx, assets, 'checkpoint_flag', 0, cpX, cpY, flagW, flagH);
    ctx.restore();
  }
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
  drawSprite(ctx, assets, spriteName, frame, destX, destY, destW, destH);
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.save();
  ctx.font = '20px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.fillText('HP', 12, 10);

  const heartSize = 18;
  for (let i = 0; i < JUMPMAN_MAX_HP; i++) {
    const x = 48 + i * (heartSize + 4);
    const y = 10;
    ctx.fillStyle = i < state.jumpman.hp ? '#e74c3c' : '#4a4a4a';
    ctx.fillRect(x, y, heartSize, heartSize);
  }
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
 * ゲーム本体(GameState経由)と地形マスタエディタ(プレーンな配列)の双方から再利用する。
 */
export function drawPaletteSlots(
  ctx: CanvasRenderingContext2D,
  terrains: readonly TerrainDefinition[],
  selectedSlot: PaletteSlot,
): void {
  const count = Math.min(PALETTE_SLOT_COUNT, terrains.length);
  for (let i = 0; i < count; i++) {
    const terrain = terrains[i];
    if (!terrain) continue;
    const rect = paletteSlotRect(i);
    const selected = i === selectedSlot;

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

/** ゲーム画面全体を描画する唯一の入口 */
export function renderGame(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  state: GameState,
  camera: CameraState,
  animTime: number,
  hoverTile: { x: number; y: number } | null = null,
): void {
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.fillStyle = '#87ceeb';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, GAME_AREA_HEIGHT);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, LOGICAL_WIDTH, GAME_AREA_HEIGHT);
  ctx.clip();

  drawTiles(ctx, assets, state, camera);
  drawFallingBlocks(ctx, assets, state, camera);
  drawFlags(ctx, assets, state, camera);
  drawEnemies(ctx, assets, state, camera, animTime);
  drawJumpman(ctx, assets, state, camera, animTime);
  if (state.status !== GameStatus.Cleared) {
    drawPlacementPreview(ctx, state, camera, hoverTile);
  }

  ctx.restore();

  drawHud(ctx, state);
  drawPaletteArea(ctx, state);

  if (state.status === GameStatus.Cleared) {
    drawClearOverlay(ctx);
  }
}
