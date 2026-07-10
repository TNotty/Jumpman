// パーティクル+画面演出(EffectsManager)。render層専用、GameStateのdiffを観測してイベントを
// 検出し、パーティクル/画面振動/ビネット/ズーム/紙吹雪を駆動する。
//
// アーキテクチャ上の鉄則:
// - core(src/core/**)は一切変更しない。decideEffectEvents はGameStateを読み取るだけの純関数
//   (prev/nextの2つのGameStateスナップショット+そのフレームに渡したcommandsから、
//   「何が起きたか」を導出する)。core側の決定論・既存テストには一切影響しない。
// - 乱数(Math.random)はこのファイル(render層)でのみ使う。パーティクルの生成位置ジッター・
//   速度ばらつき等の「見た目のランダム性」に限定し、ゲームロジックの判定には一切使わない。
// - パーティクルは固定長プール(既定512)のリングバッファ。満杯時は最も古いスロットを
//   上書きする(GC負荷ゼロ・メモリ上限が保証される軽量実装)。
import type { Command } from '../core/commands';
import { ENEMY_HEIGHT, ENEMY_WIDTH, JUMPMAN_HEIGHT, JUMPMAN_WIDTH, TILE_SIZE } from '../core/constants';
import type { GameState } from '../core/game';
import { breakableStage } from '../core/blocks';
import { expandTerrainCells } from '../core/placement';
import { GameStatus } from '../core/types';
import type { CameraState } from './camera';

// --- イベント検出(純関数。GameStateのdiffのみで判定し、Math.randomは使わない) --------------

export type EffectEvent =
  | { kind: 'landed'; x: number; y: number }
  | { kind: 'jumpTakeoff'; x: number; y: number }
  | { kind: 'coinCollected'; x: number; y: number }
  | { kind: 'blockChipped'; x: number; y: number }
  | { kind: 'blockBroken'; x: number; y: number }
  | { kind: 'blockFalling'; x: number; y: number }
  | { kind: 'damage'; x: number; y: number }
  | { kind: 'death'; x: number; y: number }
  | { kind: 'respawn'; x: number; y: number }
  | { kind: 'placementSuccess'; cells: readonly { x: number; y: number }[] }
  | { kind: 'goalReached'; x: number; y: number }
  | { kind: 'enemyDamage'; enemyId: number; x: number; y: number };

const JUMPMAN_CENTER_X = JUMPMAN_WIDTH / 2;
const ENEMY_CENTER_X = ENEMY_WIDTH / 2;
const ENEMY_CENTER_Y = ENEMY_HEIGHT / 2;

/**
 * 2つの連続したGameStateスナップショット(1フレーム前後)とそのフレームに渡したcommandsから、
 * 「そのフレームに何が起きたか」を導出する。core層のGameStateを読み取るだけで、書き換えない。
 *
 * HPの増加(respawnによる全快)を「死亡→復帰」の合図として使っている点に注意:
 * このゲームにHP回復手段は死亡復帰以外に存在しない(core/jumpman.tsのapplyDamage/respawn参照)
 * ため、hpの増加は常にrespawnAtCheckpoint経由の全快を意味する。ただし「被弾せずフルHPのまま
 * 落下死した」場合はhpが5→5のまま変化しないため、hp増加だけでは検出できない。そのため
 * 「1フレームでの位置移動量が通常の物理演算では起こり得ないほど大きい(=テレポート)」ことも
 * 合わせて判定する(通常の自動走行/ノックバック/ジャンプの最大移動量は1フレームあたり
 * 1タイル未満に収まるため、しきい値1.5タイルは十分な安全マージンを持つ)。
 * 死亡位置は「復帰前(prev)の位置」、復帰先は「復帰後(next)の位置」としてそのまま
 * 両方のイベントに使える(=core側にイベントログを追加しなくても、diffだけで安全に判定できる)。
 */
