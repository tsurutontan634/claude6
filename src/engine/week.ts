// 1週間の最適配分
//
// 時間：各活動の効用は凹（逓減）なので、0.25時間ずつ「いま一番効用が増える活動」に足していく
//       貪欲法で最適解になる（限界効用均等の法則＝ゴッセンの第2法則）。
//       パラメータの不確実性は、事後分布から引いた粒子で効用を平均して扱う（期待効用最大化）。
// お金：自由に使えるお金を、体験・モノ・人のための支出の上乗せ効果が均等になるよう配分し、
//       「時間を買う」支出は家事時間を減らして自由時間に回す効果で評価する。

import type { ActivityKey, Hours, Spend, WeekState } from './types'
import { ACTIVITY_KEYS } from './types'
import {
  ACTIVITIES,
  N_ACT,
  N_PARAMS,
  P_AEXP,
  P_AGOODS,
  P_ASOCIAL,
  P_S,
  P_W,
  SPEND_SCALES,
  soloPenalty,
  utility,
} from './model'

export const TIME_STEP = 0.25

export interface TimeLimits {
  min: Record<ActivityKey, number>
  max: Record<ActivityKey, number>
}

export function defaultLimits(): TimeLimits {
  const min = {} as Record<ActivityKey, number>
  const max = {} as Record<ActivityKey, number>
  for (const k of ACTIVITY_KEYS) {
    min[k] = ACTIVITIES[k].min
    max[k] = ACTIVITIES[k].max
  }
  return { min, max }
}

/**
 * 自由時間 T ごとの「最適配分したときの期待効用」表。
 * 貪欲法の途中経過をそのまま記録すると、0〜Tmax のすべての T について最適値が一度に得られる。
 */
export interface TimeValueTable {
  /** 最小時間の合計（これ未満の自由時間は不可能） */
  base: number
  step: number
  /** value[i] = 自由時間 base + i·step のときの期待効用（活動の効用の合計） */
  value: Float64Array
  /** alloc[i*N_ACT + a] = そのときの活動 a の時間 */
  alloc: Float32Array
}

/** 活動 a を h から h+δ に増やしたときの期待効用増分（粒子平均） */
function expectedIncrement(thetas: Float64Array, k: number, a: number, h: number, delta: number, minH: number, fatigue: number): number {
  const x0 = Math.max(0, h - minH)
  const x1 = Math.max(0, h + delta - minH)
  let s = 0
  for (let j = 0; j < k; j++) {
    const o = j * N_PARAMS
    const w = thetas[o + P_W + a]
    const S = thetas[o + P_S + a]
    s += w * S * (Math.exp(-x0 / S) - Math.exp(-x1 / S))
  }
  return s / k - fatigue * (x1 - x0)
}

export function buildTimeValueTable(thetas: Float64Array, maxFree: number, limits: TimeLimits = defaultLimits()): TimeValueTable {
  const k = thetas.length / N_PARAMS
  const h = new Float64Array(N_ACT)
  let base = 0
  for (let a = 0; a < N_ACT; a++) {
    h[a] = limits.min[ACTIVITY_KEYS[a]]
    base += h[a]
  }
  let capacity = 0
  for (let a = 0; a < N_ACT; a++) capacity += limits.max[ACTIVITY_KEYS[a]] - limits.min[ACTIVITY_KEYS[a]]
  const steps = Math.max(0, Math.ceil(Math.min(maxFree - base, capacity) / TIME_STEP))
  const value = new Float64Array(steps + 1)
  const alloc = new Float32Array((steps + 1) * N_ACT)
  // 活動そのものの増分（粒子平均）。休息・趣味には「一人の受け身の時間」の上限ペナルティが別途かかる
  const own = new Float64Array(N_ACT)
  const fat = ACTIVITY_KEYS.map((key) => ACTIVITIES[key].fatigue)
  const mins = ACTIVITY_KEYS.map((key) => limits.min[key])
  const maxs = ACTIVITY_KEYS.map((key) => limits.max[key])
  const iRest = ACTIVITY_KEYS.indexOf('rest')
  const iHobby = ACTIVITY_KEYS.indexOf('hobby')
  const refresh = (a: number) => {
    own[a] = h[a] + TIME_STEP <= maxs[a] + 1e-9 ? expectedIncrement(thetas, k, a, h[a], TIME_STEP, mins[a], fat[a]) : -Infinity
  }
  const soloInc = () => soloPenalty(h[iRest] + TIME_STEP, h[iHobby]) - soloPenalty(h[iRest], h[iHobby])
  for (let a = 0; a < N_ACT; a++) {
    refresh(a)
    alloc[a] = h[a]
  }
  let v = soloPenalty(h[iRest], h[iHobby])
  value[0] = v
  for (let i = 1; i <= steps; i++) {
    let best = -1
    let bestInc = -Infinity
    const solo = soloInc()
    for (let a = 0; a < N_ACT; a++) {
      const inc = a === iRest || a === iHobby ? own[a] + solo : own[a]
      if (inc > bestInc) {
        bestInc = inc
        best = a
      }
    }
    if (best < 0 || bestInc === -Infinity) {
      // すべての活動が上限に達した（それ以上の時間は価値を生まない）
      value[i] = v
      for (let a = 0; a < N_ACT; a++) alloc[i * N_ACT + a] = h[a]
      continue
    }
    h[best] += TIME_STEP
    v += bestInc
    refresh(best)
    value[i] = v
    for (let a = 0; a < N_ACT; a++) alloc[i * N_ACT + a] = h[a]
  }
  return { base, step: TIME_STEP, value, alloc }
}

