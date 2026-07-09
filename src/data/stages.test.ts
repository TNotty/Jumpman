// 同梱データ(ステージJSON・地形マスタJSON)がスキーマに準拠していることを保証する回帰テスト。
import { describe, expect, it } from 'vitest';
import { validateStage, validateTerrainMaster } from './schema';
import stage01Raw from './stages/stage01.json';
import stage02Raw from './stages/stage02.json';
import stage03Raw from './stages/stage03.json';
import stage04Raw from './stages/stage04.json';
import stage05Raw from './stages/stage05.json';
import stage06Raw from './stages/stage06.json';
import stage07Raw from './stages/stage07.json';
import stage08Raw from './stages/stage08.json';
import stage09Raw from './stages/stage09.json';
import stage10Raw from './stages/stage10.json';
import terrainMasterRaw from './terrainMaster.json';

const STAGES = [
  { id: 'stage01', raw: stage01Raw, theme: 'grass' },
  { id: 'stage02', raw: stage02Raw, theme: 'cave' },
  { id: 'stage03', raw: stage03Raw, theme: 'grass' },
  { id: 'stage04', raw: stage04Raw, theme: 'cave' },
  { id: 'stage05', raw: stage05Raw, theme: 'grass' },
  { id: 'stage06', raw: stage06Raw, theme: 'cave' },
  { id: 'stage07', raw: stage07Raw, theme: 'grass' },
  { id: 'stage08', raw: stage08Raw, theme: 'cave' },
  { id: 'stage09', raw: stage09Raw, theme: 'grass' },
  { id: 'stage10', raw: stage10Raw, theme: 'cave' },
] as const;

describe('同梱ステージJSON(10本、幅400〜600・セグメント合成方式)', () => {
  it.each(STAGES)('$id はスキーマに準拠し、テーマ($theme)・幅400〜600・チェックポイント2個以上を持つ', ({ id, raw, theme }) => {
    const result = validateStage(raw);
    if (!result.ok) {
      throw new Error(`${id} validation failed: ${result.errors.join(', ')}`);
    }
    expect(result.value.theme).toBe(theme);
    expect(result.value.width).toBeGreaterThanOrEqual(400);
    expect(result.value.width).toBeLessThanOrEqual(600);
    expect(result.value.checkpoints.length).toBeGreaterThanOrEqual(2);
  });

  it('10ステージ全体で壊れる/トゲ/落ちるブロックをすべて含む(HP予算の都合で1ステージあたりのハザード数は少数に抑えているため、単一ステージではなく全体で確認する)', () => {
    const joined = STAGES.map(({ raw }) => {
      const result = validateStage(raw);
      if (!result.ok) throw new Error('validation failed');
      return result.value.tiles.join('');
    }).join('');
    expect(joined).toContain('B'); // 壊れるブロック
    expect(joined).toContain('S'); // トゲ
    expect(joined).toContain('F'); // 落ちるブロック
  });

  it('後半ステージ(stage08〜10)は序盤ステージ(stage01〜03)より平均敵数が多い(難易度カーブの確認)', () => {
    const early = [stage01Raw, stage02Raw, stage03Raw].map((raw) => {
      const result = validateStage(raw);
      if (!result.ok) throw new Error('validation failed');
      return result.value.enemies.length;
    });
    const late = [stage08Raw, stage09Raw, stage10Raw].map((raw) => {
      const result = validateStage(raw);
      if (!result.ok) throw new Error('validation failed');
      return result.value.enemies.length;
    });
    const avg = (arr: number[]): number => arr.reduce((s, n) => s + n, 0) / arr.length;
    expect(avg(late)).toBeGreaterThan(avg(early));
  });

  it('番号が進むほどステージ幅が広くなる(単調非減少)', () => {
    let prevWidth = 0;
    for (const { id, raw } of STAGES) {
      const result = validateStage(raw);
      if (!result.ok) throw new Error(`${id} validation failed`);
      expect(result.value.width, `${id}`).toBeGreaterThanOrEqual(prevWidth);
      prevWidth = result.value.width;
    }
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