export function detectEffectEvents(prev: GameState, next: GameState, commands: readonly Command[]): EffectEvent[] {
  const events: EffectEvent[] = [];

  const prevJ = prev.jumpman;
  const nextJ = next.jumpman;
  const prevFootX = prevJ.position.x + JUMPMAN_CENTER_X;
  const prevFootY = prevJ.position.y + JUMPMAN_HEIGHT;
  const nextFootX = nextJ.position.x + JUMPMAN_CENTER_X;
  const nextFootY = nextJ.position.y + JUMPMAN_HEIGHT;

  // 着地/ジャンプ踏切: grounded の立ち上がり/立ち下がりエッジ
  if (!prevJ.grounded && nextJ.grounded) {
    events.push({ kind: 'landed', x: nextFootX, y: nextFootY });
  } else if (prevJ.grounded && !nextJ.grounded && nextJ.velocity.y < 0) {
    events.push({ kind: 'jumpTakeoff', x: prevFootX, y: prevFootY });
  }

  const teleportDistance = Math.hypot(nextJ.position.x - prevJ.position.x, nextJ.position.y - prevJ.position.y);
  const respawned = nextJ.hp > prevJ.hp || teleportDistance > 1.5;

  // 死亡→リスポーン: HPが増加した、またはテレポート判定(=このゲームで回復手段はrespawnのみ)
  if (respawned) {
    events.push({ kind: 'death', x: prevFootX, y: prevFootY - JUMPMAN_HEIGHT / 2 });
    events.push({ kind: 'respawn', x: nextFootX, y: nextFootY });
  } else if (nextJ.hp < prevJ.hp) {
    // 被弾(死亡復帰と同一フレームでは起こらない: applyContactDamageとapplyDeathAndRespawnは
    // 同じupdate()内で順に呼ばれるが、HPが0になった直後にrespawnで全快するため
    // 「減った」判定はhp>0で被弾しただけのフレームにのみ成立する)
    events.push({ kind: 'damage', x: prevFootX, y: prevFootY - JUMPMAN_HEIGHT / 2 });
  }

  // コイン取得: takenThisSessionの増分
  if (next.takenThisSession.length > prev.takenThisSession.length) {
    const newIndices = next.takenThisSession.slice(prev.takenThisSession.length);
    for (const index of newIndices) {
      const coin = next.coins[index];
      if (coin) events.push({ kind: 'coinCollected', x: coin.x + 0.5, y: coin.y + 0.5 });
    }
  }

  // 壊れるブロック: breakableDamageマップの段階変化/消滅(元のセルが両方のマップに現れうる
  // key集合を見て、段階が上がっていれば「欠け」、mapから消えていれば「破壊」とみなす)
  const breakKeys = new Set<string>([...prev.breakableDamage.keys(), ...next.breakableDamage.keys()]);
  for (const key of breakKeys) {
    const parts = key.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const prevStage = breakableStage(prev.breakableDamage.get(key) ?? 0);
    const nextRaw = next.breakableDamage.get(key);
    if (nextRaw === undefined) {
      if (prev.breakableDamage.has(key)) {
        events.push({ kind: 'blockBroken', x: x + 0.5, y: y + 0.5 });
      }
      continue;
    }
    const nextStage = breakableStage(nextRaw);
    if (nextStage > prevStage) {
      events.push({ kind: 'blockChipped', x: x + 0.5, y: y + 0.5 });
    }
  }

  // 落ちるブロック: shaking→falling の遷移(=グリッドから消えて実体化した瞬間)を粉塵として扱う
  const prevFallingById = new Map(prev.fallingBlocks.map((b) => [b.id, b] as const));
  for (const block of next.fallingBlocks) {
    const prevBlock = prevFallingById.get(block.id);
    if (prevBlock && prevBlock.phase === 'shaking' && block.phase === 'falling') {
      events.push({ kind: 'blockFalling', x: block.x + 0.5, y: block.y + 0.5 });
    }
  }

  // 地形生成成功: このフレームのplaceTerrainコマンドのうち、実際に新しく固体になったセルがある
  // ものだけを対象にする(消去スロット中はterrainId解決自体が失敗するか、そもそも新規に固体化
  // するセルが存在しないため、selectedSlotを個別に見なくても自然に除外される)。
  for (const command of commands) {
    if (command.type !== 'placeTerrain') continue;
    const terrain = prev.terrainMaster.find((t) => t?.id === command.terrainId);
    if (!terrain) continue;
    const cells = expandTerrainCells(terrain, command.x, command.y);
    const placedCells = cells.filter(
      (cell) => next.grid.inBounds(cell.x, cell.y) && next.grid.isSolid(cell.x, cell.y) && !prev.grid.isSolid(cell.x, cell.y),
    );
    if (placedCells.length > 0) {
      events.push({ kind: 'placementSuccess', cells: placedCells.map((c) => ({ x: c.x, y: c.y })) });
    }
  }

  // 敵の被弾: idで対応付けてhpの減少を見る(トゲ接触ダメージ。core/enemies.tsのapplySpikeDamage参照)。
  // 敵は死亡復帰時にresetEnemy()でhpが全快するが、それはjumpmanと違うフレーム(死亡復帰は
  // jumpman側のrespawnと同時)に起きるだけで「減少」ではないため、素直にhp減少だけを見ればよい。
  const prevEnemyById = new Map(prev.enemies.map((e) => [e.id, e] as const));
  for (const enemy of next.enemies) {
    const prevEnemy = prevEnemyById.get(enemy.id);
    if (prevEnemy && enemy.hp < prevEnemy.hp) {
      events.push({ kind: 'enemyDamage', enemyId: enemy.id, x: enemy.x + ENEMY_CENTER_X, y: enemy.y + ENEMY_CENTER_Y });
    }
  }

  // ゴール到達
  if (prev.status !== GameStatus.Cleared && next.status === GameStatus.Cleared) {
    events.push({ kind: 'goalReached', x: nextFootX, y: nextFootY });
  }

  return events;
}

