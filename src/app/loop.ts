// 固定タイムステップの実行ループ(accumulator方式)。
// app層はブラウザAPI(requestAnimationFrame/performance.now)を参照してよい(core層は不可)。
import { FIXED_DT } from '../core/constants';

/** 1フレームあたりの最大更新ステップ数。処理落ちでスパイラル・オブ・デスに陥らないためのclamp */
const MAX_STEPS_PER_FRAME = 4;

export interface LoopCallbacks {
  /** 固定dtで呼ばれる決定論的な更新処理 */
  update: (dt: number) => void;
  /** 補間係数alpha(0〜1)付きで呼ばれる描画処理。1フレームに複数回updateが走っても render は1回のみ */
  render: (alpha: number) => void;
}

export interface Loop {
  start: () => void;
  stop: () => void;
}

export type FrameScheduler = (callback: (time: number) => void) => number;
export type FrameCanceller = (handle: number) => void;

// 既定スケジューラ。通常は requestAnimationFrame を使うが、タブ非表示中は
// rAF が完全に停止するため setTimeout(1フレーム分)にフォールバックする
// (ヘッドレス環境・自動テスト・別タブでの動作確認を可能にするため)。
const defaultScheduler: FrameScheduler = (cb) => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return window.setTimeout(() => cb(performance.now()), FIXED_DT * 1000);
  }
  return requestAnimationFrame(cb);
};

// ループが保持する未実行ハンドルは常に1つなので、両方に対してキャンセルを試みる
const defaultCanceller: FrameCanceller = (handle) => {
  cancelAnimationFrame(handle);
  clearTimeout(handle);
};

/**
 * 固定タイムステップループを生成する。
 * @param callbacks update/render コールバック
 * @param now 現在時刻(ms)を返す関数。テスト時は差し替え可能
 * @param scheduler 次フレームのスケジューリング関数。既定は requestAnimationFrame
 * @param canceller スケジュールのキャンセル関数。既定は cancelAnimationFrame
 */
export function createLoop(
  callbacks: LoopCallbacks,
  now: () => number = () => performance.now(),
  scheduler: FrameScheduler = defaultScheduler,
  canceller: FrameCanceller = defaultCanceller,
): Loop {
  let accumulator = 0;
  let lastTime: number | null = null;
  let handle: number | null = null;
  let running = false;

  const frame = (time: number): void => {
    if (!running) return;

    if (lastTime === null) {
      lastTime = time;
    }
    let frameTime = (time - lastTime) / 1000;
    lastTime = time;

    // 極端に大きなフレーム時間(タブ非アクティブ復帰等)をclamp
    const maxFrameTime = FIXED_DT * MAX_STEPS_PER_FRAME;
    if (frameTime > maxFrameTime) {
      frameTime = maxFrameTime;
    }

    accumulator += frameTime;

    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      callbacks.update(FIXED_DT);
      accumulator -= FIXED_DT;
      steps += 1;
    }

    const alpha = accumulator / FIXED_DT;
    callbacks.render(alpha);

    handle = scheduler(frame);
  };

  return {
    start(): void {
      if (running) return;
      running = true;
      accumulator = 0;
      lastTime = null;
      handle = scheduler(frame);
    },
    stop(): void {
      running = false;
      if (handle !== null) {
        canceller(handle);
        handle = null;
      }
    },
  };
}
