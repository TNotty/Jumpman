// 物理・バランス定数を一元管理する。
// 鉄則: このファイルは値の定義のみ。window/document/Canvas/Date.now/Math.random は参照しない。

/** 1タイルのピクセルサイズ */
export const TILE_SIZE = 32;

/** 固定タイムステップ(1/60秒) */
export const FIXED_DT = 1 / 60;

/** 論理解像度 */
export const LOGICAL_WIDTH = 1280;
export const LOGICAL_HEIGHT = 768;
/** 上側: ゲーム描画領域の高さ */
export const GAME_AREA_HEIGHT = 640;
/** 下側: パレット領域の高さ(全体の1/6) */
export const PALETTE_HEIGHT = 128;

/** ジャンプマンの自動走行速度(タイル/秒)。v5-1で初期調整のため半分にした(6→3) */
export const RUN_SPEED = 3;
/** 重力加速度(タイル/秒^2) */
export const GRAVITY = 50;
/** ジャンプ初速(上方向は負、到達高さ≈2.9タイル) */
export const JUMP_VELOCITY = -17;
/** 落下速度の上限(タイル/秒、トンネリング防止) */
export const MAX_FALL_SPEED = 20;

/** ジャンプマンの当たり判定サイズ(タイル単位) */
export const JUMPMAN_WIDTH = 0.6;
export const JUMPMAN_HEIGHT = 1.5;
export const JUMPMAN_MAX_HP = 5;

/** 被弾ノックバック初速(タイル/秒) */
export const KNOCKBACK_VX = -8;
export const KNOCKBACK_VY = -10;
/** 被弾後の無敵時間(秒) */
export const INVINCIBLE_DURATION = 2.0;
/**
 * ノックバック中、自動走行によるvelocity.x上書き(RUN_SPEED*facing)と自動ジャンプ判定を
 * 抑制する時間(秒)。この間はapplyDamageが設定した速度がそのまま物理演算に反映される。
 */
export const KNOCKBACK_DURATION = 0.15;

/** 自動ジャンプ: 壁センサーの前方オフセット(タイル) */
export const WALL_SENSOR_OFFSET = 0.05;
/** 自動ジャンプ: 崖プローブの前方距離(タイル) */
export const CLIFF_LOOKAHEAD = 0.4;
/** 自動ジャンプ: 崖プローブの下方距離(タイル) */
export const CLIFF_PROBE_DROP = 0.1;
/** 自動ジャンプ: ジャンプ後のクールダウン(秒) */
export const JUMP_COOLDOWN = 0.1;

/** 落下死判定: ステージ高さ + このタイル数を超えたら死亡 */
export const FALL_DEATH_MARGIN = 2;

/** 敵の能力値(ステージJSONではなくここに一元化) */
export const ENEMY_STATS = {
  slime: { hp: 2, speed: 1.5, contactDamage: 1 },
  frog: { hp: 2, jumpVx: 3, jumpVy: -12, contactDamage: 1 },
  bird: { hp: 1, speed: 3, contactDamage: 1 },
} as const;

/** マナの既定値(ステージJSONの mana フィールドで上書き可能) */
export const DEFAULT_MANA: { initial: number; max: number; regenPerSec: number } = {
  initial: 10,
  max: 50,
  regenPerSec: 1,
};

/** 地形消去の既定コスト(ステージJSONの eraseCost で上書き可能) */
export const DEFAULT_ERASE_COST = 3;

/** パレットのスロット数(固定8枠) */
export const PALETTE_SLOT_COUNT = 8;

/** 敵1体分の当たり判定サイズ(タイル単位。1マス相当) */
export const ENEMY_WIDTH = 1;
export const ENEMY_HEIGHT = 1;

/** トゲ接触ダメージ(ジャンプマン・敵とも共通) */
export const SPIKE_CONTACT_DAMAGE = 1;

/** 壊れるブロック: 1段階分の見た目変化に必要な接触時間(秒) */
export const BREAKABLE_STAGE_DURATION = 0.2;
/** 壊れるブロック: この段階数に達すると消滅する(0=無傷 見た目1, 1=見た目2, 2=見た目3, 3=消滅) */
export const BREAKABLE_STAGE_COUNT = 3;

/** 落ちるブロック: 乗られてから落下開始するまでの震え時間(秒) */
export const FALLING_SHAKE_DURATION = 0.4;
