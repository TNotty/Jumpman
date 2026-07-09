// core層の共有データ型。
// 鉄則: このファイル(および core/ 配下全体)は window/document/Canvas/Date.now/Math.random を
// 一切参照しない純粋なデータ定義・ロジックのみを置く。

/** 2次元ベクトル(タイル単位で使うことが多い) */
export interface Vec2 {
  x: number;
  y: number;
}

/** 軸平行境界ボックス。x,y は左上原点、タイル単位 */
export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** タイル種別。ステージJSONの文字凡例 '.' 'N' 'B' 'S' 'F' に対応 */
export enum BlockType {
  Empty = 0,
  Normal = 1,
  Breakable = 2,
  Spike = 3,
  Falling = 4,
}

/** ステージ/地形マスタJSONの文字 → BlockType 変換テーブル */
export const BLOCK_CHAR_MAP: Readonly<Record<string, BlockType>> = {
  '.': BlockType.Empty,
  N: BlockType.Normal,
  B: BlockType.Breakable,
  S: BlockType.Spike,
  F: BlockType.Falling,
};

/** BlockType → 文字(エディタでの書き出し等に使用) */
export const BLOCK_TYPE_CHAR: Readonly<Record<BlockType, string>> = {
  [BlockType.Empty]: '.',
  [BlockType.Normal]: 'N',
  [BlockType.Breakable]: 'B',
  [BlockType.Spike]: 'S',
  [BlockType.Falling]: 'F',
};

/**
 * 軸分離衝突判定において「実体のある壁」として扱うタイルか。
 * トゲは重なり判定(接触ダメージ)のみで、衝突による押し戻しの対象にはしない。
 * 壊れる/落ちるブロックは静的グリッド上は常に固体として扱う。蓄積ダメージによる消滅や
 * 「乗られたら震えて落下」といった動的な状態遷移は blocks.ts が別途管理する。
 */
export function isSolidBlock(type: BlockType): boolean {
  switch (type) {
    case BlockType.Normal:
    case BlockType.Breakable:
    case BlockType.Falling:
      return true;
    case BlockType.Spike:
    case BlockType.Empty:
      return false;
    default:
      return false;
  }
}

/** 敵種別 */
export enum EnemyType {
  Slime = 'slime',
  Frog = 'frog',
  Bird = 'bird',
}

/** ステージJSONに書かれる敵の初期配置(静的データ) */
export interface EnemyDefinition {
  type: EnemyType;
  x: number;
  y: number;
  dir: 1 | -1;
}

/** 実行時の敵状態。AI挙動(enemies.ts)により毎フレーム更新される。 */
export interface EnemyState {
  id: number;
  type: EnemyType;
  /** 当たり判定AABBの左上座標(タイル単位) */
  x: number;
  y: number;
  dir: 1 | -1;
  velocity: Vec2;
  hp: number;
  alive: boolean;
  grounded: boolean;
  /** 初期配置(死亡復帰時のリセット用) */
  spawn: EnemyDefinition;
}

/** チェックポイントの静的定義(ステージJSON) */
export interface CheckpointDefinition {
  x: number;
  y: number;
}

/** 実行時のチェックポイント状態 */
export interface CheckpointState extends CheckpointDefinition {
  activated: boolean;
}

/** コインの静的定義(ステージJSON)。1マス相当の位置のみ持つ */
export interface CoinDefinition {
  x: number;
  y: number;
}

/**
 * 実行時のコイン状態。
 * permanentlyCollected: このプレイ開始時点(createGameState呼び出し時点)で既にセーブデータ上
 *   取得済みだったか。半透明表示になり、重なってもwalletは増えない(何度でも「見た目上」拾える)。
 * collectedThisSession: 今回のプレイ中(このGameStateの生存期間、死亡/リトライを跨いでも)に
 *   新規取得したか。取得後は半透明表示になる(permanentlyCollectedと同じ見た目)。
 */
export interface CoinState extends CoinDefinition {
  permanentlyCollected: boolean;
  collectedThisSession: boolean;
}

/** マナ設定(ステージJSONで上書き可能。既定値は constants.ts) */
export interface ManaConfig {
  initial: number;
  max: number;
  regenPerSec: number;
}

/** 実行時のマナ状態 */
export interface ManaState {
  current: number;
  max: number;
  regenPerSec: number;
}

/**
 * パレットで選択中の枠。地形マスタの数値スロット(0-7)か、常時選択可能な消去スロット('eraser')。
 * 消去スロット選択中は、左クリック/タップによる主操作(placeTerrainコマンド)がgame.tsの
 * コマンド処理で消去として扱われる(右クリックのeraseTileコマンドとは独立に常時有効)。
 */
export type PaletteSlot = number | 'eraser';

/** 生成地形マスタの1エントリ(terrainMaster.json) */
export interface TerrainDefinition {
  id: string;
  name: string;
  cost: number;
  unlocked: boolean;
  /** 解放に必要なコイン枚数(未解放時のみ意味を持つ)。解放済みエントリは慣例的に0 */
  unlockCost: number;
  /** 文字凡例はステージJSONと同じ('.'は形状に含まれない空マス)。左上セルが配置基準点 */
  grid: string[];
}

/** バリデーション済み地形マスタデータ */
export interface TerrainMaster {
  version: number;
  terrains: TerrainDefinition[];
}

/** バリデーション済みステージデータ */
export interface StageData {
  version: number;
  id: string;
  name: string;
  theme: string;
  width: number;
  height: number;
  tiles: string[];
  start: Vec2;
  goal: Vec2;
  checkpoints: CheckpointDefinition[];
  enemies: EnemyDefinition[];
  mana: ManaConfig;
  eraseCost: number;
  /** コイン配置(推奨5枚、スキーマ上は0枚以上を許容)。省略時(後方互換)は空配列扱い */
  coins: CoinDefinition[];
}

/** ジャンプマンの実行時状態 */
export interface JumpmanState {
  /** AABB左上座標(タイル単位) */
  position: Vec2;
  velocity: Vec2;
  facing: 1 | -1;
  grounded: boolean;
  hp: number;
  invincibleTimer: number;
  jumpCooldown: number;
  /** 残りノックバック時間(秒)。0より大きい間は自動走行のvelocity.x上書きと自動ジャンプを抑制する */
  knockbackTimer: number;
  /** 直近のスタート/チェックポイント座標。死亡時にここへ戻る */
  respawnPoint: Vec2;
}

/** ゲーム全体の進行状態 */
export enum GameStatus {
  Playing = 'playing',
  Cleared = 'cleared',
}