// --- パーティクルプール(固定長リングバッファ、ミュータブル・GCフリー) --------------------

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  /** 'rect'=fillRect中心、'circle'=arc。軽量描画のための最低限の切り替え */
  shape: 'rect' | 'circle';
}

export interface ParticlePool {
  readonly particles: Particle[];
  readonly capacity: number;
  cursor: number;
}

export const DEFAULT_PARTICLE_POOL_CAPACITY = 512;

export function createParticlePool(capacity: number = DEFAULT_PARTICLE_POOL_CAPACITY): ParticlePool {
  const particles: Particle[] = [];
  for (let i = 0; i < capacity; i++) {
    particles.push({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
      size: 0,
      color: '#ffffff',
      gravity: 0,
      shape: 'rect',
    });
  }
  return { particles, capacity, cursor: 0 };
}

export interface ParticleSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
  gravity?: number;
  shape?: 'rect' | 'circle';
}

/**
 * プールから次のスロットへ新しいパーティクルを書き込む(リングバッファ、O(1)、常に成功する)。
 * 満杯時は最も古い(=次にcursorが指す)パーティクルを上書きする。これにより発生数がどれだけ
 * 多くても確保済みメモリを超えない(スマホ配慮の軽量実装)。
 */
export function spawnParticle(pool: ParticlePool, spec: ParticleSpec): void {
  const slot = pool.particles[pool.cursor];
  if (slot) {
    slot.active = true;
    slot.x = spec.x;
    slot.y = spec.y;
    slot.vx = spec.vx;
    slot.vy = spec.vy;
    slot.life = spec.life;
    slot.maxLife = spec.life;
    slot.size = spec.size;
    slot.color = spec.color;
    slot.gravity = spec.gravity ?? 0;
    slot.shape = spec.shape ?? 'rect';
  }
  pool.cursor = (pool.cursor + 1) % pool.capacity;
}

/** 全アクティブパーティクルの寿命・位置を1フレーム分進める(寿命切れはactive=falseにする) */
export function updateParticlePool(pool: ParticlePool, dt: number): void {
  for (const p of pool.particles) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      continue;
    }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

export function countActiveParticles(pool: ParticlePool): number {
  let count = 0;
  for (const p of pool.particles) {
    if (p.active) count += 1;
  }
  return count;
}

