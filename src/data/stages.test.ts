// 同梱データ(ステージJSON・地形マスタJSON)がスキーマに準拠していることを保証する回帰テスト。
import { describe, expect, it } from 'vitest';
import { validateStage, validateTerrainMaster } from './schema';
import stage01Raw from './stages/stage01.json';
import stage02Raw from './stages/stage02.json';
import terrainMasterRaw from './terrainMaster.json';

describe('同梱ステージJSON', () => {
  it('stage01.json はスキーマに準拠する', () => {
    const result = validateStage(stage01Raw);
    if (!result.ok) {
      throw new Error(`stage01.json validation failed: ${result.errors.join(', ')}`);
    }
    expect(result.ok).toBe(true);
  });

  it('stage02.json はスキーマに準拠する(cave テーマ・敵3種・特殊ブロック・要地形生成箇所を含む)', () => {
    const result = validateStage(stage02Raw);
    if (!result.ok) {
      throw new Error(`stage02.json validation failed: ${result.errors.join(', ')}`);
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.theme).toBe('cave');
    expect(result.value.checkpoints).toHaveLength(2);
    const enemyTypes = new Set(result.value.enemies.map((e) => e.type));
    expect(enemyTypes.size).toBe(3);
    expect(result.value.tiles.join('')).toContain('B'); // 壊れるブロック
    expect(result.value.tiles.join('')).toContain('S'); // トゲ
    expect(result.value.tiles.join('')).toContain('F'); // 落ちるブロック
  });
});

describe('同梱地形マスタJSON', () => {
  it('terrainMaster.json はスキーマに準拠する', () => {
    const result = validateTerrainMaster(terrainMasterRaw);
    if (!result.ok) {
      throw new Error(`terrainMaster.json validation failed: ${result.errors.join(', ')}`);
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.terrains.length).toBeGreaterThan(0);
    expect(result.value.terrains.length).toBeLessThanOrEqual(8);
  });
});
