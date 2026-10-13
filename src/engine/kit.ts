// 事後分布の粒子から作る「効用の早見表」
// 生涯シミュレーションでは 何十年 × 何十通りの消費額 × 何十通りのプラン で効用を評価するので、
// 粒子平均を毎回計算せず、1次元の表にしておいて補間する。

import { PRIORS } from './priors'
import {
  C_REF,
  N_PARAMS,
  OVERWORK_FROM,
  P_BETA,
  P_COMMUTE,
  P_ETA,
  P_OVERWORK,
  P_SECM,
  P_SECMAX,
  P_WORKJOY,
  crra,
  employmentBenefit,
  houseworkUtility,
} from './model'
import {
  allocateSpendBonus,
  buildTimeValueTable,
  meanSpendAlphas,
  spendBonusValue,
  timeAlloc,
  timeValue,
  type TimeLimits,
  type TimeValueTable,
} from './week'
import type { Hours, Spend } from './types'

const CU_LN_MIN = Math.log(0.002)
const CU_LN_MAX = Math.log(60)
const CU_N = 600
const SEC_MAX_MONTHS = 600
const SEC_STEP = 0.25
const SB_STEP = 2500
const SB_MAX = 3_000_000

export interface WeekInputs {
  /** 家事の外注前の自由時間（時間/週） */
  free: number
  housework: number
  /** 世帯の月間消費 */
  consumption: number
  necessities: number
  householdSize: number
  workHours: number
  commuteHours: number
  assetsMonths: number
  jobJoyShift: number
}

export interface WeekOutcome {
  utility: number
  /** 自由時間の使い方（活動の効用＋家事の負担） */
  timeUtility: number
  spendUtility: number
  moneyUtility: number
  securityUtility: number
  workUtility: number
  commuteUtility: number
  hours: Hours
  spend: Spend
  freedHours: number
}

export class UtilityKit {
  readonly k: number
  readonly table: TimeValueTable
  readonly alphas: [number, number, number]
  readonly joy: number
  readonly overwork: number
  readonly commute: number
  private cu: Float64Array
  private sec: Float64Array
  private sb: Float64Array
  readonly yenPerHour: number
  readonly maxShare: number

  constructor(readonly thetas: Float64Array, limits: TimeLimits) {
    const k = (this.k = thetas.length / N_PARAMS)
    this.table = buildTimeValueTable(thetas, 168, limits)
    this.alphas = meanSpendAlphas(thetas)
    let joy = 0
    let ov = 0
    let cm = 0
    for (let j = 0; j < k; j++) {
      const o = j * N_PARAMS
      joy += thetas[o + P_WORKJOY]
      ov += thetas[o + P_OVERWORK]
      cm += thetas[o + P_COMMUTE]
    }
    this.joy = joy / k
    this.overwork = ov / k
    this.commute = cm / k
    // 消費の効用 E[β·crra(x, η)]（x = 等価消費/C_REF、対数等間隔）
    this.cu = new Float64Array(CU_N)
    for (let i = 0; i < CU_N; i++) {
      const x = Math.exp(CU_LN_MIN + ((CU_LN_MAX - CU_LN_MIN) * i) / (CU_N - 1))
      let s = 0
      for (let j = 0; j < k; j++) {
        const o = j * N_PARAMS
        s += thetas[o + P_BETA] * crra(x, thetas[o + P_ETA])
      }
      this.cu[i] = s / k
    }
    // 安心感 E[secMax·(1 − e^{−m/secM})]
    const nSec = Math.round(SEC_MAX_MONTHS / SEC_STEP) + 1
    this.sec = new Float64Array(nSec)
    for (let i = 0; i < nSec; i++) {
      const m = i * SEC_STEP
      let s = 0
      for (let j = 0; j < k; j++) {
        const o = j * N_PARAMS
        s += thetas[o + P_SECMAX] * (1 - Math.exp(-m / thetas[o + P_SECM]))
      }
      this.sec[i] = s / k
    }
    // 自由に使えるお金 D を最適に配分したときの上乗せ効果
    const nSb = Math.round(SB_MAX / SB_STEP) + 1
    this.sb = new Float64Array(nSb)
    for (let i = 0; i < nSb; i++) this.sb[i] = spendBonusValue(this.alphas, allocateSpendBonus(this.alphas, i * SB_STEP))
    this.yenPerHour = PRIORS.spend.timeBuyYenPerHour
    this.maxShare = PRIORS.spend.timeBuyMaxShare
  }