export function clearParticlePool(pool: ParticlePool): void {
  for (const p of pool.particles) p.active = false;
  pool.cursor = 0;
}

// --- イベント→生成数(定数テーブル。スマホ配慮で控えめ、ここだけ調整すればよい) -----------

export const EVENT_PARTICLE_COUNTS: Record<EffectEvent['kind'], number> = {
  landed: 4,
  jumpTakeoff: 3,
  coinCollected: 8,
  blockChipped: 3,
  blockBroken: 10,
  blockFalling: 6,
  damage: 10,
  death: 24,
  respawn: 14,
  placementSuccess: 0, // パーティクルではなくセルごとのポップアニメで表現する(下記参照)
  goalReached: 20, // ゴール到達時の初期バースト(以降はconfettiモードで継続生成)
  enemyDamage: 0, // パーティクルではなく敵スプライトの白点滅(getEnemyFlashAlpha)で表現する
};

/** 紙吹雪(継続生成)を1フレームあたり何個生成するか */
const CONFETTI_PER_SECOND = 6;

// --- 画面演出タイマー ---------------------------------------------------------------------

interface Timer {
  elapsed: number;
  duration: number;
}

function tickTimer(timer: Timer, dt: number): Timer {
  return { elapsed: Math.min(timer.duration, timer.elapsed + dt), duration: timer.duration };
}

function timerProgress(timer: Timer): number {
  if (timer.duration <= 0) return 1;
  return Math.min(1, timer.elapsed / timer.duration);
}

function timerActive(timer: Timer): boolean {
  return timer.elapsed < timer.duration;
}

const SHAKE_DURATION = 0.2;
const SHAKE_MAGNITUDE = 4; // px
const VIGNETTE_DURATION = 0.35;
const ZOOM_DURATION = 0.4;
const ZOOM_MAX_SCALE = 1.12;
const PLACEMENT_POP_DURATION = 0.18;
/** ジャンプマンのsquash&stretch。0.1秒程度でイージング(描画変形のみ、当たり判定には影響しない) */
const SQUASH_STRETCH_DURATION = 0.1;
const SQUASH_TARGET_SCALE_Y = 0.72; // 着地: 縦潰れ
const STRETCH_TARGET_SCALE_Y = 1.28; // ジャンプ踏切: 縦伸び
/** 死亡→リスポーンの短時間、ジャンプマンの「やられポーズ」(jumpman_dead)を表示する時間(秒) */
const DEATH_POSE_DURATION = 0.35;
/** 敵の被弾点滅(トゲ等でダメージを受けた際、短く白く点滅する)の表示時間(秒) */
const ENEMY_FLASH_DURATION = 0.15;
/** マナバーの「影バー」が実際の値に追いつく速度(1秒あたりの比率変化量) */
const MANA_SHADOW_CATCHUP_RATE = 0.6;

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** 0→1へ、少しだけ1を超えてから収まる「バウンス」イージング(地形生成セルのポップ用) */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = t - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/**
 * マナバーの「消費時に遅れて追いつく影バー」の次フレーム値を計算する純関数。
 * target(実際の比率)がcurrent(影バーの比率)より小さい(=消費してマナが減った)場合は
 * catchUpRate(1秒あたりの比率変化量)でゆっくり追いつき、target以上(=回復・マナ獲得等)
 * の場合は即座に追従する(影は「最近失った分」を示す演出であり、増加を遅らせる意味は無いため)。
 * currentがtargetを追い越さないよう、常にtargetでクランプする。
 */
export function advanceManaShadow(current: number, target: number, dt: number, catchUpRate: number): number {
  if (target < current) {
    return Math.max(target, current - catchUpRate * dt);
  }
  return target;
}

// --- EffectsManager(唯一のステートフルなrender層オブジェクト) ------------------------------

