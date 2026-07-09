// マウス/タッチ/キー入力 → Command 変換。パレット領域(画面下1/6)とゲーム領域でハンドリングを分岐する。
// パレットスロットの内容(terrainMaster)を知っているのはInputManagerで、選択中スロットの
// terrainIdをplaceTerrainコマンドに解決する。ロック中のスロットは選択・配置ともに不可。
// 消去スロット('eraser')は常時選択可能で、選択中はゲーム領域の主操作(左クリック/タップ)が
// 1マス消去になる(game.tsのコマンド処理側で解釈される)。右クリックの消去は選択中スロットに
// 関わらず常時有効。
// 座標変換はマウス/タッチで共通化(getBoundingClientRectベース)。タッチはpreventDefaultで
// 合成マウスイベント・スクロール・ダブルタップズームを抑止する。
import { GAME_AREA_HEIGHT, PALETTE_SLOT_COUNT, TILE_SIZE } from '../core/constants';
import type { Command } from '../core/commands';
import type { PaletteSlot, TerrainDefinition } from '../core/types';
import type { CameraState } from '../render/camera';
import { eraserSlotRect, paletteSlotRect } from '../render/renderer';

type Point = { x: number; y: number };

export class InputManager {
  private queue: Command[] = [];
  private selectedSlot: PaletteSlot = 0;
  private lastPoint: Point | null = null;
  private activeTouchId: number | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly getCamera: () => CameraState;
  private readonly terrainMaster: readonly TerrainDefinition[];

  constructor(canvas: HTMLCanvasElement, getCamera: () => CameraState, terrainMaster: readonly TerrainDefinition[] = []) {
    this.canvas = canvas;
    this.getCamera = getCamera;
    this.terrainMaster = terrainMaster;
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', this.handleTouchCancel, { passive: false });
    window.addEventListener('keydown', this.handleKeyDown);
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.handleTouchCancel);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  /** このフレームに溜まったコマンドを取り出し、キューを空にする */
  drain(): Command[] {
    const commands = this.queue;
    this.queue = [];
    return commands;
  }

  getSelectedSlot(): PaletteSlot {
    return this.selectedSlot;
  }

  /** 現在のマウス/タッチ位置に対応するワールドタイル座標(ゲーム領域内のときのみ)。配置プレビュー用 */
  getHoverTile(): { x: number; y: number } | null {
    if (!this.lastPoint || this.lastPoint.y >= GAME_AREA_HEIGHT) return null;
    const camera = this.getCamera();
    return {
      x: Math.floor((this.lastPoint.x + camera.x) / TILE_SIZE),
      y: Math.floor((this.lastPoint.y + camera.y) / TILE_SIZE),
    };
  }

  // --- 座標変換(マウス/タッチ共通) -------------------------------------------------

  private toCanvasPointFromClient(clientX: number, clientY: number): Point {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  private toCanvasPoint(event: MouseEvent): Point {
    return this.toCanvasPointFromClient(event.clientX, event.clientY);
  }

  private findTouch(list: TouchList): Touch | null {
    if (this.activeTouchId === null) return list.item(0);
    for (let i = 0; i < list.length; i++) {
      const touch = list.item(i);
      if (touch && touch.identifier === this.activeTouchId) return touch;
    }
    return null;
  }

  // --- パレット/選択スロット -----------------------------------------------------

  private isUnlocked(slot: number): boolean {
    return this.terrainMaster[slot]?.unlocked ?? false;
  }

  private selectSlotIfUnlocked(slot: number): void {
    if (slot < 0 || slot >= this.terrainMaster.length) return;
    if (!this.isUnlocked(slot)) return;
    this.selectedSlot = slot;
    this.queue.push({ type: 'selectSlot', slot });
  }

  private selectEraser(): void {
    this.selectedSlot = 'eraser';
    this.queue.push({ type: 'selectSlot', slot: 'eraser' });
  }

  /** A/D・矢印キーでの循環選択対象(ロック解除済みの地形スロット + 消去スロット)を順番に並べたもの */
  private selectableSlots(): PaletteSlot[] {
    const count = Math.min(PALETTE_SLOT_COUNT, this.terrainMaster.length);
    const slots: PaletteSlot[] = [];
    for (let i = 0; i < count; i++) {
      if (this.isUnlocked(i)) slots.push(i);
    }
    slots.push('eraser');
    return slots;
  }

  private cycleSlot(direction: 1 | -1): void {
    const slots = this.selectableSlots();
    if (slots.length === 0) return;
    const currentIndex = slots.indexOf(this.selectedSlot);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = ((baseIndex + direction) % slots.length + slots.length) % slots.length;
    const next = slots[nextIndex];
    if (next === undefined) return;
    if (next === 'eraser') {
      this.selectEraser();
    } else {
      this.selectSlotIfUnlocked(next);
    }
  }

  /** パレット領域のタップ/クリック位置から、地形スロットまたは消去スロットを選択する */
  private handlePaletteTap(point: Point): void {
    const eraserRect = eraserSlotRect();
    if (
      point.x >= eraserRect.x &&
      point.x <= eraserRect.x + eraserRect.w &&
      point.y >= eraserRect.y &&
      point.y <= eraserRect.y + eraserRect.h
    ) {
      this.selectEraser();
      return;
    }

    const count = Math.min(PALETTE_SLOT_COUNT, this.terrainMaster.length);
    for (let i = 0; i < count; i++) {
      const rect = paletteSlotRect(i);
      if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) {
        this.selectSlotIfUnlocked(i);
        return;
      }
    }
  }

