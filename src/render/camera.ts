// カメラ: X はジャンプマンを画面左1/3に指数スムージング追従+ステージ端clamp。Y は固定。
export interface CameraState {
  /** カメラ左端のワールド座標(px) */
  x: number;
  y: number;
}

/** ジャンプマンを画面のどの位置に表示するか(左から1/3) */
const FOLLOW_FRACTION = 1 / 3;
/** 指数スムージング係数。大きいほど追従が速い */
const SMOOTHING_RATE = 6;

export function createCamera(): CameraState {
  return { x: 0, y: 0 };
}

/**
 * @param camera 現在のカメラ状態
 * @param targetWorldX 追従対象(ジャンプマン)のワールドX座標(px)
 * @param stageWidthPx ステージ全体の幅(px)
 * @param viewportWidthPx 表示領域の幅(px)
 * @param dt 経過秒
 */
export function updateCamera(
  camera: CameraState,
  targetWorldX: number,
  stageWidthPx: number,
  viewportWidthPx: number,
  dt: number,
): CameraState {
  const desired = targetWorldX - viewportWidthPx * FOLLOW_FRACTION;
  const maxX = Math.max(0, stageWidthPx - viewportWidthPx);
  const clampedDesired = Math.min(Math.max(desired, 0), maxX);

  const t = 1 - Math.exp(-SMOOTHING_RATE * dt);
  const nextX = camera.x + (clampedDesired - camera.x) * t;

  return { x: Math.min(Math.max(nextX, 0), maxX), y: 0 };
}
