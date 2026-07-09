// 強化(アップグレード)の経済ロジック(コスト/返還/効果算出)+地形解放。純粋関数のみ。
// core層の鉄則どおりwindow/document/localStorage等には一切触れない。セーブデータの読み書きは
// app層(src/data/saveData.ts, src/app/**)の責務であり、このモジュールはセーブから取り出した
// 値(レベル・wallet・unlockedTerrainIds)を引数で受け取り、結果を返すだけにする。
//
// UpgradeLevels は data/saveData.ts の SaveDataUpgrades と同じ形だが、あえて別型として
// core内で定義している(coreがdata/を参照する依存を作らないため)。構造的に同一なので
// SaveDataUpgradesの値をそのままこの型が要求される箇所へ渡せる(変換不要)。
import { JUMPMAN_MAX_HP, JUMP_VELOCITY, RUN_SPEED } from './constants';
import type { TerrainDefinition } from './types';

export const UPGRADE_KEYS = ['hp', 'speed', 'jump', 'manaRegen', 'manaMax'] as const;
export type UpgradeKey = (typeof UPGRADE_KEYS)[number];

/** 強化レベルの上限(各項目0〜10) */
export const MAX_UPGRADE_LEVEL = 10;

export interface UpgradeLevels {
  hp: number;
  speed: number;
  jump: number;
  manaRegen: number;
  manaMax: number;
}

/** 全項目レベル0(未強化)の初期状態 */
export function zeroUpgradeLevels(): UpgradeLevels {
  return { hp: 0, speed: 0, jump: 0, manaRegen: 0, manaMax: 0 };
}

// --- コスト/返還曲線(リード決定) --------------------------------------------------
// レベルL→L+1のコストはL+1コイン(1,2,3,...,10。1項目を0→10までフル強化すると
// 1+2+...+10=55枚)。ダウングレード(L→L-1)は「強化に使ったコインを返還」=lossless、
// つまりL→L-1の返還額はそのレベルへ上げた時に払ったコスト(=L)と同額になる。

/** レベルLからL+1へ上げるのに必要なコスト(コイン) */
export function upgradeCost(currentLevel: number): number {
  return currentLevel + 1;
}

/** レベルLからL-1へ下げた際に返還されるコイン(lossless=上げた時と同額) */
export function downgradeRefund(currentLevel: number): number {
  return currentLevel;
}

export type UpgradeChangeReason = 'max_level' | 'min_level' | 'insufficient_wallet';

export interface UpgradeChangeResult {
  ok: boolean;
  reason?: UpgradeChangeReason;
  /** 変更後のレベル一覧(拒否時は変更前と同一内容の新規オブジェクト) */
  levels: UpgradeLevels;
  /** walletに加算すべき差分(負=消費、正=返還、拒否時は0) */
  walletDelta: number;
}

/** 指定項目を1レベル上げる。最大到達(10)またはwallet不足なら拒否する(walletは呼び出し側の現在値) */
export function increaseUpgrade(levels: UpgradeLevels, key: UpgradeKey, wallet: number): UpgradeChangeResult {
  const current = levels[key];
  if (current >= MAX_UPGRADE_LEVEL) {
    return { ok: false, reason: 'max_level', levels: { ...levels }, walletDelta: 0 };
  }
  const cost = upgradeCost(current);
  if (wallet < cost) {
    return { ok: false, reason: 'insufficient_wallet', levels: { ...levels }, walletDelta: 0 };
  }
  return { ok: true, levels: { ...levels, [key]: current + 1 }, walletDelta: -cost };
}

/** 指定項目を1レベル下げ、コインを返還する。レベル0(未強化)なら拒否する */
export function decreaseUpgrade(levels: UpgradeLevels, key: UpgradeKey): UpgradeChangeResult {
  const current = levels[key];
  if (current <= 0) {
    return { ok: false, reason: 'min_level', levels: { ...levels }, walletDelta: 0 };
  }
  const refund = downgradeRefund(current);
  return { ok: true, levels: { ...levels, [key]: current - 1 }, walletDelta: refund };
}

// --- 効果算出(リード決定、基準値はconstants.ts) -----------------------------------

/** ジャンプマンの実際のプレイ挙動に反映される、強化を織り込み済みの実効ステータス */
export interface PlayerStats {
  /** 最大HP = 5 + level(最大15) */
  maxHp: number;
  /** 走行速度(タイル/秒) = RUN_SPEED × (1 + 0.1×level)(最大2倍) */
  runSpeed: number;
  /** ジャンプ初速(上方向は負) = JUMP_VELOCITY × (1 + 0.1×level) */
  jumpVelocity: number;
  /** ステージのregenPerSecに掛ける倍率 = 1 + 0.2×level(最大3倍) */
  manaRegenMultiplier: number;
  /** ステージのmanaに加算するボーナス = 5×level(最大+50) */
  manaMaxBonus: number;
}

/** 強化レベルから実効ステータス(PlayerStats)を導出する */
export function derivePlayerStats(levels: UpgradeLevels): PlayerStats {
  return {
    maxHp: JUMPMAN_MAX_HP + levels.hp,
    runSpeed: RUN_SPEED * (1 + 0.1 * levels.speed),
    jumpVelocity: JUMP_VELOCITY * (1 + 0.1 * levels.jump),
    manaRegenMultiplier: 1 + 0.2 * levels.manaRegen,
    manaMaxBonus: 5 * levels.manaMax,
  };
}

/** 全項目レベル0(未強化)のPlayerStats。省略時の既定値として core/jumpman.ts・core/game.ts が使う */
export const DEFAULT_PLAYER_STATS: PlayerStats = derivePlayerStats(zeroUpgradeLevels());

// --- 地形解放 ----------------------------------------------------------------------

export type UnlockTerrainReason = 'already_unlocked' | 'insufficient_wallet';

export interface UnlockTerrainResult {
  ok: boolean;
  reason?: UnlockTerrainReason;
  wallet: number;
  unlockedTerrainIds: string[];
}

/**
 * 地形を解放する。wallet不足、または既にunlockedTerrainIdsに含まれていれば拒否する
 * (解放は返還不可の恒久操作のため、二重解放で誤って再徴収しないための安全策)。
 * terrainMaster.jsonで最初から unlocked:true な地形(初期3種、unlockCost 0)は、
 * この関数を呼ぶ前に isTerrainUnlocked() で「常に解放済み」と判定されるべきもので、
 * 通常はこの関数の対象にならない(呼び出し側=UIがボタン自体を出さない想定)。
 */
export function unlockTerrain(
  wallet: number,
  unlockedTerrainIds: readonly string[],
  terrainId: string,
  unlockCost: number,
): UnlockTerrainResult {
  if (unlockedTerrainIds.includes(terrainId)) {
    return { ok: false, reason: 'already_unlocked', wallet, unlockedTerrainIds: [...unlockedTerrainIds] };
  }
  if (wallet < unlockCost) {
    return { ok: false, reason: 'insufficient_wallet', wallet, unlockedTerrainIds: [...unlockedTerrainIds] };
  }
  return { ok: true, wallet: wallet - unlockCost, unlockedTerrainIds: [...unlockedTerrainIds, terrainId] };
}

/**
 * 地形が(初期解放済み、またはセーブ上のunlockedTerrainIds経由で)使用可能かを判定する。
 * terrainMaster.json由来のunlocked:trueフラグ(初期3種)は常に優先される。
 */
export function isTerrainUnlocked(terrain: TerrainDefinition, unlockedTerrainIds: readonly string[]): boolean {
  return terrain.unlocked || unlockedTerrainIds.includes(terrain.id);
}