  /** ゲーム領域での主操作(左クリック/タップ)。消去スロット選択中でも常にplaceTerrainを発行し、
   * terrainIdの解釈(地形生成か消去か)はgame.ts側がselectedSlotを見て判断する。 */
  private handlePrimaryAction(point: Point): void {
    if (this.selectedSlot !== 'eraser') {
      const terrain = this.terrainMaster[this.selectedSlot];
      if (!terrain || !terrain.unlocked) return;
    }

    const camera = this.getCamera();
    const tileX = Math.floor((point.x + camera.x) / TILE_SIZE);
    const tileY = Math.floor((point.y + camera.y) / TILE_SIZE);
    const terrainId = this.selectedSlot === 'eraser' ? '' : (this.terrainMaster[this.selectedSlot]?.id ?? '');
    this.queue.push({ type: 'placeTerrain', terrainId, x: tileX, y: tileY });
  }

  private queueEraseAt(point: Point): void {
    const camera = this.getCamera();
    const tileX = Math.floor((point.x + camera.x) / TILE_SIZE);
    const tileY = Math.floor((point.y + camera.y) / TILE_SIZE);
    this.queue.push({ type: 'eraseTile', x: tileX, y: tileY });
  }

  // --- マウス操作 -------------------------------------------------------------

  private handleMouseMove = (event: MouseEvent): void => {
    this.lastPoint = this.toCanvasPoint(event);
  };

  private handleMouseLeave = (): void => {
    this.lastPoint = null;
  };

  private handleMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    const point = this.toCanvasPoint(event);

    if (point.y >= GAME_AREA_HEIGHT) {
      this.handlePaletteTap(point);
      return;
    }

    this.handlePrimaryAction(point);
  };

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const point = this.toCanvasPoint(event);
    if (point.y >= GAME_AREA_HEIGHT) return;
    this.queueEraseAt(point);
  };

  // --- タッチ操作 -------------------------------------------------------------
  // touchstart/touchmove/touchendすべてでpreventDefaultし、スクロール・ダブルタップズーム・
  // 合成マウスイベント(タッチ後に発火するclick/mousedown等)の二重発火を防ぐ。

  private handleTouchStart = (event: TouchEvent): void => {
    event.preventDefault();
    const touch = event.changedTouches.item(0);
    if (!touch) return;
    this.activeTouchId = touch.identifier;
    this.lastPoint = this.toCanvasPointFromClient(touch.clientX, touch.clientY);
  };

  private handleTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
    const touch = this.findTouch(event.touches);
    if (!touch) return;
    this.lastPoint = this.toCanvasPointFromClient(touch.clientX, touch.clientY);
  };

  private handleTouchEnd = (event: TouchEvent): void => {
    event.preventDefault();
    const touch = this.findTouch(event.changedTouches);
    this.activeTouchId = null;
    if (!touch) {
      this.lastPoint = null;
      return;
    }
    const point = this.toCanvasPointFromClient(touch.clientX, touch.clientY);

    if (point.y >= GAME_AREA_HEIGHT) {
      this.handlePaletteTap(point);
    } else {
      // 指を離した位置で生成/消去する(タッチ中の移動はプレビューのみ駆動する)
      this.handlePrimaryAction(point);
    }
    this.lastPoint = null;
  };

  private handleTouchCancel = (event: TouchEvent): void => {
    event.preventDefault();
    this.activeTouchId = null;
    this.lastPoint = null;
  };

  // --- キーボード操作 -----------------------------------------------------------

  private handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    if (key === 'a' || key === 'A' || key === 'ArrowLeft') {
      this.cycleSlot(-1);
    } else if (key === 'd' || key === 'D' || key === 'ArrowRight') {
      this.cycleSlot(1);
    } else if (key === '9') {
      this.selectEraser();
    } else if (/^[1-8]$/.test(key)) {
      this.selectSlotIfUnlocked(Number(key) - 1);
    }
  };
}
