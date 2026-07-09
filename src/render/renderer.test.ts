import { describe, expect, it } from 'vitest';
import { coinRenderState } from './renderer';

describe('coinRenderState', () => {
  it('permanentlyCollected(再訪時点で既に取得済み)は半透明(dim)になる', () => {
    expect(coinRenderState({ permanentlyCollected: true, collectedThisSession: false })).toBe('dim');
  });

  it('collectedThisSession(今回のセッションで新規取得)は非描画(hidden、即座に消える)になる', () => {
    expect(coinRenderState({ permanentlyCollected: false, collectedThisSession: true })).toBe('hidden');
  });

  it('未取得は通常表示(normal)になる', () => {
    expect(coinRenderState({ permanentlyCollected: false, collectedThisSession: false })).toBe('normal');
  });

  it('permanentlyCollectedが優先される(理論上両方trueになることは無いが、念のため)', () => {
    expect(coinRenderState({ permanentlyCollected: true, collectedThisSession: true })).toBe('dim');
  });
});