export interface EffectsManagerView {
  getShakeOffset(): { x: number; y: number };
  getVignetteAlpha(): number;
  getZoomScale(): number;
  getPlacementPopScale(x: number, y: number): number;
  /** ジャンプマンのsquash&stretch倍率(scaleX/scaleY)。着地/ジャンプ踏切イベントで発火し、
   * 0.1秒程度で1(等倍)へ戻る。描画変形のみに使う想定(当たり判定はcore側のJUMPMAN_WIDTH/
   * HEIGHTのまま変わらない)。 */
  getSquashStretch(): { scaleX: number; scaleY: number };
  /** 死亡→リスポーンの短時間trueになる(この間、renderer側は通常のrun/jumpの代わりに
   * jumpman_dead(やられポーズ)を表示する)。 */
  isDeathPoseActive(): boolean;
  /** 指定した敵(id)の被弾点滅の不透明度(0=通常、1=最大)。トゲ等で被弾した直後に短く発火する。 */
  getEnemyFlashAlpha(enemyId: number): number;
  /** マナバーの「影バー」の現在の比率(0〜1)。消費直後は実際の比率よりゆっくり追いつく。 */
  getManaShadowRatio(): number;
  renderParticles(ctx: CanvasRenderingContext2D, camera: CameraState): void;
}

export interface EffectsManager extends EffectsManagerView {
  /** GameStateのdiffからイベントを検出し、パーティクル生成/画面演出の起動を行う */
  handleFrame(prev: GameState, next: GameState, commands: readonly Command[]): void;
  /** パーティクル・タイマーを1フレーム分進める(dt駆動、GameStateのupdateとは独立)。
   * manaRatio(0〜1)を渡すと影バーの目標値を更新する(省略時は影バーを進めない=非プレイ中)。 */
  update(dt: number, manaRatio?: number): void;
  /** ステージ再開時(startPlaying)に呼び、前のプレイの余韻(紙吹雪・振動等)を一掃する */
  reset(): void;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 汎用のバースト生成(中心から放射状に飛び散る)。見た目のランダム性はここでのみ使う。 */
function spawnBurst(
  pool: ParticlePool,
  x: number,
  y: number,
  count: number,
  opts: { speed: [number, number]; life: [number, number]; size: [number, number]; color: string; gravity: number; shape?: 'rect' | 'circle' },
): void {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = randRange(opts.speed[0], opts.speed[1]);
    spawnParticle(pool, {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - speed * 0.3, // 少し上向きに偏らせる(飛び散り感)
      life: randRange(opts.life[0], opts.life[1]),
      size: randRange(opts.size[0], opts.size[1]),
      color: opts.color,
      gravity: opts.gravity,
      shape: opts.shape ?? 'rect',
    });
  }
}

