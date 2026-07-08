// 同梱ステージ(stage01/stage02)のクリア可能性を検証する回帰テスト。
// 自動ジャンプだけでは越えられない穴に対して、スクリプト化された地形配置コマンド列
// (特定フレームで特定位置にPlaceTerrain)を与えてupdateをシミュレートし、
// ジャンプマンが死亡せずゴールに到達する(status: Cleared)ことを確認する。
// マナは実際のコマンド経由で消費させる(チートしない)。
import { describe, expect, it } from 'vitest';
import { validateStage } from './schema';
import stage01Raw from './stages/stage01.json';
import stage02Raw from './stages/stage02.json';
import { FIXED_DT } from '../core/constants';
import { createGameState, update } from '../core/game';
import type { GameState } from '../core/game';
import type { Command } from '../core/commands';
import { BlockType, GameStatus } from '../core/types';
import type { TerrainDefinition } from '../core/types';

// テスト専用の橋渡し地形マスタ(同梱terrainMaster.jsonの横5マス/横3マス/1マスと同形状)。
// 実際のゲームパレットと独立させ、このテストが terrainMaster.json の将来的な変更に
// 影響されないようにしている。
const BRIDGE_TERRAINS: TerrainDefinition[] = [
  { id: 'h5', name: '横5マス', cost: 3, unlocked: true, grid: ['NNNNN'] },
  { id: 'h3', name: '横3マス', cost: 2, unlocked: true, grid: ['NNN'] },
  { id: 'block1', name: '1マス', cost: 1, unlocked: true, grid: ['N'] },
];

function simulateUntilClearedOrTimeout(initial: GameState, maxSteps: number): { state: GameState; steps: number } {
  let state = initial;
  let steps = 0;
  while (state.status !== GameStatus.Cleared && steps < maxSteps) {
    state = update(state, [], FIXED_DT);
    steps += 1;
  }
  return { state, steps };
}

describe('同梱ステージのクリア可能性(スクリプト化された地形配置による検証)', () => {
  it('stage01.json: 穴(x=40-47)を橋渡しすれば死亡せずゴールに到達できる', () => {
    const result = validateStage(stage01Raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    let state = createGameState(result.value, BRIDGE_TERRAINS);
    const initialMana = state.mana.current;

    // フレーム0: ジャンプマンが穴に到達するより十分前に橋を生成する(h5:x40-44 + h3:x45-47)
    const bridgeCommands: Command[] = [
      { type: 'placeTerrain', terrainId: 'h5', x: 40, y: 18 },
      { type: 'placeTerrain', terrainId: 'h3', x: 45, y: 18 },
    ];
    state = update(state, bridgeCommands, FIXED_DT);

    // 橋が実際に生成され、マナが実際のコスト分だけ消費されたこと(チートしていないこと)を確認
    for (let x = 40; x <= 47; x++) {
      expect(state.grid.get(x, 18)).toBe(BlockType.Normal);
    }
    expect(state.mana.current).toBeLessThan(initialMana);
    expect(state.mana.current).toBeGreaterThanOrEqual(0);

    const { state: finalState, steps } = simulateUntilClearedOrTimeout(state, 3000);

    expect(finalState.status).toBe(GameStatus.Cleared);
    expect(steps).toBeLessThan(3000);
    expect(finalState.jumpman.hp).toBeGreaterThan(0); // 死亡せずに到達したこと
  });

  it('stage02.json: 穴(x=40-48)を橋渡しすれば死亡せずゴールに到達できる(壊れる/落ちる/トゲを通過する)', () => {
    const result = validateStage(stage02Raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    let state = createGameState(result.value, BRIDGE_TERRAINS);
    const initialMana = state.mana.current;

    // フレーム0: h5(x40-44) + h3(x45-47) + block1(x48) で幅9の穴をちょうど橋渡しする
    const bridgeCommands: Command[] = [
      { type: 'placeTerrain', terrainId: 'h5', x: 40, y: 14 },
      { type: 'placeTerrain', terrainId: 'h3', x: 45, y: 14 },
      { type: 'placeTerrain', terrainId: 'block1', x: 48, y: 14 },
    ];
    state = update(state, bridgeCommands, FIXED_DT);

    for (let x = 40; x <= 48; x++) {
      expect(state.grid.get(x, 14)).toBe(BlockType.Normal);
    }
    expect(state.mana.current).toBeLessThan(initialMana);
    expect(state.mana.current).toBeGreaterThanOrEqual(0);

    const { state: finalState, steps } = simulateUntilClearedOrTimeout(state, 3000);

    expect(finalState.status).toBe(GameStatus.Cleared);
    expect(steps).toBeLessThan(3000);
  });
});
