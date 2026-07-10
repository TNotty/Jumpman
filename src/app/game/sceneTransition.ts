// シーン切替(タイトル→選択→プレイ→クリア→次)の短い黒フェード(0.25秒程度)を管理する
// 純粋な状態機械。DOM/Canvasには一切触れない(描画はmain.ts側がcomputeFadeAlphaの値を
// 使って行う)。ゲームロジックの時間そのものは止めない(シンプルな方を選ぶ、という
// コーディネーターの指示どおり): フェード中もupdateGame/effects.updateは通常どおり呼ばれ続け、
// このモジュールが管理するのは「いつ実際にシーンオブジェクトを切り替えるか」と
// 「フェード進行に応じた黒の不透明度」だけ。

export type TransitionState = 'idle' | 'fadeOut' | 'fadeIn';

export interface Transition {
  state: TransitionState;
  elapsed: number;
}

/** フェードイン/アウトそれぞれの所要時間(秒)。往復で約0.5秒。 */
export const FADE_DURATION = 0.25;

export function createIdleTransition(): Transition {
  return { state: 'idle', elapsed: 0 };
}

/** 遷移中(フェードアウト/フェードイン中のいずれか)か。trueの間は誤クリックを無効化する想定。 */
export function isTransitioning(transition: Transition): boolean {
  return transition.state !== 'idle';
}

/** フェードアウトを開始する(新しいTransitionを返す。既に遷移中なら呼び出し側でガードすること)。 */
export function beginFadeOut(): Transition {
  return { state: 'fadeOut', elapsed: 0 };
}

/**
 * 現在のTransitionから、画面全体に重ねる黒のalpha(0=透明・1=真っ黒)を求める純関数。
 * fadeOut中は0→1、fadeIn中は1→0、idle中は常に0。
 */
export function computeFadeAlpha(transition: Transition): number {
  if (transition.state === 'idle') return 0;
  const t = Math.min(1, transition.elapsed / FADE_DURATION);
  return transition.state === 'fadeOut' ? t : 1 - t;
}

export interface TransitionAdvanceResult {
  next: Transition;
  /** このフレームでfadeOut→fadeInへ切り替わった(=画面が完全に黒くなった)瞬間だけtrue。
   * 呼び出し側はこのタイミングで実際にシーンオブジェクトを切り替える(黒画面の裏で切り替わるため
   * 遷移が唐突に見えない)。 */
  fadeOutJustCompleted: boolean;
}

/** Transitionを1フレーム(dt秒)分進める。idle中は何もしない。 */
export function advanceTransition(transition: Transition, dt: number): TransitionAdvanceResult {
  if (transition.state === 'idle') {
    return { next: transition, fadeOutJustCompleted: false };
  }

  const elapsed = transition.elapsed + dt;

  if (transition.state === 'fadeOut') {
    if (elapsed >= FADE_DURATION) {
      return { next: { state: 'fadeIn', elapsed: 0 }, fadeOutJustCompleted: true };
    }
    return { next: { state: 'fadeOut', elapsed }, fadeOutJustCompleted: false };
  }

  // fadeIn
  if (elapsed >= FADE_DURATION) {
    return { next: { state: 'idle', elapsed: 0 }, fadeOutJustCompleted: false };
  }
  return { next: { state: 'fadeIn', elapsed }, fadeOutJustCompleted: false };
}
