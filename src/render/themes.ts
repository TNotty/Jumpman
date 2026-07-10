// テーマ(grass/cave)ごとの色・パラメータを1箇所に集約する。render/background.ts(パララックス
// 背景)とrender/renderer.ts(タイルのオートタイリング縁取り)・app/editor/main.ts(エディタ
// キャンバスの軽い背景反映)がここを参照する。新しいテーマを追加する場合、このファイルに
// ThemeDefinitionを1つ足すだけで済む構造にしている(background/rendererの側は変更不要)。
//
// 鉄則: このファイルはcore層に依存しない値の定義のみ(color文字列・数値パラメータ)。
// window/document/Canvas/Math.random は参照しない(純粋な定義データ)。

/** パララックス層1つ分の見た目パラメータ */
export interface ParallaxLayerTheme {
  /** シルエットの塗り色 */
  color: string;
  /** カメラ追従率(0=完全固定・最も奥、1=カメラと同速=最前面に近いほど1に近い) */
  parallaxFactor: number;
}

/** オートタイリング(通常ブロックの縁取り・内部陰影)の色調 */
export interface TileTintTheme {
  /** 上端(空側)に面したセルのハイライト色 */
  edgeHighlight: string;
  /** 左右/角に面したセルの陰影色 */
  edgeShadow: string;
  /** 四方をブロックに囲まれた内部セルの暗め模様色(半透明で重ねる想定) */
  innerShade: string;
}

export interface ThemeDefinition {
  id: string;
  /** 空(最背面)の上下グラデーション色。上=画面上端、下=画面下端(GAME_AREA_HEIGHT位置) */
  sky: { top: string; bottom: string };
  /** 雲層。草原のみ想定(洞窟はundefined=描画しない) */
  cloud?: { color: string; parallaxFactor: number; autoScrollPxPerSec: number };
  /** 遠景(草原=山、洞窟=奥の岩壁) */
  farLayer: ParallaxLayerTheme;
  /** 近景(草原=丘/森、洞窟=鍾乳石/結晶) */
  midLayer: ParallaxLayerTheme;
  /** 洞窟の鍾乳石/結晶の微発光色。草原はundefined(発光なし) */
  glowColor?: string;
  tile: TileTintTheme;
  /** エディタキャンバスの背景反映用(パララックスは不要、軽い単色でよい) */
  editorBackground: string;
}

const GRASS_THEME: ThemeDefinition = {
  id: 'grass',
  sky: { top: '#1b3a6b', bottom: '#87ceeb' },
  cloud: { color: 'rgba(255, 255, 255, 0.85)', parallaxFactor: 0.1, autoScrollPxPerSec: 6 },
  farLayer: { color: '#5b7fa6', parallaxFactor: 0.2 },
  midLayer: { color: '#2f5233', parallaxFactor: 0.5 },
  tile: {
    edgeHighlight: '#8ed16f',
    edgeShadow: '#1f3d1f',
    innerShade: 'rgba(0, 0, 0, 0.25)',
  },
  editorBackground: '#2b4a63',
};

const CAVE_THEME: ThemeDefinition = {
  id: 'cave',
  sky: { top: '#050508', bottom: '#151522' },
  farLayer: { color: '#232030', parallaxFactor: 0.2 },
  midLayer: { color: '#3a3348', parallaxFactor: 0.5 },
  glowColor: 'rgba(140, 200, 255, 0.65)',
  tile: {
    edgeHighlight: '#c9a4ff',
    edgeShadow: '#0c0c14',
    innerShade: 'rgba(0, 0, 0, 0.35)',
  },
  editorBackground: '#141420',
};

const THEMES: Record<string, ThemeDefinition> = {
  grass: GRASS_THEME,
  cave: CAVE_THEME,
};

/**
 * テーマIDから定義を取得する。未知のテーマID(将来の拡張中など)はcaveへフォールバックせず、
 * 既存コードの慣例(blockSpriteName等)に合わせて「grass以外は全てcave相当」として扱う
 * (2値テーマの現状の設計と一貫させるため。3つ目以降のテーマを追加する際はこのフォールバックを
 * Record引きに変更する)。
 */
export function getTheme(themeId: string): ThemeDefinition {
  return themeId === 'grass' ? GRASS_THEME : CAVE_THEME;
}

export const ALL_THEMES: readonly ThemeDefinition[] = [GRASS_THEME, CAVE_THEME];
