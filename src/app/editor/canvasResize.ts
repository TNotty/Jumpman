// canvasの「表示サイズ(CSS px)」から「backing store解像度(実ピクセル数)」を求める純粋な計算。
// マップエディタのcanvasは、CSSで表示サイズを可変にする一方、内部解像度(canvas.width/height)を
// 固定960x640のままにしていたため、表示アスペクト比 ≠ 内部解像度比のときに非等方スケールで
// 描画が歪んでいた(スマホの縦画面/横画面で顕著)。この歪みを構造的に無くすには、内部解像度を
// 表示サイズ(× devicePixelRatio、retinaでも滲まないように)へ常に追従させる必要がある。
// DOM(ResizeObserver等)側の配線はeditor/main.ts側が担当し、このモジュールは
// 「次にcanvas.width/heightへ設定すべき値」と「実際に変更が必要か」の純粋な計算だけを行う。

export interface PixelSize {
  width: number;
  height: number;
}

/**
 * 表示サイズ(CSS px)とdevicePixelRatioから、backing store解像度(実ピクセル数)を計算する。
 * 1:1ピクセル描画(retinaでも滲まない)にするため、CSS px × dpr を四捨五入する。
 * 最小1(0以下のサイズにはしない。要素がまだレイアウトされておらず0幅/0高さの瞬間の保険)。
 */
export function computeBackingStoreSize(cssWidth: number, cssHeight: number, dpr: number): PixelSize {
  return {
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr)),
  };
}

/**
 * 現在のbacking store解像度と、これから設定すべき解像度を比較し、実際に変更が必要かを判定する。
 * ResizeObserverのコールバック内で毎回無条件にcanvas.width/heightへ代入すると、代入自体が
 * canvasの内容とtransformをリセットしてしまう上、環境によっては代入がレイアウトを再度動かして
 * ResizeObserverを再発火させるループの要因にもなり得るため、実際にサイズが変わったときだけ
 * 更新する(= 呼び出し側はこの関数がfalseを返す間はcanvas.width/heightに触れない)。
 */
export function needsResize(current: PixelSize, next: PixelSize): boolean {
  return current.width !== next.width || current.height !== next.height;
}