  consumptionUtility(consumption: number, householdSize: number): number {
    const x = consumption / Math.sqrt(Math.max(1, householdSize)) / C_REF
    if (x <= 0) return this.cu[0] - 5
    const lx = Math.log(x)
    if (lx <= CU_LN_MIN) {
      // 表の範囲より下：傾きで外挿（強い不効用）
      const slope = (this.cu[1] - this.cu[0]) / ((CU_LN_MAX - CU_LN_MIN) / (CU_N - 1))
      return this.cu[0] + slope * (lx - CU_LN_MIN) * 1.5
    }
    const f = ((lx - CU_LN_MIN) / (CU_LN_MAX - CU_LN_MIN)) * (CU_N - 1)
    if (f >= CU_N - 1) return this.cu[CU_N - 1]
    const i = Math.floor(f)
    const t = f - i
    return this.cu[i] * (1 - t) + this.cu[i + 1] * t
  }

  securityUtility(months: number): number {
    if (months <= 0) return 0
    const f = months / SEC_STEP
    if (f >= this.sec.length - 1) return this.sec[this.sec.length - 1]
    const i = Math.floor(f)
    const t = f - i
    return this.sec[i] * (1 - t) + this.sec[i + 1] * t
  }

  spendBonus(D: number): number {
    if (D <= 0) return 0
    const f = D / SB_STEP
    if (f >= this.sb.length - 1) return this.sb[this.sb.length - 1]
    const i = Math.floor(f)
    const t = f - i
    return this.sb[i] * (1 - t) + this.sb[i + 1] * t
  }

  workUtility(hours: number, jobJoyShift: number): number {
    const over = Math.max(0, hours - OVERWORK_FROM)
    return (this.joy + jobJoyShift) * hours - this.overwork * over * over + employmentBenefit(hours)
  }

  /** 時間を買う額を探索して、その週の期待効用を返す（配分の詳細は detail=true のときだけ作る） */
  week(inp: WeekInputs, detail = false): WeekOutcome {
    const D = Math.max(0, inp.consumption - inp.necessities)
    const maxFreed = Math.max(0, inp.housework * this.maxShare)
    const maxSpend = Math.min(D, maxFreed * this.yenPerHour * (52.14 / 12))
    let bestX = 0
    let bestV = -Infinity
    let bestTV = 0
    let bestSB = 0
    let bestCU = 0
    const step = maxSpend > 100_000 ? 10_000 : 5_000
    for (let x = 0; x <= maxSpend + 1e-6; x += step) {
      const freed = Math.min(maxFreed, x / (52.14 / 12) / this.yenPerHour)
      const tv = timeValue(this.table, inp.free + freed) + houseworkUtility(inp.housework - freed)
      const sb = this.spendBonus(D - x)
      // 時間を買う支出は消費の満足には数えない（浮いた時間の側で評価する）
      const cu = this.consumptionUtility(inp.consumption - x, inp.householdSize)
      if (tv + sb + cu > bestV) {
        bestV = tv + sb + cu
        bestX = x
        bestTV = tv
        bestSB = sb
        bestCU = cu
      }
    }
    const money = bestCU
    const security = this.securityUtility(inp.assetsMonths)
    const work = this.workUtility(inp.workHours, inp.jobJoyShift)
    const commute = -this.commute * inp.commuteHours
    const freedHours = Math.min(maxFreed, bestX / (52.14 / 12) / this.yenPerHour)
    let hours = {} as Hours
    let spend = { experience: 0, goods: 0, social: 0, timeBuy: bestX } as Spend
    if (detail) {
      hours = timeAlloc(this.table, inp.free + freedHours)
      const xs = allocateSpendBonus(this.alphas, D - bestX)
      spend = { experience: xs[0], goods: xs[1], social: xs[2], timeBuy: bestX }
    }
    return {
      utility: bestTV + bestSB + money + security + work + commute,
      timeUtility: bestTV,
      spendUtility: bestSB,
      moneyUtility: money,
      securityUtility: security,
      workUtility: work,
      commuteUtility: commute,
      hours,
      spend,
      freedHours,
    }
  }
}
