// 同梱ステージ(stage01〜stage10、セグメント合成方式で生成された可変長ステージ)の
// クリア可能性を検証する回帰テスト。
// 自動ジャンプだけでは越えられない穴(gaps、幅6〜10タイル)に対して、プレイヤーが実際に近づいた
// タイミングでスクリプト化された地形配置コマンドを与えてupdateをシミュレートし、
// ジャンプマンが死亡せずゴールに到達する(status: Cleared)ことを確認する。
// マナは実際のコマンド経由で消費させ(チートしない)、各穴の橋は「その場に近づいてから」置く
// (frame0で全部まとめて置かない)ことで、実際のマナ回復収支に依存した配置になっていることを示す。
//
// 「橋が必要な位置リスト」はスクリプト側で座標を二重管理しないよう、
// scripts/generateStages.mjs が書き出す gaps.generated.json をそのまま読み込んで使う
// (生成器が出力し、テストがそれを使う、という現行パターンを維持)。
import { describe, expect, it } from 'vitest';
import { validateStage } from './schema';
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
import gapsData from './stages/gaps.generated.json';
import { FIXED_DT } from '../core/constants';
import { createGameState, update } from '../core/game';
import type { GameState } from '../core/game';
import type { Command } from '../core/commands';
import { GameStatus } from '../core/types';
import type { StageData, TerrainDefinition } from '../core/types';

// テスト専用の橋渡し地形マスタ(同梱terrainMaster.jsonの横5マス/横3マス/1マスと同コスト・同形状)。
// 実際のゲームパレットと独立させ、このテストが terrainMaster.json の将来的な変更に
// 影響されないようにしている。
const BRIDGE_TERRAINS: TerrainDefinition[] = [
  { id: 'h5', name: '横5マス', cost: 3, unlocked: true, unlockCost: 0, grid: ['NNNNN'] },
  { id: 'h3', name: '横3マス', cost: 2, unlocked: true, unlockCost: 0, grid: ['NNN'] },
  { id: 'block1', name: '1マス', cost: 1, unlocked: true, unlockCost: 0, grid: ['N'] },
];

/** 幅(5以上の任意値)を、5マス/3マス/1マスの橋パーツの組み合わせ(貪欲法)に分解する */
function bridgePiecesForWidth(width: number): { terrainId: string; offset: number }[] {
  const pieces: { terrainId: string; offset: number }[] = [];
  let remaining = width;
  let offset = 0;
  while (remaining >= 5) {
    pieces.push({ terrainId: 'h5', offset });
    offset += 5;
    remaining -= 5;
  }
  while (remaining >= 3) {
    pieces.push({ terrainId: 'h3', offset });
    offset += 3;
    remaining -= 3;
  }
  while (remaining >= 1) {
    pieces.push({ terrainId: 'block1', offset });
    offset += 1;
    remaining -= 1;
  }
  return pieces;
}

/** 指定x座標まで(ジャンプマンが到達するまで)何もせずシミュレートを進める */
function runUntilPastX(state: GameState, targetX: number, maxSteps: number): { state: GameState; steps: number } {
  let s = state;
  let steps = 0;
  while (s.jumpman.position.x < targetX && s.status !== GameStatus.Cleared && steps < maxSteps) {
    s = update(s, [], FIXED_DT);
    steps += 1;
  }
  return { state: s, steps };
}

function runUntilClearedOrTimeout(state: GameState, maxSteps: number): { state: GameState; steps: number } {
  let s = state;
  let steps = 0;
  while (s.status !== GameStatus.Cleared && steps < maxSteps) {
    s = update(s, [], FIXED_DT);
    steps += 1;
  }
  return { state: s, steps };
}

/**
 * ステージの全gapを「プレイヤーが近づいたタイミングで橋を架ける」実プレイに近い手順でシミュレートし、
 * 死亡せずゴールに到達する(Cleared)ことを検証する。
 * gapsは各穴の { x, width, y }(yはその穴の床の高さ)を到達順に並べたもの。
 */
function simulateStageWithJustInTimeBridges(
  stageData: StageData,
  gaps: readonly { x: number; width: number; y: number }[],
  maxStepsPerLeg: number,
): { finalState: GameState; totalSteps: number } {
  let state = createGameState(stageData, BRIDGE_TERRAINS);
  let totalSteps = 0;

  for (const gap of gaps) {
    // 穴の手前(十分な余裕を持って)まで自動走行だけで進める
    const approachX = gap.x - 10;
    const { state: nearState, steps: approachSteps } = runUntilPastX(state, approachX, maxStepsPerLeg);
    expect(approachSteps).toBeLessThan(maxStepsPerLeg); // タイムアウトしていない(=到達できている)
    state = nearState;
    totalSteps += approachSteps;

    // 橋を架ける(実際のマナ消費を伴う。マナ不足なら以降のアサーションで検出される)
    const manaBefore = state.mana.current;
    const commands: Command[] = bridgePiecesForWidth(gap.width).map((piece) => ({
      type: 'placeTerrain',
      terrainId: piece.terrainId,
      x: gap.x + piece.offset,
      y: gap.y,
    }));
    state = update(state, commands, FIXED_DT);
    totalSteps += 1;

    // 橋が実際に生成され、マナが実際のコスト分だけ消費されたこと(チートしていないこと)を確認
    for (let x = gap.x; x < gap.x + gap.width; x++) {
      expect(state.grid.isSolid(x, gap.y)).toBe(true);
    }
    expect(state.mana.current).toBeLessThan(manaBefore);
    expect(state.mana.current).toBeGreaterThanOrEqual(0);
  }

  // 最後の穴を過ぎたら、ゴールまで自動走行のみでシミュレートする
  const { state: finalState, steps: finalSteps } = runUntilClearedOrTimeout(state, maxStepsPerLeg * 3);
  totalSteps += finalSteps;

  return { finalState, totalSteps };
}

