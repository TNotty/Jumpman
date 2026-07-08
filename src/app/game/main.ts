// ゲーム本体のエントリポイント(index.html から読み込まれる)。
// core(純ロジック)・render・input・platform を接続する唯一の場所。
// シーン遷移(タイトル→ステージ選択→プレイ→クリア)はここで管理する(coreはシーンを知らない)。
import { JUMPMAN_WIDTH, LOGICAL_HEIGHT, LOGICAL_WIDTH, TILE_SIZE } from '../../core/constants';
import { createGameState, update as updateGame } from '../../core/game';
import type { GameState } from '../../core/game';
import { GameStatus } from '../../core/types';
import type { StageData, TerrainDefinition } from '../../core/types';
import { validateStage, validateTerrainMaster } from '../../data/schema';
import stage01Raw from '../../data/stages/stage01.json';
import stage02Raw from '../../data/stages/stage02.json';
import terrainMasterRaw from '../../data/terrainMaster.json';
import { AssetStore, loadAssets } from '../../render/assets';
import { createCamera, updateCamera } from '../../render/camera';
import type { CameraState } from '../../render/camera';
import { renderGame } from '../../render/renderer';
import {
  clearNextButtonRect,
  clearTitleButtonRect,
  drawClearButtons,
  drawStageSelectScreen,
  drawTitleScreen,
  pointInRect,
  stageSelectBoxRect,
} from '../../render/screens';
import type { StageMeta } from '../../render/screens';
import { InputManager } from '../../input/input';
import { loadJSON } from '../../platform/storage';
import { createLoop } from '../loop';

/** マップエディタ(Phase C)がテストプレイ用のdraftステージを書き込むキー */
export const DRAFT_STAGE_STORAGE_KEY = 'jumpman:draftStage';
/** 地形マスタエディタ(Phase C)がカスタム地形マスタを書き込むキー。存在すれば同梱JSONより優先する */
export const TERRAIN_MASTER_STORAGE_KEY = 'jumpman:terrainMaster';

interface StageEntry {
  id: string;
  data: StageData;
}

type Scene =
  | { kind: 'title' }
  | { kind: 'stageSelect' }
  | { kind: 'playing'; stageIndex: number; game: GameState; camera: CameraState }
  | { kind: 'clear'; stageIndex: number; game: GameState; camera: CameraState };

function getCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('#game-canvas が見つかりません');
  }
  return canvas;
}

function drawLoadingScreen(ctx: CanvasRenderingContext2D, message: string): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
}

function requireValidStage(raw: unknown, label: string): StageData {
  const result = validateStage(raw);
  if (!result.ok) {
    throw new Error(`${label} のスキーマ検証に失敗しました: ${result.errors.join(', ')}`);
  }
  return result.value;
}