/** 表から自由時間 T の最適値（線形補間）。最小時間に満たない場合は大きなペナルティ */
export function timeValue(t: TimeValueTable, free: number): number {
  const x = (free - t.base) / t.step
  if (x < 0) return x * t.step * 0.5 // 1時間不足ごとに 0.5点（睡眠などを削る強いペナルティ）
  const last = t.value.length - 1
  if (x >= last) return t.value[last]
  const i = Math.floor(x)
  const f = x - i
  return t.value[i] * (1 - f) + t.value[i + 1] * f
}

export function timeAlloc(t: TimeValueTable, free: number): Hours {
  const last = t.value.length - 1
  const i = Math.max(0, Math.min(last, Math.round((free - t.base) / t.step)))
  const out = {} as Hours
  for (let a = 0; a < N_ACT; a++) out[ACTIVITY_KEYS[a]] = t.alloc[i * N_ACT + a]
  return out
}

/** 粒子平均の支出上乗せ係数 */
export function meanSpendAlphas(thetas: Float64Array): [number, number, number] {
  const k = thetas.length / N_PARAMS
  let e = 0
  let g = 0
  let s = 0
  for (let j = 0; j < k; j++) {
    const o = j * N_PARAMS
    e += thetas[o + P_AEXP]
    g += thetas[o + P_AGOODS]
    s += thetas[o + P_ASOCIAL]
  }
  return [e / k, g / k, s / k]
}

/**
 * Σ A_k (1 − e^{−x_k/X_k}) を Σ x_k = D の下で最大化（限界効用を揃える水位合わせ）。
 * 一階条件 (A_k/X_k)·e^{−x_k/X_k} = μ より x_k = X_k·ln(A_k/(X_k μ))（正のときのみ）。
 * Σ x_k(μ) は μ について単調減少なので、log μ を二分探索する。
 */
export function allocateSpendBonus(alphas: [number, number, number], D: number): [number, number, number] {
  if (D <= 0) return [0, 0, 0]
  const xsAt = (logMu: number): [number, number, number] => {
    const mu = Math.exp(logMu)
    const out: [number, number, number] = [0, 0, 0]
    for (let k = 0; k < 3; k++) {
      const X = SPEND_SCALES[k]
      const r = alphas[k] / (X * mu)
      out[k] = r > 1 ? X * Math.log(r) : 0
    }
    return out
  }
  let lo = -60
  let hi = 10
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2
    const xs = xsAt(mid)
    if (xs[0] + xs[1] + xs[2] > D) lo = mid
    else hi = mid
  }
  const xs = xsAt(hi)
  // 端数を合計 D に合わせる
  const sum = xs[0] + xs[1] + xs[2]
  if (sum > 0) for (let k = 0; k < 3; k++) xs[k] *= D / sum
  else xs[0] = D
  return xs
}

export function spendBonusValue(alphas: [number, number, number], xs: [number, number, number]): number {
  let v = 0
  for (let k = 0; k < 3; k++) v += alphas[k] * (1 - Math.exp(-Math.max(0, xs[k]) / SPEND_SCALES[k]))
  return v
}

export interface TimeBuyOptions {
  /** 家事代行などで1時間を買う価格（円） */
  yenPerHour: number
  /** 家事のうち外注・時短できる最大割合 */
  maxShare: number
}

export interface MoneyTimeResult {
  timeBuy: number
  freedHours: number
  spend: Spend
  timeUtility: number
  spendUtility: number
}

/**
 * 自由に使えるお金 D と自由時間 free（家事外注前）を所与に、
 * 「時間を買う」支出額を探索して、時間＋支出上乗せの期待効用を最大化する。
 */
export function optimizeMoneyTime(
  table: TimeValueTable,
  alphas: [number, number, number],
  D: number,
  free: number,
  housework: number,
  opt: TimeBuyOptions,
): MoneyTimeResult {
  const maxFreed = housework * opt.maxShare
  const maxSpend = Math.min(Math.max(0, D), maxFreed * opt.yenPerHour * 4.345)
  const stepYen = 5000
  let best: MoneyTimeResult | null = null
  for (let x = 0; x <= maxSpend + 1e-6; x += stepYen) {
    const freed = Math.min(maxFreed, x / 4.345 / opt.yenPerHour)
    const tv = timeValue(table, free + freed)
    const xs = allocateSpendBonus(alphas, D - x)
    const sv = spendBonusValue(alphas, xs)
    if (!best || tv + sv > best.timeUtility + best.spendUtility) {
      best = {
        timeBuy: x,
        freedHours: freed,
        spend: { experience: xs[0], goods: xs[1], social: xs[2], timeBuy: x },
        timeUtility: tv,
        spendUtility: sv,
      }
    }
  }
  return best!
}

/** 粒子平均の期待効用 */
export function expectedUtility(thetas: Float64Array, s: WeekState): number {
  const k = thetas.length / N_PARAMS
  let u = 0
  for (let j = 0; j < k; j++) u += utility(thetas, s, j * N_PARAMS)
  return u / k
}

/** 各粒子での効用（分布の表示用） */
export function utilitySamples(thetas: Float64Array, s: WeekState): Float64Array {
  const k = thetas.length / N_PARAMS
  const out = new Float64Array(k)
  for (let j = 0; j < k; j++) out[j] = utility(thetas, s, j * N_PARAMS)
  return out
}
