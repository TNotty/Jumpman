import { describe, expect, it } from 'vitest';
import { TileGrid } from '../core/grid';
import { BlockType, EnemyType } from '../core/types';
import {
  coinRenderState,
  computeCoinCountUp,
  computeHeartStates,
  computeTileEdgeFlags,
  selectEnemySprite,
  selectJumpmanSprite,
} from './renderer';

describe('computeTileEdgeFlags(オートタイリングの隣接判定)', () => {
  function buildGrid(rows: string[]): TileGrid {
    // 'N'=Normal(固体), 'B'=Breakable(固体), '.'=Empty(非固体)
    const grid = new TileGrid(rows[0]?.length ?? 0, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const char = row[x];
        if (char === 'N') grid.set(x, y, BlockType.Normal);
        else if (char === 'B') grid.set(x, y, BlockType.Breakable);
      }
    });
    return grid;
  }

  it('四方すべて固体に囲まれている場合、全エッジがfalse(閉じている)', () => {
    const grid = buildGrid(['NNN', 'NNN', 'NNN']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: false,
      bottomOpen: false,
      leftOpen: false,
      rightOpen: false,
    });
  });

  it('上だけ空いている(床の表面)場合、topOpenのみtrue', () => {
    const grid = buildGrid(['...', 'NNN', 'NNN']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: true,
      bottomOpen: false,
      leftOpen: false,
      rightOpen: false,
    });
  });

  it('上+左が空いている(左上の角)場合、topOpenとleftOpenがtrue', () => {
    const grid = buildGrid(['...', '.NN', '.NN']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: true,
      bottomOpen: false,
      leftOpen: true,
      rightOpen: false,
    });
  });

  it('上+右が空いている(右上の角)場合、topOpenとrightOpenがtrue', () => {
    const grid = buildGrid(['...', 'NN.', 'NN.']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: true,
      bottomOpen: false,
      leftOpen: false,
      rightOpen: true,
    });
  });

  it('下だけ空いている(浮遊ブロックの底面)場合、bottomOpenのみtrue', () => {
    const grid = buildGrid(['NNN', 'NNN', '...']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: false,
      bottomOpen: true,
      leftOpen: false,
      rightOpen: false,
    });
  });

  it('グリッド範囲外は非固体(Empty)扱いなので、マップ端は開いている扱いになる', () => {
    const grid = buildGrid(['NNN', 'NNN', 'NNN']);
    // x=0はマップの左端。左隣(x=-1)は範囲外=Empty扱いでleftOpen=trueになる
    expect(computeTileEdgeFlags(grid, 0, 1).leftOpen).toBe(true);
  });

  it('隣接セルが通常ブロック以外の固体(壊れるブロック等)でも「閉じている」扱いになる', () => {
    const grid = buildGrid(['BBB', 'BNB', 'BBB']);
    expect(computeTileEdgeFlags(grid, 1, 1)).toEqual({
      topOpen: false,
      bottomOpen: false,
      leftOpen: false,
      rightOpen: false,
    });
  });
});

describe('coinRenderState', () => {
  it('permanentlyCollected(再訪時点で既に取得済み)は半透明(dim)になる', () => {
    expect(coinRenderState({ permanentlyCollected: true, collectedThisSession: false })).toBe('dim');
  });

  it('collectedThisSession(今回のセッションで新規取得)は非描画(hidden、即座に消える)になる', () => {
    expect(coinRenderState({ permanentlyCollected: false, collectedThisSession: true })).toBe('hidden');
  });

  it('未取得は通常表示(normal)になる', () => {
    expect(coinRenderState({ permanentlyCollected: false, collectedThisSession: false })).toBe('normal');
  });

  it('permanentlyCollectedが優先される(理論上両方trueになることは無いが、念のため)', () => {
    expect(coinRenderState({ permanentlyCollected: true, collectedThisSession: true })).toBe('dim');
  });
});

