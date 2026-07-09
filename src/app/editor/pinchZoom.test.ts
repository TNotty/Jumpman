import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  applyPinchZoom,
  clampZoom,
  pinchStateFromPoints,
  touchDistance,
  touchMidpoint,
} from './pinchZoom';

describe('touchDistance / touchMidpoint', () => {
  it('2点間の距離を計算する', () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(touchDistance({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });

  it('2点の中点を計算する', () => {
    expect(touchMidpoint({ x: 0, y: 0 }, { x: 100, y: 200 })).toEqual({ x: 50, y: 100 });
    expect(touchMidpoint({ x: 10, y: 20 }, { x: 30, y: 0 })).toEqual({ x: 20, y: 10 });
  });
});

describe('clampZoom', () => {
  it('範囲内の値はそのまま返す', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2)).toBe(2);
  });

  it('MIN_ZOOM未満はMIN_ZOOMに、MAX_ZOOM超過はMAX_ZOOMにクランプする', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
  });
});

describe('pinchStateFromPoints(単指→2本指遷移の瞬間の基準状態)', () => {
  it('2本指の座標から中点と距離を計算する', () => {
    const state = pinchStateFromPoints({ x: 0, y: 0 }, { x: 6, y: 8 });
    expect(state.midpoint).toEqual({ x: 3, y: 4 });
    expect(state.distance).toBe(10);
  });
});

describe('applyPinchZoom', () => {
  it('距離が変わらず中点だけ移動した場合はズームなしでパンする(指を右に動かすとカメラは左=負方向に動く)', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const prev = { midpoint: { x: 100, y: 100 }, distance: 50 };
    const next = { midpoint: { x: 150, y: 120 }, distance: 50 }; // 距離同じ、中点だけ+50,+20移動
    const result = applyPinchZoom(camera, prev, next);

    expect(result.zoom).toBe(1);
    // コンテンツが指に追従する(指の下にあった座標が指の下に残る)ため、
    // 画面を+50,+20動かす指の動きに対してカメラのワールド原点は-50,-20動く
    expect(result.x).toBeCloseTo(-50);
    expect(result.y).toBeCloseTo(-20);
  });

  it('距離が2倍になった場合はズームが2倍になる(中点固定)', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const prev = { midpoint: { x: 100, y: 100 }, distance: 50 };
    const next = { midpoint: { x: 100, y: 100 }, distance: 100 }; // 中点固定、距離2倍
    const result = applyPinchZoom(camera, prev, next);

    expect(result.zoom).toBe(2);
    // 中点が動いていないので、中点直下のワールド座標がズーム前後で不変になるようx/yが補正される
    // (中点(100,100)のワールド座標は、旧カメラで x/1+0=100、新カメラで x/2+cameraX=100 となるcameraXを解く)
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(50);
  });

  it('パン+ズームを同時に行っても、指の下にあったワールド座標が更新後も指の下(新しい中点)に留まる', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const prev = { midpoint: { x: 100, y: 100 }, distance: 50 };
    const next = { midpoint: { x: 150, y: 120 }, distance: 100 };
    const result = applyPinchZoom(camera, prev, next);

    // 更新後カメラで、next.midpoint(指の新しい位置)が指すワールド座標を逆算する
    const worldAtNextMidpointAfter = {
      x: next.midpoint.x / result.zoom + result.x,
      y: next.midpoint.y / result.zoom + result.y,
    };
    // 旧カメラでprev.midpoint(指の元の位置)が指していたワールド座標と一致するはず
    // (=指の下にあったコンテンツが、指の移動後も指の下に留まる=自然にドラッグされる)
    const worldAtPrevMidpointBefore = {
      x: prev.midpoint.x / camera.zoom + camera.x,
      y: prev.midpoint.y / camera.zoom + camera.y,
    };
    expect(worldAtNextMidpointAfter.x).toBeCloseTo(worldAtPrevMidpointBefore.x);
    expect(worldAtNextMidpointAfter.y).toBeCloseTo(worldAtPrevMidpointBefore.y);
  });

  it('ズーム結果はMIN_ZOOM/MAX_ZOOMにクランプされる', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    const shrink = applyPinchZoom(camera, { midpoint: { x: 0, y: 0 }, distance: 100 }, { midpoint: { x: 0, y: 0 }, distance: 1 });
    expect(shrink.zoom).toBe(MIN_ZOOM);

    const grow = applyPinchZoom(camera, { midpoint: { x: 0, y: 0 }, distance: 1 }, { midpoint: { x: 0, y: 0 }, distance: 1000 });
    expect(grow.zoom).toBe(MAX_ZOOM);
  });

  it('prev.distanceが0(縮退)でもゼロ除算せずズーム倍率1として扱う', () => {
    const camera = { x: 5, y: 5, zoom: 2 };
    const prev = { midpoint: { x: 0, y: 0 }, distance: 0 };
    const next = { midpoint: { x: 0, y: 0 }, distance: 10 };
    const result = applyPinchZoom(camera, prev, next);
    expect(result.zoom).toBe(2);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);
  });
});