export function createEffectsManager(capacity: number = DEFAULT_PARTICLE_POOL_CAPACITY): EffectsManager {
  const pool = createParticlePool(capacity);
  let shakeTimer: Timer = { elapsed: SHAKE_DURATION, duration: SHAKE_DURATION };
  let vignetteTimer: Timer = { elapsed: VIGNETTE_DURATION, duration: VIGNETTE_DURATION };
  let zoomTimer: Timer = { elapsed: ZOOM_DURATION, duration: ZOOM_DURATION };
  let confettiActive = false;
  let confettiCarry = 0;
  let confettiCenterX = 0;
  let confettiOriginY = 0;
  // ズームは「発火するまでは常にscale=1」が既定値であるべきだが、タイマーのelapsed/durationだけ
  // では(shake/vignetteと同じ「経過済み」初期値の都合上)progress=1になってしまい、未発火なのに
  // 最大スケールを返してしまう。そのため発火済みかどうかを別フラグで明示的に持つ。
  let zoomTriggered = false;
  const placementPops = new Map<string, number>(); // "x,y" -> 経過時間

  // squash&stretch: zoomと同じ理由でtriggered済みフラグを別に持つ
  let squashStretchTimer: Timer = { elapsed: SQUASH_STRETCH_DURATION, duration: SQUASH_STRETCH_DURATION };
  let squashStretchTriggered = false;
  let squashStretchTargetY = 1;

  function triggerSquashStretch(targetScaleY: number): void {
    squashStretchTimer = { elapsed: 0, duration: SQUASH_STRETCH_DURATION };
    squashStretchTriggered = true;
    squashStretchTargetY = targetScaleY;
  }

  // マナバーの影バー(遅れて追いつく)。既定1(満タン)から始まり、update()にmanaRatioが
  // 渡されるたびにadvanceManaShadowで追従させる。
  let manaShadowRatio = 1;

  // 死亡→リスポーンの「やられポーズ」表示ウィンドウ(タイマーは経過済み初期値=非表示スタート)
  let deathPoseTimer: Timer = { elapsed: DEATH_POSE_DURATION, duration: DEATH_POSE_DURATION };
  function triggerDeathPose(): void {
    deathPoseTimer = { elapsed: 0, duration: DEATH_POSE_DURATION };
  }

  // 敵の被弾点滅: 敵id -> 経過時間(placementPopsと同じMapベースの管理方式)
  const enemyFlashes = new Map<number, number>();

  function triggerShake(): void {
    shakeTimer = { elapsed: 0, duration: SHAKE_DURATION };
  }
  function triggerVignette(): void {
    vignetteTimer = { elapsed: 0, duration: VIGNETTE_DURATION };
  }
  function triggerZoom(): void {
    zoomTimer = { elapsed: 0, duration: ZOOM_DURATION };
    zoomTriggered = true;
  }

  interface FloatText {
    x: number;
    y: number;
    life: number;
    maxLife: number;
    text: string;
  }
  const floatTexts: FloatText[] = [];

  function handleEvent(event: EffectEvent): void {
    switch (event.kind) {
      case 'landed':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.landed, {
          speed: [0.3, 1.2],
          life: [0.15, 0.3],
          size: [2, 4],
          color: '#c2a878',
          gravity: 6,
        });
        triggerSquashStretch(SQUASH_TARGET_SCALE_Y);
        break;
      case 'jumpTakeoff':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.jumpTakeoff, {
          speed: [0.2, 0.8],
          life: [0.12, 0.22],
          size: [2, 3],
          color: '#c2a878',
          gravity: 4,
        });
        triggerSquashStretch(STRETCH_TARGET_SCALE_Y);
        break;
      case 'coinCollected':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.coinCollected, {
          speed: [0.8, 2.2],
          life: [0.25, 0.45],
          size: [2, 4],
          color: '#f1c40f',
          gravity: 2,
          shape: 'circle',
        });
        // 「+1」フロートテキストもパーティクルプールへ載せる(shape='rect'は使わず、
        // レンダラ側でsize>=100を「テキスト」とみなす特別扱いはしない。テキストは
        // 別リストで持つ方が責務が明確なため、EffectsManagerのfloatTexts配列を使う)。
        floatTexts.push({ x: event.x, y: event.y, life: 0.8, maxLife: 0.8, text: '+1' });
        break;
      case 'blockChipped':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.blockChipped, {
          speed: [0.5, 1.5],
          life: [0.15, 0.3],
          size: [2, 3],
          color: '#a56b3a',
          gravity: 8,
        });
        break;
      case 'blockBroken':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.blockBroken, {
          speed: [1, 3],
          life: [0.25, 0.5],
          size: [2, 5],
          color: '#a56b3a',
          gravity: 10,
        });
        break;
      case 'blockFalling':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.blockFalling, {
          speed: [0.3, 1.0],
          life: [0.2, 0.4],
          size: [2, 4],
          color: '#8a8a8a',
          gravity: 3,
        });
        break;
      case 'damage':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.damage, {
          speed: [1.5, 3.5],
          life: [0.15, 0.3],
          size: [2, 3],
          color: '#ff5533',
          gravity: 1,
        });
        triggerShake();
        triggerVignette();
        break;
      case 'death':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.death, {
          speed: [1.5, 4.5],
          life: [0.3, 0.6],
          size: [2, 5],
          color: '#ff3b3b',
          gravity: 2,
        });
        triggerShake();
        triggerDeathPose();
        break;
      case 'respawn':
        // 光柱: 足元から真上に立ち上る光の粒子(放射状ではなく縦方向に偏らせる)
        for (let i = 0; i < EVENT_PARTICLE_COUNTS.respawn; i++) {
          spawnParticle(pool, {
            x: event.x + randRange(-0.15, 0.15),
            y: event.y,
            vx: randRange(-0.1, 0.1),
            vy: randRange(-3.5, -1.5),
            life: randRange(0.3, 0.6),
            size: randRange(2, 4),
            color: '#fff6c0',
            gravity: 0,
            shape: 'circle',
          });
        }
        break;
      case 'placementSuccess':
        for (const cell of event.cells) {
          placementPops.set(`${cell.x},${cell.y}`, 0);
        }
        break;
      case 'goalReached':
        spawnBurst(pool, event.x, event.y, EVENT_PARTICLE_COUNTS.goalReached, {
          speed: [1, 3],
          life: [0.4, 0.8],
          size: [3, 6],
          color: '#ffd23f',
          gravity: -1,
          shape: 'circle',
        });
        triggerZoom();
        confettiActive = true;
        // 紙吹雪はゴール地点(=クリア画面で表示され続ける位置)を中心に、その少し上から降らせる。
        // カメラは'clear'シーン中ほぼ静止しているため、ワールド座標に固定してよい。
        confettiCenterX = event.x;
        confettiOriginY = event.y - 12;
        break;
      case 'enemyDamage':
        enemyFlashes.set(event.enemyId, 0);
        break;
      default:
        break;
    }
  }

  function spawnConfetti(dt: number): void {
    if (!confettiActive) return;
    confettiCarry += CONFETTI_PER_SECOND * dt;
    const colors = ['#ffd23f', '#ff6b6b', '#4ecdc4', '#a78bfa', '#ffffff'];
    while (confettiCarry >= 1) {
      confettiCarry -= 1;
      // ゴール地点を中心にワールド座標でばらつかせる('clear'シーン中はカメラがほぼ静止しているため、
      // 画面相対ではなくワールド座標に固定してもカメラに追従しているように見える)。
      const x = confettiCenterX + randRange(-12, 12);
      spawnParticle(pool, {
        x,
        y: confettiOriginY,
        vx: randRange(-0.3, 0.3),
        vy: randRange(0.5, 1.2),
        life: randRange(1.5, 2.5),
        size: randRange(2, 4),
        color: colors[Math.floor(Math.random() * colors.length)] ?? '#ffffff',
        gravity: 0.3,
        shape: 'rect',
      });
    }
  }

  return {
    handleFrame(prev, next, commands) {
      const events = detectEffectEvents(prev, next, commands);
      for (const event of events) handleEvent(event);
    },
    update(dt, manaRatio) {
      updateParticlePool(pool, dt);
      shakeTimer = tickTimer(shakeTimer, dt);
      vignetteTimer = tickTimer(vignetteTimer, dt);
      zoomTimer = tickTimer(zoomTimer, dt);
      squashStretchTimer = tickTimer(squashStretchTimer, dt);
      deathPoseTimer = tickTimer(deathPoseTimer, dt);
      spawnConfetti(dt);

      if (manaRatio !== undefined) {
        manaShadowRatio = advanceManaShadow(manaShadowRatio, manaRatio, dt, MANA_SHADOW_CATCHUP_RATE);
      }

      for (let i = floatTexts.length - 1; i >= 0; i--) {
        const t = floatTexts[i];
        if (!t) continue;
        t.life -= dt;
        if (t.life <= 0) floatTexts.splice(i, 1);
      }

      if (placementPops.size > 0) {
        for (const [key, elapsed] of placementPops) {
          const next = elapsed + dt;
          if (next >= PLACEMENT_POP_DURATION) placementPops.delete(key);
          else placementPops.set(key, next);
        }
      }

      if (enemyFlashes.size > 0) {
        for (const [id, elapsed] of enemyFlashes) {
          const next = elapsed + dt;
          if (next >= ENEMY_FLASH_DURATION) enemyFlashes.delete(id);
          else enemyFlashes.set(id, next);
        }
      }
    },
    reset() {
      clearParticlePool(pool);
      shakeTimer = { elapsed: SHAKE_DURATION, duration: SHAKE_DURATION };
      vignetteTimer = { elapsed: VIGNETTE_DURATION, duration: VIGNETTE_DURATION };
      zoomTimer = { elapsed: ZOOM_DURATION, duration: ZOOM_DURATION };
      zoomTriggered = false;
      squashStretchTimer = { elapsed: SQUASH_STRETCH_DURATION, duration: SQUASH_STRETCH_DURATION };
      squashStretchTriggered = false;
      deathPoseTimer = { elapsed: DEATH_POSE_DURATION, duration: DEATH_POSE_DURATION };
      confettiActive = false;
      confettiCarry = 0;
      confettiCenterX = 0;
      confettiOriginY = 0;
      placementPops.clear();
      enemyFlashes.clear();
      floatTexts.length = 0;
      manaShadowRatio = 1;
    },
    getShakeOffset() {
      if (!timerActive(shakeTimer)) return { x: 0, y: 0 };
      const remaining = 1 - timerProgress(shakeTimer);
      const magnitude = SHAKE_MAGNITUDE * remaining;
      return { x: randRange(-magnitude, magnitude), y: randRange(-magnitude, magnitude) };
    },
    getVignetteAlpha() {
      if (!timerActive(vignetteTimer)) return 0;
      // フラッシュ: 発火した瞬間に最大不透明度になり、そこから線形にフェードアウトする。
      return 1 - timerProgress(vignetteTimer);
    },
    getZoomScale() {
      if (!zoomTriggered) return 1;
      const t = easeOutQuad(timerProgress(zoomTimer));
      return 1 + (ZOOM_MAX_SCALE - 1) * t;
    },
    getPlacementPopScale(x, y) {
      const elapsed = placementPops.get(`${x},${y}`);
      if (elapsed === undefined) return 1;
      return easeOutBack(Math.min(1, elapsed / PLACEMENT_POP_DURATION));
    },
    getSquashStretch() {
      if (!squashStretchTriggered || !timerActive(squashStretchTimer)) return { scaleX: 1, scaleY: 1 };
      const remaining = 1 - timerProgress(squashStretchTimer); // 1(発火直後)→0(等倍へ戻る)
      const scaleY = 1 + (squashStretchTargetY - 1) * remaining;
      // 体積感を保つ簡易近似(縦に伸びたら横は少し縮む、縦に潰れたら横は少し広がる)
      const scaleX = 1 + (1 - squashStretchTargetY) * remaining;
      return { scaleX, scaleY };
    },
    isDeathPoseActive() {
      return timerActive(deathPoseTimer);
    },
    getEnemyFlashAlpha(enemyId) {
      const elapsed = enemyFlashes.get(enemyId);
      if (elapsed === undefined) return 0;
      return Math.max(0, 1 - elapsed / ENEMY_FLASH_DURATION);
    },
    getManaShadowRatio() {
      return manaShadowRatio;
    },
    renderParticles(ctx, camera) {
      // パーティクル座標はコイン/敵などと同じ「タイル単位のワールド座標」で保持し、
      // 描画時にだけpxへ変換する(他のdraw*関数と同じ規約に揃える)。
      for (const p of pool.particles) {
        if (!p.active) continue;
        const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
        const destX = p.x * TILE_SIZE - camera.x;
        const destY = p.y * TILE_SIZE - camera.y;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(destX, destY, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(destX - p.size / 2, destY - p.size / 2, p.size, p.size);
        }
        ctx.restore();
      }

      ctx.save();
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd23f';
      for (const t of floatTexts) {
        const progress = 1 - t.life / t.maxLife;
        const destX = t.x * TILE_SIZE - camera.x;
        const destY = t.y * TILE_SIZE - camera.y - progress * 24;
        ctx.globalAlpha = Math.max(0, 1 - progress);
        ctx.fillText(t.text, destX, destY);
      }
      ctx.restore();
    },
  };
}
