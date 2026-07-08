// マナの時間回復・上限clamp・消費を扱う純関数群。値そのものはステージJSON(mana)で上書きされる。
import type { ManaState } from './types';

/** 経過時間分だけ回復させる(上限でclamp) */
export function regenerate(mana: ManaState, dt: number): ManaState {
  if (mana.regenPerSec <= 0) return mana;
  const current = Math.min(mana.max, mana.current + mana.regenPerSec * dt);
  if (current === mana.current) return mana;
  return { ...mana, current };
}

/** 指定コストを支払えるか */
export function canAfford(mana: ManaState, cost: number): boolean {
  return mana.current >= cost;
}

/** 指定コストを消費する(0未満にはならない)。支払えない場合は呼び出し側で canAfford を先に確認すること */
export function spend(mana: ManaState, cost: number): ManaState {
  return { ...mana, current: Math.max(0, mana.current - cost) };
}
