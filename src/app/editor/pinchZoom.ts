// マップエディタの2本指パン+ピンチズームの純粋な幾何計算(DOM非依存)。
// 実際のタッチイベント処理(何本指が触れているかの状態遷移・touchstart/move/end配線)は
// editor/main.ts側が担当し、このモジュールは「2点の座標」から「カメラの次の状態」を導出する
// 計算だけを行う。ズーム基準点は常にその時点の2本指の中点にする(=指の間の内容が指から
// ズレないよう、中点を画面上の同じ位置に保つ)。既存のホイールズーム(main.ts)と同じ考え方。
export interface Point {
  x: number;
  y: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface PinchState {
  /** 2本指の中点(キャンバスローカル座標、スクリーンpx) */
  midpoint: Point;
  /** 2本指間の距離(スクリーンpx) */
  distance: number;
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** ズーム範囲(MIN_ZOOM〜MAX_ZOOM)にクランプする */
export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function screenToWorld(camera: Camera, p: Point): Point {
  return { x: p.x / camera.zoom + camera.x, y: p.y / camera.zoom + camera.y };
}

/** 2点間のユークリッド距離 */
export function touchDistance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 2点の中点 */
export function touchMidpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * 2本指の座標(単指→2本指遷移の瞬間、あるいは2本指移動の各フレーム)から
 * 中点・距離のペア(PinchState)を計算する。2本指ジェスチャーの基準状態として使う。
 */
export function pinchStateFromPoints(a: Point, b: Point): PinchState {
  return { midpoint: touchMidpoint(a, b), distance: touchDistance(a, b) };
}

/**
 * 2本指パン+ピンチズームの1フレーム分の更新後カメラを計算する。
 * 物理的な意図: 「指の下にあったワールド座標が、指が動いた後も指の下にあり続ける」こと
 * (=コンテンツが指に追従してドラッグされる感覚)。すなわち、
 *   screenToWorld(旧camera, prev.midpoint) === screenToWorld(新camera, next.midpoint)
 * が成り立つように新しいcamera.x/yを解く。ズームは距離の比率(next.distance / prev.distance)を
 * 現在のzoomに乗算し、範囲をクランプしてから上の式に使う。
 * prev.distance が 0 以下(縮退)の場合はズーム倍率を1として扱う(ゼロ除算を避ける)。
 */
export function applyPinchZoom(camera: Camera, prev: PinchState, next: PinchState): Camera {
  const anchorWorld = screenToWorld(camera, prev.midpoint);
  const scaleFactor = prev.distance > 0 ? next.distance / prev.distance : 1;
  const nextZoom = clampZoom(camera.zoom * scaleFactor);

  return {
    zoom: nextZoom,
    x: anchorWorld.x - next.midpoint.x / nextZoom,
    y: anchorWorld.y - next.midpoint.y / nextZoom,
  };
}
