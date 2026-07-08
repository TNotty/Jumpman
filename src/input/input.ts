// マウス/キー入力 → Command 変換。パレット領域(画面下1/6)とゲーム領域でハンドリングを分岐する。
// パレットスロットの内容(terrainMaster)を知っているのはInputManagerで、選択中スロットの
// terrainIdをplaceTerrainコマンドに解決する。ロック中のスロットは選択・配置ともに不可。
import { GAME_AREA_HEIGHT, PALETTE_SLOT_COUNT, TILE_SIZE } from '../core/constants';
import type { Command } from '../core/commands';
import type { TerrainDefinition } from '../core/types';
import type { CameraState } from '../render/camera';
import { paletteSlotRect } from '../render/renderer';

export class InputManager {
  private queue: Command[] = [];
  private selectedSlot = 0;
  private lastPoint: { x: number; y: number } | null = null;

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
    window.addEventListener('keydown', this.handleKeyDown);
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  /** このフレームに溜まったコマンドを取り出し、キューを空にする */
  drain(): Command[] {
    const commands = this.queue;
    this.queue = [];
    return commands;
  }

  getSelectedSlot(): number {
    return this.selectedSlot;
  }

  /** 現在のマウス位置に対応するワールドタイル座標(ゲーム領域内のときのみ)。配置プレビュー用 */
  getHoverTile(): { x: number; y: number } | null {
    if (!this.lastPoint || this.lastPoint.y >= GAME_AREA_HEIGHT) return null;
    const camera = this.getCamera();
    return {
      x: Math.floor((this.lastPoint.x + camera.x) / TILE_SIZE),
      y: Math.floor((this.lastPoint.y + camera.y) / TILE_SIZE),
    };
  }

  private toCanvasPoint(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  private isUnlocked(slot: number): boolean {
    return this.terrainMaster[slot]?.unlocked ?? false;
  }

  private selectSlotIfUnlocked(slot: number): void {
    if (slot < 0 || slot >= this.terrainMaster.length) return;
    if (!this.isUnlocked(slot)) return;
    this.selectedSlot = slot;
    this.queue.push({ type: 'selectSlot', slot });
  }

  private cycleSlot(direction: 1 | -1): void {
    const count = Math.min(PALETTE_SLOT_COUNT, this.terrainMaster.length);
    if (count === 0) return;
    for (let i = 1; i <= count; i++) {
      const candidate = (((this.selectedSlot + direction * i) % count) + count) % count;
      if (this.isUnlocked(candidate)) {
        this.selectSlotIfUnlocked(candidate);
        return;
      }
    }
  }

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
      const count = Math.min(PALETTE_SLOT_COUNT, this.terrainMaster.length);
      for (let i = 0; i < count; i++) {
        const rect = paletteSlotRect(i);
        if (point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h) {
          this.selectSlotIfUnlocked(i);
          return;
        }
      }
      return;
    }

    const terrain = this.terrainMaster[this.selectedSlot];
    if (!terrain || !terrain.unlocked) return;

    const camera = this.getCamera();
    const tileX = Math.floor((point.x + camera.x) / TILE_SIZE);
    const tileY = Math.floor((point.y + camera.y) / TILE_SIZE);
    this.queue.push({ type: 'placeTerrain', terrainId: terrain.id, x: tileX, y: tileY });
  };

  private handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const point = this.toCanvasPoint(event);
    if (point.y >= GAME_AREA_HEIGHT) return;
    const camera = this.getCamera();
    const tileX = Math.floor((point.x + camera.x) / TILE_SIZE);
    const tileY = Math.floor((point.y + camera.y) / TILE_SIZE);
    this.queue.push({ type: 'eraseTile', x: tileX, y: tileY });
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const key = event.key;
    if (key === 'a' || key === 'A' || key === 'ArrowLeft') {
      this.cycleSlot(-1);
    } else if (key === 'd' || key === 'D' || key === 'ArrowRight') {
      this.cycleSlot(1);
    } else if (/^[1-8]$/.test(key)) {
      this.selectSlotIfUnlocked(Number(key) - 1);
    }
  };
}