async function main(): Promise<void> {
  const canvas = getCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D描画コンテキストの取得に失敗しました');
  }

  drawLoadingScreen(ctx, '読み込み中...');

  let stages: StageEntry[];
  try {
    stages = [
      { id: 'stage01', data: requireValidStage(stage01Raw, 'stage01.json') },
      { id: 'stage02', data: requireValidStage(stage02Raw, 'stage02.json') },
    ];
  } catch (error) {
    drawLoadingScreen(ctx, 'ステージデータが不正です');
    console.error(error);
    return;
  }

  // 地形マスタエディタ(Phase C)が保存したカスタム地形マスタがあれば優先し、無ければ同梱JSONを使う。
  let terrainMaster: TerrainDefinition[];
  const customTerrainMasterRaw = loadJSON<unknown>(TERRAIN_MASTER_STORAGE_KEY);
  const customTerrainMasterResult = customTerrainMasterRaw !== null ? validateTerrainMaster(customTerrainMasterRaw) : null;
  if (customTerrainMasterResult && customTerrainMasterResult.ok) {
    terrainMaster = customTerrainMasterResult.value.terrains;
  } else {
    if (customTerrainMasterResult && !customTerrainMasterResult.ok) {
      console.warn('カスタム地形マスタの検証に失敗したため、同梱の地形マスタを使用します', customTerrainMasterResult.errors);
    }
    const terrainMasterResult = validateTerrainMaster(terrainMasterRaw);
    if (terrainMasterResult.ok) {
      terrainMaster = terrainMasterResult.value.terrains;
    } else {
      console.error('terrainMaster.json validation errors:', terrainMasterResult.errors);
      terrainMaster = [];
    }
  }

  let assets: AssetStore;
  try {
    assets = await loadAssets('/assets');
  } catch (error) {
    drawLoadingScreen(ctx, 'アセットの読み込みに失敗しました');
    console.error(error);
    return;
  }

  function startPlaying(stageData: StageData, stageIndex: number): Scene {
    return { kind: 'playing', stageIndex, game: createGameState(stageData, terrainMaster), camera: createCamera() };
  }

  function hasNextStage(stageIndex: number): boolean {
    return stageIndex >= 0 && stageIndex + 1 < stages.length;
  }

  // ?stage=draft: マップエディタ(Phase C)からのテストプレイ連携。
  // localStorageに保存されたdraftステージがあれば、タイトル/選択をスキップして直接プレイする。
  let scene: Scene = { kind: 'title' };
  const params = new URLSearchParams(window.location.search);
  if (params.get('stage') === 'draft') {
    const draftRaw = loadJSON<unknown>(DRAFT_STAGE_STORAGE_KEY);
    const draftResult = draftRaw !== null ? validateStage(draftRaw) : null;
    if (draftResult && draftResult.ok) {
      scene = startPlaying(draftResult.value, -1);
    } else {
      console.warn(
        'draftステージの読込に失敗したため、タイトル画面を表示します',
        draftResult && !draftResult.ok ? draftResult.errors : '(localStorageにdraftが見つかりません)',
      );
    }
  }

  let animTime = 0;

  const input = new InputManager(
    canvas,
    () => (scene.kind === 'playing' ? scene.camera : createCamera()),
    terrainMaster,
  );

  canvas.addEventListener('click', (event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const point = { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };

    if (scene.kind === 'title') {
      scene = { kind: 'stageSelect' };
      return;
    }

    if (scene.kind === 'stageSelect') {
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        if (stage && pointInRect(point.x, point.y, stageSelectBoxRect(i))) {
          scene = startPlaying(stage.data, i);
          return;
        }
      }
      return;
    }

    if (scene.kind === 'clear') {
      if (hasNextStage(scene.stageIndex) && pointInRect(point.x, point.y, clearNextButtonRect())) {
        const next = stages[scene.stageIndex + 1];
        if (next) {
          scene = startPlaying(next.data, scene.stageIndex + 1);
        }
        return;
      }
      if (pointInRect(point.x, point.y, clearTitleButtonRect())) {
        scene = { kind: 'title' };
      }
      return;
    }

    // scene.kind === 'playing' のときは InputManager の mousedown が地形生成/消去を処理する
  });

  const loop = createLoop({
    update: (dt) => {
      animTime += dt;
      const commands = input.drain();

      if (scene.kind === 'playing') {
        const nextGame = updateGame(scene.game, commands, dt);
        const stageWidthPx = nextGame.grid.width * TILE_SIZE;
        const targetWorldX = (nextGame.jumpman.position.x + JUMPMAN_WIDTH / 2) * TILE_SIZE;
        const nextCamera = updateCamera(scene.camera, targetWorldX, stageWidthPx, LOGICAL_WIDTH, dt);

        if (nextGame.status === GameStatus.Cleared) {
          scene = { kind: 'clear', stageIndex: scene.stageIndex, game: nextGame, camera: nextCamera };
        } else {
          scene = { kind: 'playing', stageIndex: scene.stageIndex, game: nextGame, camera: nextCamera };
        }
      }
    },
    render: () => {
      if (scene.kind === 'title') {
        drawTitleScreen(ctx, Math.floor(animTime * 2) % 2 === 0);
        return;
      }
      if (scene.kind === 'stageSelect') {
        const metas: StageMeta[] = stages.map((s) => ({ id: s.id, name: s.data.name, theme: s.data.theme }));
        drawStageSelectScreen(ctx, metas);
        return;
      }
      if (scene.kind === 'playing') {
        renderGame(ctx, assets, scene.game, scene.camera, animTime, input.getHoverTile());
        return;
      }
      // 'clear'
      renderGame(ctx, assets, scene.game, scene.camera, animTime, null);
      drawClearButtons(ctx, hasNextStage(scene.stageIndex));
    },
  });

  loop.start();
}

// このモジュールは DRAFT_STAGE_STORAGE_KEY / TERRAIN_MASTER_STORAGE_KEY を
// マップ/地形マスタエディタからも import される。#game-canvas が存在するページ
// (= index.html)でのみ自動起動し、他ページへの副作用(bootstrapの誤実行)を防ぐ。
if (typeof document !== 'undefined' && document.getElementById('game-canvas')) {
  void main();
}
