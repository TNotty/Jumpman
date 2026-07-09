// 同梱データ(ステージJSON・地形マスタJSON)がスキーマに準拠していることを保証する回帰テスト。
import { describe, expect, it } from 'vitest';
import { validateStage, validateTerrainMaster } from './schema';
import stage01Raw from './stages/stage01.json';
import stage02Raw from './stages/stage02.json';
import stage03Raw from './stages/stage03.json';
import stage04Raw from './stages/stage04.json';
import stage05Raw from './stages/stage05.json';
import terrainMasterRaw from './terrainMaster.json';

const STAGES = [
  { id: 'stage01', raw: stage01Raw, theme: 'grass' },
  { id: 'stage02', raw: stage02Raw, theme: 'cave' },
  { id: 'stage03', raw: stage03Raw, theme: 'grass' },
  { id: 'stage04', raw: stage04Raw, theme: 'cave' },
  { id: 'stage05', raw: stage05Raw, theme: 'grass' },
] as const;

describe('同梱ステージJSON(5本、各約600タイル)', () => {
  it.each(STAGES)('$id はスキーマに準拠し、幅約600・チェックポイント3〜4個を持つ', ({ id, raw, theme }) => {
    const result = validateStage(raw);
    if (!result.ok) {
      throw new Error(`${id} validation failed: ${result.errors.join(', ')}`);
    }
    expect(result.value.theme).toBe(theme);
    expect(result.value.width).toBeGreaterThanOrEqual(500);
    expect(result.value.checkpoints.length).toBeGreaterThanOrEqual(3);
    expect(result.value.checkpoints.length).toBeLessThanOrEqual(4);
  });

  it('stage02.json は cave テーマで壊れる/トゲ/落ちるブロックをすべて含む', () => {
    const result = validateStage(stage02Raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const joined = result.value.tiles.join('');
    expect(joined).toContain('B'); // 壊れるブロック
    expect(joined).toContain('S'); // トゲ
    expect(joined).toContain('F'); // 落ちるブロック
  });

  it('stage04.json/stage05.json は stage01.json より敵密度が高い(難易度カーブの確認)', () => {
    const r1 = validateStage(stage01Raw);
    const r4 = validateStage(stage04Raw);
    const r5 = validateStage(stage05Raw);
    if (!r1.ok || !r4.ok || !r5.ok) throw new Error('validation failed');
    expect(r4.value.enemies.length).toBeGreaterThan(r1.value.enemies.length);
    expect(r5.value.enemies.length).toBeGreaterThan(r1.value.enemies.length);
  });

  it.each(STAGES)('$id はコインをちょうど5枚持つ(推奨枚数)', ({ raw }) => {
    const result = validateStage(raw);
    if (!result.ok) throw new Error('validation failed');
    expect(result.value.coins).toHaveLength(5);
  });
});

describe('同梱地形マスタJSON', () => {
  it('terrainMaster.json はスキーマに準拠し、18種(初期解放3種+未解放15種)を持つ', () => {
    const result = validateTerrainMaster(terrainMasterRaw);
    if (!result.ok) {
      throw new Error(`terrainMaster.json validation failed: ${result.errors.join(', ')}`);
    }
    expect(result.value.terrains).toHaveLength(18);

    const unlocked = result.value.terrains.filter((t) => t.unlocked);
    const locked = result.value.terrains.filter((t) => !t.unlocked);
    expect(unlocked).toHaveLength(3);
    expect(locked).toHaveLength(15);
    expect(unlocked.map((t) => t.id).sort()).toEqual(['h5', 'u', 'v3']);

    // 初期解放済みはunlockCost0、未解放は2〜6の範囲(要望どおりのバランス目安)
    for (const terrain of unlocked) {
      expect(terrain.unlockCost).toBe(0);
    }
    for (const terrain of locked) {
      expect(terrain.unlockCost).toBeGreaterThanOrEqual(2);
      expect(terrain.unlockCost).toBeLessThanOrEqual(6);
    }

    const ids = result.value.terrains.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // id重複が無い
  });
});
