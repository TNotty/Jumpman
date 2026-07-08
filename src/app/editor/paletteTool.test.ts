import { describe, expect, it } from 'vitest';
import { EditorTool, TOOL_ORDER, blockTypeForTool, enemyTypeForTool, isPaintTool, toolFromKey } from './paletteTool';
import { BlockType, EnemyType } from '../../core/types';

describe('toolFromKey', () => {
  it("'1'〜'9' はTOOL_ORDERの先頭9件に対応する", () => {
    for (let i = 1; i <= 9; i++) {
      expect(toolFromKey(String(i))).toBe(TOOL_ORDER[i - 1]);
    }
  });

  it('範囲外・非数字キーは null を返す', () => {
    expect(toolFromKey('0')).toBeNull();
    expect(toolFromKey('a')).toBeNull();
    expect(toolFromKey('')).toBeNull();
  });
});

describe('blockTypeForTool / enemyTypeForTool', () => {
  it('ブロックツールは対応するBlockTypeを返す', () => {
    expect(blockTypeForTool(EditorTool.BlockNormal)).toBe(BlockType.Normal);
    expect(blockTypeForTool(EditorTool.BlockBreakable)).toBe(BlockType.Breakable);
    expect(blockTypeForTool(EditorTool.BlockSpike)).toBe(BlockType.Spike);
    expect(blockTypeForTool(EditorTool.BlockFalling)).toBe(BlockType.Falling);
  });

  it('ブロック以外のツールは null を返す', () => {
    expect(blockTypeForTool(EditorTool.Eraser)).toBeNull();
    expect(blockTypeForTool(EditorTool.Start)).toBeNull();
    expect(blockTypeForTool(EditorTool.EnemySlime)).toBeNull();
  });

  it('敵ツールは対応するEnemyTypeを返す', () => {
    expect(enemyTypeForTool(EditorTool.EnemySlime)).toBe(EnemyType.Slime);
    expect(enemyTypeForTool(EditorTool.EnemyFrog)).toBe(EnemyType.Frog);
    expect(enemyTypeForTool(EditorTool.EnemyBird)).toBe(EnemyType.Bird);
  });

  it('敵以外のツールは null を返す', () => {
    expect(enemyTypeForTool(EditorTool.BlockNormal)).toBeNull();
    expect(enemyTypeForTool(EditorTool.Goal)).toBeNull();
  });
});

describe('isPaintTool', () => {
  it('ブロック塗り・消しゴムは連続ペイント可能', () => {
    expect(isPaintTool(EditorTool.BlockNormal)).toBe(true);
    expect(isPaintTool(EditorTool.BlockBreakable)).toBe(true);
    expect(isPaintTool(EditorTool.Eraser)).toBe(true);
  });

  it('単発配置ツール(スタート/ゴール/チェックポイント/敵)は連続ペイント不可', () => {
    expect(isPaintTool(EditorTool.Start)).toBe(false);
    expect(isPaintTool(EditorTool.Goal)).toBe(false);
    expect(isPaintTool(EditorTool.Checkpoint)).toBe(false);
    expect(isPaintTool(EditorTool.EnemySlime)).toBe(false);
  });
});
