// 同梱ステージ(stage01〜stage05、各約600タイル)のクリア可能性を検証する回帰テスト。
// 自動ジャンプだけでは越えられない穴(gaps、幅8〜9タイル)に対して、プレイヤーが実際に近づいた
// タイミングでスクリプト化された地形配置コマンドを与えてupdateをシミュレートし、
// ジャンプマンが死亡せずゴールに到達する(status: Cleared)ことを確認する。
// マナは実際のコマンド経由で消費させ(チートしない)、各穴の橋は「その場に近づいてから」置く
// (frame0で全部まとめて置かない)ことで、実際のマナ回復収支に依存した配置になっていることを示す。
import { describe, expect, it } from 'vitest';
import { validateStage } from './schema';
import stage01Raw from './stages/stage01.json';
import stage02Raw from './stages/stage02.json';
import stage03Raw from './stages/stage03.json';
import stage04Raw from './stages/stage04.json';
import stage05Raw from './stages/stage05.json';
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

/** 幅(8か9)から橋の内訳(h5+h3、または h5+h3+block1)を返す */
function bridgePiecesForWidth(width: number): { terrainId: string; offset: number }[] {
  if (width === 8) return [{ terrainId: 'h5', offset: 0 }, { terrainId: 'h3', offset: 5 }];
  if (width === 9) return [{ terrainId: 'h5', offset: 0 }, { terrainId: 'h3', offset: 5 }, { terrainId: 'block1', offset: 8 }];
  throw new Error(`このテストヘルパーは幅8/9の穴のみ対応: ${width}`);
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
 * gapsは各穴の { x, width, y }(yはその穴の床の高さ=floorTopY)を到達順に並べたもの。
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

describe('同梱ステージのクリア可能性(実プレイに近い、その場での橋渡しによる検証)', () => {
  it('stage01.json: 穴(x=150, 幅8)を橋渡しすれば死亡せずゴールに到達できる', () => {
    const stageData = loadStage(stage01Raw, 'stage01.json');
    const gaps = [{ x: 150, width: 8, y: stageData.height - 2 }];
    const { finalState, totalSteps } = simulateStageWithJustInTimeBridges(stageData, gaps, MAX_STEPS_PER_LEG);

    expect(finalState.status).toBe(GameStatus.Cleared);
    expect(totalSteps).toBeLessThan(MAX_STEPS_PER_LEG * 4);
    expect(finalState.jumpman.hp).toBeGreaterThan(0);
  });

  it('stage02.json: 穴2箇所(x=150/400、幅8/9)を橋渡しすれば死亡せずゴールに到達できる(壊れる/落ちる/トゲを通過する)', () => {
    const stageData = loadStage(stage02Raw, 'stage02.json');
    const gaps = [
      { x: 150, width: 8, y: stageData.height - 2 },
      { x: 400, width: 9, y: stageData.height - 2 },
    ];
    const { finalState, totalSteps } = simulateStageWithJustInTimeBridges(stageData, gaps, MAX_STEPS_PER_LEG);

    expect(finalState.status).toBe(GameStatus.Cleared);
    expect(totalSteps).toBeLessThan(MAX_STEPS_PER_LEG * 4);
    expect(finalState.jumpman.hp).toBeGreaterThan(0);
  });

  it('stage03.json: 穴3箇所(x=120/300/470)を橋渡しすれば死亡せずゴールに到達できる', () => {
    const stageData = loadStage(stage03Raw, 'stage03.json');
    const gaps = [
      { x: 120, width: 8, y: stageData.height - 2 },
      { x: 300, width: 9, y: stageData.height - 2 },
      { x: 470, width: 8, y: stageData.height - 2 },
    ];
    const { finalState, totalSteps } = simulateStageWithJustInTimeBridges(stageData, gaps, MAX_STEPS_PER_LEG);

    expect(finalState.status).toBe(GameStatus.Cleared);
    expect(totalSteps).toBeLessThan(MAX_STEPS_PER_LEG * 5);
    expect(finalState.jumpman.hp).toBeGreaterThan(0);
  });

  it('stage04.json: 穴4箇所(x=100/260/420/540)を橋渡しすれば死亡せずゴールに到達できる', () => {
    const stageData = loadStage(stage04Raw, 'stage04.json');
    const gaps = [
      { x: 100, width: 8, y: stageData.height - 2 },
      { x: 260, width: 9, y: stageData.height - 2 },
      { x: 420, width: 8, y: stageData.height - 2 },
      { x: 540, width: 9, y: stageData.height - 2 },
    ];
    const { finalState, totalSteps } = simulateStageWithJustInTimeBridges(stageData, gaps, MAX_STEPS_PER_LEG);

    expect(finalState.status).toBe(GameStatus.Cleared);
    expect(totalSteps).toBeLessThan(MAX_STEPS_PER_LEG * 6);
    expect(finalState.jumpman.hp).toBeGreaterThan(0);
  });

  it('stage05.json: 穴5箇所(x=90/220/350/470/560)を橋渡しすれば死亡せずゴールに到達できる(最終ステージ)', () => {
    const stageData = loadStage(stage05Raw, 'stage05.json');
    const gaps = [
      { x: 90, width: 8, y: stageData.height - 2 },
      { x: 220, width: 9, y: stageData.height - 2 },
      { x: 350, width: 8, y: stageData.height - 2 },
      { x: 470, width: 9, y: stageData.height - 2 },
      { x: 560, width: 8, y: stageData.height - 2 },
    ];
    const { finalState, totalSteps } = simulateStageWithJustInTimeBridges(stageData, gaps, MAX_STEPS_PER_LEG);

    expect(finalState.status).toBe(GameStatus.Cleared);
    expect(totalSteps).toBeLessThan(MAX_STEPS_PER_LEG * 7);
    expect(finalState.jumpman.hp).toBeGreaterThan(0);
  });
});