function loadStage(raw: unknown, label: string): StageData {
  const result = validateStage(raw);
  if (!result.ok) {
    throw new Error(`${label} のスキーマ検証に失敗しました: ${result.errors.join(', ')}`);
  }
  return result.value;
}

// RUN_SPEED半減(v5-1の初期調整、6→3)により同じ距離の走行に約2倍のフレーム数がかかるため、
// 1区間あたりのタイムアウト予算も2倍にする(元は4000)。
const MAX_STEPS_PER_LEG = 8000;

interface GapEntry {
  x: number;
  width: number;
  y: number;
}

const STAGES: { id: string; raw: unknown; timeoutMultiplier: number }[] = [
  { id: 'stage01', raw: stage01Raw, timeoutMultiplier: 4 },
  { id: 'stage02', raw: stage02Raw, timeoutMultiplier: 5 },
  { id: 'stage03', raw: stage03Raw, timeoutMultiplier: 5 },
  { id: 'stage04', raw: stage04Raw, timeoutMultiplier: 6 },
  { id: 'stage05', raw: stage05Raw, timeoutMultiplier: 7 },
  { id: 'stage06', raw: stage06Raw, timeoutMultiplier: 8 },
  { id: 'stage07', raw: stage07Raw, timeoutMultiplier: 10 },
  { id: 'stage08', raw: stage08Raw, timeoutMultiplier: 10 },
  { id: 'stage09', raw: stage09Raw, timeoutMultiplier: 8 },
  { id: 'stage10', raw: stage10Raw, timeoutMultiplier: 10 },
];

const GAPS_BY_STAGE = gapsData as Record<string, GapEntry[]>;

describe('同梱ステージ(全10本)のクリア可能性(実プレイに近い、その場での橋渡しによる検証)', () => {
  for (const { id, raw, timeoutMultiplier } of STAGES) {
    it(`${id}.json: 生成器が出力したgapsをその場で橋渡しすれば死亡せずゴールに到達できる`, () => {
      const stageData = loadStage(raw, `${id}.json`);
      const gaps = GAPS_BY_STAGE[id] ?? [];
      expect(gaps.length).toBeGreaterThan(0);

      const { finalState, totalSteps } = simulateStageWithJustInTimeBridges(stageData, gaps, MAX_STEPS_PER_LEG);

      expect(finalState.status).toBe(GameStatus.Cleared);
      expect(totalSteps).toBeLessThan(MAX_STEPS_PER_LEG * timeoutMultiplier);
      expect(finalState.jumpman.hp).toBeGreaterThan(0);
    });
  }
});

describe('スクリプト生成ステージの構造的な健全性', () => {
  it('各ステージの完全平坦(装飾の無いflat床)な連続区間は25タイル未満である(平坦が延々続く構造の排除)', () => {
    for (const { id, raw } of STAGES) {
      const stageData = loadStage(raw, `${id}.json`);
      const floorTopY = stageData.height - 2;
      const isPlainFlat = (x: number): boolean => {
        if (stageData.tiles[floorTopY]?.[x] !== 'N') return false;
        for (let y = 0; y < floorTopY; y++) {
          if (stageData.tiles[y]?.[x] !== '.') return false;
        }
        return true;
      };
      let maxRun = 0;
      let run = 0;
      for (let x = 0; x < stageData.width; x++) {
        if (isPlainFlat(x)) {
          run += 1;
          maxRun = Math.max(maxRun, run);
        } else {
          run = 0;
        }
      }
      expect(maxRun, `${id}: 完全平坦の最大連続長`).toBeLessThan(25);
    }
  });

  it('各ステージはコインをちょうど5枚持つ', () => {
    for (const { id, raw } of STAGES) {
      const stageData = loadStage(raw, `${id}.json`);
      expect(stageData.coins, id).toHaveLength(5);
    }
  });

  it('start/goal/checkpointsはgap(要橋渡しの穴)のx範囲上に置かれていない(足場が無い位置に配置されていない)', () => {
    for (const { id, raw } of STAGES) {
      const stageData = loadStage(raw, `${id}.json`);
      const gaps = GAPS_BY_STAGE[id] ?? [];
      const inGap = (x: number): boolean => gaps.some((g) => x >= g.x && x < g.x + g.width);

      expect(inGap(stageData.start.x), `${id}: start`).toBe(false);
      expect(inGap(stageData.goal.x), `${id}: goal`).toBe(false);
      stageData.checkpoints.forEach((cp, index) => {
        expect(inGap(cp.x), `${id}: checkpoints[${index}]`).toBe(false);
      });
    }
  });

  it('番号が進むほどステージ幅が広くなる(400〜600の範囲)', () => {
    let prevWidth = 0;
    for (const { id, raw } of STAGES) {
      const stageData = loadStage(raw, `${id}.json`);
      expect(stageData.width, `${id}.width`).toBeGreaterThanOrEqual(400);
      expect(stageData.width, `${id}.width`).toBeLessThanOrEqual(600);
      expect(stageData.width, `${id}: 前ステージ以上の幅`).toBeGreaterThanOrEqual(prevWidth);
      prevWidth = stageData.width;
    }
  });
});
