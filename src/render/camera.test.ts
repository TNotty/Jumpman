import { describe, expect, it } from 'vitest';
import { cameraTargetY, createCamera, updateCamera } from './camera';

const VIEW_W = 1280;
const VIEW_H = 640;

describe('cameraTargetY', () => {
  it('ステージがビューより低い場合は下端揃えの固定値(負値)を返す', () => {
    // 高さ12タイル=384px のステージ: 384 - 640 = -256
    expect(cameraTargetY(100, 384, VIEW_H)).toBe(-256);
    // 追従対象の位置に関わらず固定
    expect(cameraTargetY(0, 384, VIEW_H)).toBe(-256);
  });

  it('ステージ高さ=ビュー高さなら常に0', () => {
    expect(cameraTargetY(0, VIEW_H, VIEW_H)).toBe(0);
    expect(cameraTargetY(9999, VIEW_H, VIEW_H)).toBe(0);
  });

  it('ステージがビューより高い場合は対象を中央に置く目標値をclampして返す', () => {
    const stageH = 1280; // 40タイル
    // 上端付近: clampで0
    expect(cameraTargetY(0, stageH, VIEW_H)).toBe(0);
    // 中央: 640 - 320 = 320
    expect(cameraTargetY(640, stageH, VIEW_H)).toBe(320);
    // 下端付近: clampで maxY = 640
    expect(cameraTargetY(9999, stageH, VIEW_H)).toBe(640);
  });
});

describe('updateCamera (Y)', () => {
  it('低いステージでは初回updateから下端揃えのYになる(スムージングで浮かない)', () => {
    const cam = createCamera();
    const next = updateCamera(cam, 0, 100, 2000, 384, VIEW_W, VIEW_H, 1 / 60);
    expect(next.y).toBe(-256);
  });

  it('高いステージではYが[0, stageH-viewH]にclampされる', () => {
    let cam = createCamera();
    for (let i = 0; i < 300; i++) {
      cam = updateCamera(cam, 0, 100000, 2000, 1280, VIEW_W, VIEW_H, 1 / 60);
    }
    expect(cam.y).toBeLessThanOrEqual(640);
    expect(cam.y).toBeGreaterThanOrEqual(0);
    expect(cam.y).toBeCloseTo(640, 0);
  });
});
