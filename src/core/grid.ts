// タイルグリッド。Uint8Array による固定サイズの2次元配列と、座標変換・solid判定を提供する。
import { BLOCK_CHAR_MAP, BlockType, isSolidBlock } from './types';

export class TileGrid {
  readonly width: number;
  readonly height: number;
  private readonly cells: Uint8Array;

  constructor(width: number, height: number, cells?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.cells = cells ?? new Uint8Array(Math.max(0, width * height));
  }

  /** ステージ/地形マスタJSONの行文字列配列からグリッドを構築する */
  static fromRows(rows: readonly string[]): TileGrid {
    const height = rows.length;
    const width = height > 0 ? (rows[0]?.length ?? 0) : 0;
    const grid = new TileGrid(width, height);
    for (let y = 0; y < height; y++) {
      const row = rows[y] ?? '';
      for (let x = 0; x < width; x++) {
        const char = row[x] ?? '.';
        grid.set(x, y, BLOCK_CHAR_MAP[char] ?? BlockType.Empty);
      }
    }
    return grid;
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** グリッド範囲外は常に Empty を返す(境界壁は用意しない) */
  get(x: number, y: number): BlockType {
    if (!this.inBounds(x, y)) return BlockType.Empty;
    return (this.cells[this.index(x, y)] ?? BlockType.Empty) as BlockType;
  }

  set(x: number, y: number, type: BlockType): void {
    if (!this.inBounds(x, y)) return;
    this.cells[this.index(x, y)] = type;
  }

  isSolid(x: number, y: number): boolean {
    return isSolidBlock(this.get(x, y));
  }

  /** セル配列を複製した新しいグリッドを返す(地形生成/消去/破壊で元のグリッドを書き換えないため) */
  clone(): TileGrid {
    return new TileGrid(this.width, this.height, new Uint8Array(this.cells));
  }
}
