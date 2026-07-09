// 入力から生成されるコマンド型。game.ts の update(state, commands, dt) が唯一の入口として消費する。
// 妥当性検証・適用ロジックは placement.ts(地形生成/消去)と game.ts(selectSlot)が担う。
import type { PaletteSlot } from './types';

export interface PlaceTerrainCommand {
  type: 'placeTerrain';
  /**
   * terrainMaster.json 上の地形ID。選択中スロットが消去('eraser')の場合、game.tsは
   * このコマンドをterrainIdを見ずに1マス消去として扱う(空文字でよい)。
   */
  terrainId: string;
  /** 配置基準点(グリッド左上セル)。消去スロット選択中はここが消去対象セルになる */
  x: number;
  y: number;
}

export interface EraseTileCommand {
  type: 'eraseTile';
  x: number;
  y: number;
}

export interface SelectSlotCommand {
  type: 'selectSlot';
  /** パレット8枠のインデックス(0-7)、または常時選択可能な消去スロット('eraser') */
  slot: PaletteSlot;
}

export type Command = PlaceTerrainCommand | EraseTileCommand | SelectSlotCommand;