describe('selectJumpmanSprite(状態→スプライト名+フレームindex+左右反転)', () => {
  const base = { grounded: true, velocityY: 0, facing: 1 as const, invincible: false, showDeathPose: false, animTime: 0 };

  it('showDeathPose=trueなら他の状態に関わらずjumpman_dead(frame0)になる', () => {
    const result = selectJumpmanSprite({ ...base, grounded: false, invincible: true, showDeathPose: true });
    expect(result.spriteName).toBe('jumpman_dead');
    expect(result.frameIndex).toBe(0);
  });

  it('invincible=true(showDeathPose=false)ならjumpman_hit(frame0、のけぞりポーズ)になる', () => {
    const result = selectJumpmanSprite({ ...base, invincible: true });
    expect(result.spriteName).toBe('jumpman_hit');
    expect(result.frameIndex).toBe(0);
  });

  it('空中(grounded=false)でvelocityY<0(上昇)ならjumpman_jumpのframe0(上昇ポーズ)になる', () => {
    const result = selectJumpmanSprite({ ...base, grounded: false, velocityY: -10 });
    expect(result.spriteName).toBe('jumpman_jump');
    expect(result.frameIndex).toBe(0);
  });

  it('空中(grounded=false)でvelocityY>=0(落下)ならjumpman_jumpのframe1(落下ポーズ)になる', () => {
    const result = selectJumpmanSprite({ ...base, grounded: false, velocityY: 5 });
    expect(result.spriteName).toBe('jumpman_jump');
    expect(result.frameIndex).toBe(1);

    const zeroVy = selectJumpmanSprite({ ...base, grounded: false, velocityY: 0 });
    expect(zeroVy.frameIndex).toBe(1); // vy=0は「落下」側(上昇ではない)として扱う
  });

  it('接地中はjumpman_runになり、frameIndexはanimTimeに応じて0〜7を周回する', () => {
    expect(selectJumpmanSprite({ ...base, animTime: 0 }).spriteName).toBe('jumpman_run');
    expect(selectJumpmanSprite({ ...base, animTime: 0 }).frameIndex).toBe(0);
    const frames = new Set<number>();
    for (let t = 0; t < 1; t += 1 / 60) {
      const { frameIndex } = selectJumpmanSprite({ ...base, animTime: t });
      expect(frameIndex).toBeGreaterThanOrEqual(0);
      expect(frameIndex).toBeLessThan(8);
      frames.add(frameIndex);
    }
    expect(frames.size).toBe(8); // 1秒の間に8フレーム全てが少なくとも1回は出現する
  });

  it('facing=-1ならflipX=true、facing=1ならflipX=false(進行方向を向く)', () => {
    expect(selectJumpmanSprite({ ...base, facing: -1 }).flipX).toBe(true);
    expect(selectJumpmanSprite({ ...base, facing: 1 }).flipX).toBe(false);
  });

  it('優先順位: 死亡ポーズ > 被弾のけぞり > 空中(上昇/落下) > 走行', () => {
    // 被弾中(invincible)かつ空中(grounded=false)でも、被弾ポーズが優先される
    const midAirHit = selectJumpmanSprite({ ...base, grounded: false, velocityY: -10, invincible: true });
    expect(midAirHit.spriteName).toBe('jumpman_hit');
  });
});

