// 入力から生成されるコマンド型。game.ts の update(state, commands, dt) が唯一の入口として消費する。
// 妥当性検証・適用ロジックは placement.ts(地形生成/消去)と game.ts(selectSlot)が担う。

export interface PlaceTerrainCommand {
  type: 'placeTerrain';
  /** terrainMaster.json 上の地形ID */
  terrainId: string;
  /** 配置基準点(グリッド左上セル) */
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
  /** パレット8枠のインデックス(0-7) */
  slot: number;
}

export type Command = PlaceTerrainCommand | EraseTileCommand | SelectSlotCommand;
