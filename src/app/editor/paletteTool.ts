// マップエディタのパレットツール(選択中の配置種別)。DOM非依存の純粋なマッピングロジック。
import { BlockType, EnemyType } from '../../core/types';

export enum EditorTool {
  BlockNormal = 'block_normal',
  BlockBreakable = 'block_breakable',
  BlockSpike = 'block_spike',
  BlockFalling = 'block_falling',
  Eraser = 'eraser',
  Start = 'start',
  Goal = 'goal',
  Checkpoint = 'checkpoint',
  EnemySlime = 'enemy_slime',
  EnemyFrog = 'enemy_frog',
  EnemyBird = 'enemy_bird',
  Coin = 'coin',
}

/** パレット表示順。先頭9件が数字キー1〜9に対応する */
export const TOOL_ORDER: readonly EditorTool[] = [
  EditorTool.BlockNormal,
  EditorTool.BlockBreakable,
  EditorTool.BlockSpike,
  EditorTool.BlockFalling,
  EditorTool.Eraser,
  EditorTool.Start,
  EditorTool.Goal,
  EditorTool.Checkpoint,
  EditorTool.EnemySlime,
  EditorTool.EnemyFrog,
  EditorTool.EnemyBird,
  // Coinは末尾に追加(数字キー1-9は先頭9件のみに対応するため、既存ツールのキー割り当てを
  // ずらさないようにする。マウス/タップでのみ選択する)。
  EditorTool.Coin,
];

export const TOOL_LABEL: Readonly<Record<EditorTool, string>> = {
  [EditorTool.BlockNormal]: '通常ブロック',
  [EditorTool.BlockBreakable]: '壊れるブロック',
  [EditorTool.BlockSpike]: 'トゲ',
  [EditorTool.BlockFalling]: '落ちるブロック',
  [EditorTool.Eraser]: '消しゴム',
  [EditorTool.Start]: 'スタート',
  [EditorTool.Goal]: 'ゴール',
  [EditorTool.Checkpoint]: 'チェックポイント',
  [EditorTool.EnemySlime]: 'スライム',
  [EditorTool.EnemyFrog]: 'カエル',
  [EditorTool.EnemyBird]: '鳥',
  [EditorTool.Coin]: 'コイン',
};

const BLOCK_TOOL_TYPE: Partial<Record<EditorTool, BlockType>> = {
  [EditorTool.BlockNormal]: BlockType.Normal,
  [EditorTool.BlockBreakable]: BlockType.Breakable,
  [EditorTool.BlockSpike]: BlockType.Spike,
  [EditorTool.BlockFalling]: BlockType.Falling,
};

const ENEMY_TOOL_TYPE: Partial<Record<EditorTool, EnemyType>> = {
  [EditorTool.EnemySlime]: EnemyType.Slime,
  [EditorTool.EnemyFrog]: EnemyType.Frog,
  [EditorTool.EnemyBird]: EnemyType.Bird,
};

/** ブロック塗りツールなら対応する BlockType を返す(それ以外は null) */
export function blockTypeForTool(tool: EditorTool): BlockType | null {
  return BLOCK_TOOL_TYPE[tool] ?? null;
}

/** 敵配置ツールなら対応する EnemyType を返す(それ以外は null) */
export function enemyTypeForTool(tool: EditorTool): EnemyType | null {
  return ENEMY_TOOL_TYPE[tool] ?? null;
}

/** 左ドラッグで連続ペイント可能なツール(ブロック塗り・消しゴム)か */
export function isPaintTool(tool: EditorTool): boolean {
  return tool === EditorTool.Eraser || blockTypeForTool(tool) !== null;
}

/** 数字キー('1'〜'9')から対応するツールを返す。対応が無ければ null */
export function toolFromKey(key: string): EditorTool | null {
  if (!/^[1-9]$/.test(key)) return null;
  const index = Number(key) - 1;
  return TOOL_ORDER[index] ?? null;
}