describe('selectEnemySprite(状態→スプライト名+フレームindex)', () => {
  it('カエル: 接地中は常にframe0(しゃがみ溜め)になる(velocityYに関わらず)', () => {
    const grounded = selectEnemySprite({ type: EnemyType.Frog, grounded: true, velocityY: -5, animTime: 1.23 });
    expect(grounded.spriteName).toBe('frog');
    expect(grounded.frameIndex).toBe(0);
  });

  it('カエル: 空中でvelocityY<0(上昇)ならframe1(伸び上がり)になる', () => {
    const rising = selectEnemySprite({ type: EnemyType.Frog, grounded: false, velocityY: -5, animTime: 0 });
    expect(rising.frameIndex).toBe(1);
  });

  it('カエル: 空中でvelocityY>=0(下降)ならframe2(通常)になる', () => {
    const falling = selectEnemySprite({ type: EnemyType.Frog, grounded: false, velocityY: 5, animTime: 0 });
    expect(falling.frameIndex).toBe(2);
  });

  it('鳥: spriteName="bird"で、frameIndexは0〜3を時間ベースで周回する', () => {
    const result = selectEnemySprite({ type: EnemyType.Bird, grounded: false, velocityY: 0, animTime: 0 });
    expect(result.spriteName).toBe('bird');
    const frames = new Set<number>();
    for (let t = 0; t < 1; t += 1 / 60) {
      const { frameIndex } = selectEnemySprite({ type: EnemyType.Bird, grounded: false, velocityY: 0, animTime: t });
      expect(frameIndex).toBeGreaterThanOrEqual(0);
      expect(frameIndex).toBeLessThan(4);
      frames.add(frameIndex);
    }
    expect(frames.size).toBe(4);
  });

  it('スライム: spriteName="slime"で、frameIndexは0〜3を時間ベースで周回する', () => {
    const result = selectEnemySprite({ type: EnemyType.Slime, grounded: true, velocityY: 0, animTime: 0 });
    expect(result.spriteName).toBe('slime');
    const frames = new Set<number>();
    for (let t = 0; t < 1; t += 1 / 60) {
      const { frameIndex } = selectEnemySprite({ type: EnemyType.Slime, grounded: true, velocityY: 0, animTime: t });
      frames.add(frameIndex);
    }
    expect(frames.size).toBe(4);
  });
});

describe('computeHeartStates(HP→ハート型の満/空 一覧)', () => {
  it('hp=3, maxHp=5なら[full,full,full,empty,empty]になる', () => {
    expect(computeHeartStates(3, 5)).toEqual(['full', 'full', 'full', 'empty', 'empty']);
  });

  it('hp=0なら全てempty', () => {
    expect(computeHeartStates(0, 5)).toEqual(['empty', 'empty', 'empty', 'empty', 'empty']);
  });

  it('hp=maxHpなら全てfull', () => {
    expect(computeHeartStates(5, 5)).toEqual(['full', 'full', 'full', 'full', 'full']);
  });

  it('要素数は常にmaxHp(強化でmaxHpが5〜15まで変わる場合に対応)', () => {
    expect(computeHeartStates(10, 12)).toHaveLength(12);
  });

  it('maxHp=0なら空配列', () => {
    expect(computeHeartStates(0, 0)).toEqual([]);
  });
});

describe('computeCoinCountUp(クリア画面のコイン数カウントアップ)', () => {
  it('経過0秒では0を返す', () => {
    expect(computeCoinCountUp(5, 0, 0.8)).toBe(0);
  });

  it('経過時間がduration以上ならtargetCountをそのまま返す', () => {
    expect(computeCoinCountUp(5, 0.8, 0.8)).toBe(5);
    expect(computeCoinCountUp(5, 10, 0.8)).toBe(5);
  });

  it('経過時間の割合に応じて線形に増える(四捨五入)', () => {
    expect(computeCoinCountUp(4, 0.4, 0.8)).toBe(2); // 半分経過→半分
    expect(computeCoinCountUp(5, 0.4, 0.8)).toBe(3); // 5*0.5=2.5→四捨五入で3
  });

  it('duration=0なら即座にtargetCountを返す(0除算を避ける)', () => {
    expect(computeCoinCountUp(5, 0, 0)).toBe(5);
  });

  it('targetCount=0なら常に0', () => {
    expect(computeCoinCountUp(0, 0.4, 0.8)).toBe(0);
    expect(computeCoinCountUp(0, 1, 0.8)).toBe(0);
  });
});
