// カメラ: X はジャンプマンを画面左1/3に指数スムージング追従+ステージ端clamp。
// Y はステージ高さがビューより低い場合は「ステージ最下段=画面下端」に固定(床が画面下に来る)、
// ビューより高い場合はジャンプマンを縦にも追従(clamp付き)する。
export interface CameraState {
  /** カメラ左端のワールド座標(px) */
  x: number;
  /** カメラ上端のワールド座標(px)。負値=ステージがビューより低く、下端揃えしている状態 */
  y: number;
}

/** ジャンプマンを画面のどの位置に表示するか(左から1/3) */
const FOLLOW_FRACTION = 1 / 3;
/** 縦追従でジャンプマンを画面のどの位置に表示するか(上から1/2) */
const FOLLOW_FRACTION_Y = 1 / 2;
/** 指数スムージング係数。大きいほど追従が速い */
const SMOOTHING_RATE = 6;

export function createCamera(): CameraState {
  return { x: 0, y: 0 };
}

/**
 * ステージ高さに応じたカメラYを返す。
 * - ステージがビュー以下の高さ: 下端揃えの固定値(stageHeightPx - viewportHeightPx ≦ 0)
 * - ステージがビューより高い: 追従対象を中央に置く目標値を [0, stageH-viewH] にclamp
 */
export function cameraTargetY(
  targetWorldY: number,
  stageHeightPx: number,
  viewportHeightPx: number,
): number {
  const maxY = stageHeightPx - viewportHeightPx;
  if (maxY <= 0) {
    return maxY; // 下端揃え(ビューより低いステージは常にこの固定値)
  }
  const desired = targetWorldY - viewportHeightPx * FOLLOW_FRACTION_Y;
  return Math.min(Math.max(desired, 0), maxY);
}

/**
 * @param camera 現在のカメラ状態
 * @param targetWorldX 追従対象(ジャンプマン)のワールドX座標(px)
 * @param targetWorldY 追従対象(ジャンプマン)のワールドY座標(px)
 * @param stageWidthPx ステージ全体の幅(px)
 * @param stageHeightPx ステージ全体の高さ(px)
 * @param viewportWidthPx 表示領域の幅(px)
 * @param viewportHeightPx 表示領域の高さ(px)
 * @param dt 経過秒
 */
export function updateCamera(
  camera: CameraState,
  targetWorldX: number,
  targetWorldY: number,
  stageWidthPx: number,
  stageHeightPx: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  dt: number,
): CameraState {
  const desired = targetWorldX - viewportWidthPx * FOLLOW_FRACTION;
  const maxX = Math.max(0, stageWidthPx - viewportWidthPx);
  const clampedDesired = Math.min(Math.max(desired, 0), maxX);

  const t = 1 - Math.exp(-SMOOTHING_RATE * dt);
  const nextX = camera.x + (clampedDesired - camera.x) * t;

  const desiredY = cameraTargetY(targetWorldY, stageHeightPx, viewportHeightPx);
  const maxY = stageHeightPx - viewportHeightPx;
  let nextY: number;
  if (maxY <= 0) {
    nextY = desiredY; // 固定値なのでスムージング不要(初回から正しい位置)
  } else {
    nextY = camera.y + (desiredY - camera.y) * t;
    nextY = Math.min(Math.max(nextY, 0), maxY);
  }

  return { x: Math.min(Math.max(nextX, 0), maxX), y: nextY };
}
