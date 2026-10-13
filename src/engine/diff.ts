// 2つの週の定常状態 A, B の効用差 ΔU = U(A) − U(B) を高速に計算するための「コンパイル」
// 推定では 何千個の粒子 × 何百問 の ΔU を繰り返し計算するので、
// A と B で値が違う項だけを前もって取り出しておく。

import type { WeekState } from './types'
import { ACTIVITY_KEYS } from './types'
import {
  ACTIVITIES,
  C_REF,
  N_ACT,
  P_AEXP,
  P_AGOODS,
  P_ASOCIAL,
  P_BETA,
  P_COMMUTE,
  P_ETA,
  P_OVERWORK,
  P_S,
  P_SECM,
  P_SECMAX,
  P_W,
  P_WORKJOY,
  SPEND_SCALES,
  activityUtility,
  crra,
  equivalizedConsumption,
  fixedUtility,
  goodsConsumption,
  securityUtility,
  spendBonus,
  workUtility,
} from './model'

export interface CompiledDiff {
  act: { i: number; hA: number; hB: number; min: number; fatigue: number }[]
  /** 等価消費 / C_REF（A, B）。差がなければ null */
  cons: [number, number] | null
  spend: { p: number; xA: number; xB: number; scale: number }[]
  sec: [number, number] | null
  work: { hA: number; hB: number; shiftA: number; shiftB: number } | null
  commute: number
  /** θ に依存しない固定の項の差 */
  constant: number
}

const EPS = 1e-9

export function compileDiff(a: WeekState, b: WeekState): CompiledDiff {
  const act: CompiledDiff['act'] = []
  for (let i = 0; i < N_ACT; i++) {
    const k = ACTIVITY_KEYS[i]
    if (Math.abs(a.hours[k] - b.hours[k]) > EPS) {
      act.push({ i, hA: a.hours[k], hB: b.hours[k], min: ACTIVITIES[k].min, fatigue: ACTIVITIES[k].fatigue })
    }
  }
  const xA = equivalizedConsumption(goodsConsumption(a), a.householdSize) / C_REF
  const xB = equivalizedConsumption(goodsConsumption(b), b.householdSize) / C_REF
  const spend: CompiledDiff['spend'] = []
  const pairs: [number, number, number, number][] = [
    [P_AEXP, a.spend.experience, b.spend.experience, SPEND_SCALES[0]],
    [P_AGOODS, a.spend.goods, b.spend.goods, SPEND_SCALES[1]],
    [P_ASOCIAL, a.spend.social, b.spend.social, SPEND_SCALES[2]],
  ]
  for (const [p, va, vb, scale] of pairs) if (Math.abs(va - vb) > EPS) spend.push({ p, xA: va, xB: vb, scale })
  const workDiffers = Math.abs(a.workHours - b.workHours) > EPS || Math.abs(a.jobJoyShift - b.jobJoyShift) > EPS
  return {
    act,
    cons: Math.abs(xA - xB) > EPS ? [xA, xB] : null,
    spend,
    sec: Math.abs(a.assetsMonths - b.assetsMonths) > EPS ? [a.assetsMonths, b.assetsMonths] : null,
    work: workDiffers ? { hA: a.workHours, hB: b.workHours, shiftA: a.jobJoyShift, shiftB: b.jobJoyShift } : null,
    commute: a.commuteHours - b.commuteHours,
    constant: fixedUtility(a) - fixedUtility(b),
  }
}

/** θ（offset o から）での ΔU = U(A) − U(B) */
export function evalDiff(theta: ArrayLike<number>, o: number, d: CompiledDiff): number {
  let du = 0
  for (const t of d.act) {
    const w = theta[o + P_W + t.i]
    const S = theta[o + P_S + t.i]
    du += activityUtility(w, S, t.fatigue, t.hA, t.min) - activityUtility(w, S, t.fatigue, t.hB, t.min)
  }
  if (d.cons) {
    const eta = theta[o + P_ETA]
    du += theta[o + P_BETA] * (crra(d.cons[0], eta) - crra(d.cons[1], eta))
  }
  for (const s of d.spend) du += spendBonus(theta[o + s.p], s.xA, s.scale) - spendBonus(theta[o + s.p], s.xB, s.scale)
  if (d.sec) {
    const w = theta[o + P_SECMAX]
    const m = theta[o + P_SECM]
    du += securityUtility(w, m, d.sec[0]) - securityUtility(w, m, d.sec[1])
  }
  if (d.work) {
    const joy = theta[o + P_WORKJOY]
    const ov = theta[o + P_OVERWORK]
    du += workUtility(joy + d.work.shiftA, ov, d.work.hA) - workUtility(joy + d.work.shiftB, ov, d.work.hB)
  }
  if (d.commute !== 0) du -= theta[o + P_COMMUTE] * d.commute
  return du + d.constant
}

/** A と B で違う項目の数（質問の複雑さの目安） */
export function diffComplexity(d: CompiledDiff): number {
  return d.act.length + (d.cons ? 1 : 0) + d.spend.length + (d.sec ? 1 : 0) + (d.work ? 1 : 0) + (d.commute !== 0 ? 1 : 0)
}
