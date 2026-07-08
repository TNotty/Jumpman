import { describe, expect, it, vi } from 'vitest';
import { createLoop } from './loop';

/** requestAnimationFrame/cancelAnimationFrame を模したフェイクスケジューラ */
function createFakeScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, (time: number) => void>();
  const scheduler = (cb: (time: number) => void): number => {
    const handle = nextHandle++;
    pending.set(handle, cb);
    return handle;
  };
  const canceller = (handle: number): void => {
    pending.delete(handle);
  };
  const flush = (time: number): void => {
    const callbacks = Array.from(pending.values());
    pending.clear();
    for (const cb of callbacks) cb(time);
  };
  return { scheduler, canceller, flush, pendingCount: () => pending.size };
}

describe('createLoop', () => {
  it('通常のフレーム時間(1/60秒)では update が1回だけ呼ばれる', () => {
    const { scheduler, canceller, flush } = createFakeScheduler();
    const update = vi.fn();
    const render = vi.fn();
    const loop = createLoop({ update, render }, () => 0, scheduler, canceller);

    loop.start();
    flush(0); // 初回フレーム: lastTime確定のみでupdateは走らない。renderは毎フレーム呼ばれる
    expect(update).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);

    flush(1000 / 60); // 約16.67ms経過
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(1 / 60);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('長いフレーム時間(タブ非アクティブ復帰等)でも update は最大4回までしか呼ばれない(clamp)', () => {
    const { scheduler, canceller, flush } = createFakeScheduler();
    const update = vi.fn();
    const render = vi.fn();
    const loop = createLoop({ update, render }, () => 0, scheduler, canceller);

    loop.start();
    flush(0);
    flush(10000); // 10秒分の経過をシミュレート(通常ならupdateが数百回必要になる状況)

    expect(update).toHaveBeenCalledTimes(4);
    expect(render).toHaveBeenCalledTimes(2); // 呼ばれたフレーム(flush)ごとに1回
  });

  it('stop() 後は次フレームがスケジュールされない', () => {
    const { scheduler, canceller, flush, pendingCount } = createFakeScheduler();
    const update = vi.fn();
    const render = vi.fn();
    const loop = createLoop({ update, render }, () => 0, scheduler, canceller);

    loop.start();
    flush(0);
    expect(pendingCount()).toBe(1);
    update.mockClear();
    render.mockClear();

    loop.stop();
    expect(pendingCount()).toBe(0);

    flush(1000 / 60); // pendingが無いので何も起きないはず
    expect(update).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});
