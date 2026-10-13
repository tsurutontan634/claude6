// 生涯シミュレーション（年単位）
//
// 1年ごとに：年齢 → 世帯（パートナー・子ども）→ 労働時間 → 収入・年金・教育費 → 自由時間
// そのうえで「毎年いくら使い、いくら貯めるか」を動的計画法（後ろ向き帰納法）で最適化する。
//   V_t(A) = max_C { U_t(A, C) + δ·(S_{t+1}/S_t)·V_{t+1}(A') }
//   A' = (A + 年間手取り − 12·C − 教育費)·(1 + r)、A' ≥ 0（借金はしない）
//   U_t = その年の「1週間」の期待効用（時間配分・お金の使い道を最適化した値）＋ 貯金の安心感 ＋ ライフイベント
// 金額はすべて実質（今の物価）で計算する。

import type { JobOption, Profile } from './types'
import { UtilityKit } from './kit'
import {
  caregivingHours,
  commuteAtHours,
  consumptionFloor,
  currentJob,
  currentLife,
  grossAtHours,
  hasFamilyAt,
  householdAt,
  householdNetAnnual,
  jobJoyShift,
  limitsFor,
  necessitiesAt,
  type HouseholdYear,
} from './household'
import { JP_RULES, pensionTakeHome, publicPension, takeHome } from './tax'
import { cumulativeHazard, longHoursExcessHazard, wageMultiplier } from './data'
import { PRIORS } from './priors'
import type { Hours, Spend } from './types'
import { ACTIVITY_KEYS } from './types'
import { C_REF, N_PARAMS, P_S, P_W } from './model'

export interface LifeAssumptions {
  /** 実質運用利回り */
  realReturn: number
  /** 実質賃金上昇率（年齢カーブとは別の全体的な上昇） */
  realWageGrowth: number
  /** 純粋な時間選好率（将来の幸せをどれだけ割り引くか） */
  discount: number
  /** 年金の実質的な目減り（1 = 今の水準のまま） */
  pensionFactor: number
  /** シミュレーションの最終年齢 */
  maxAge: number
  /** 退職金（手取り、円） */
  retirementBonus: number
  /** 年功賃金カーブの急さ（1 = 統計どおり、0 = 年齢で変わらない） */
  careerSteepness: number
}

export const DEFAULT_ASSUMPTIONS: LifeAssumptions = {
  realReturn: 0.02,
  realWageGrowth: 0.005,
  discount: 0.01,
  pensionFactor: 0.85,
  maxAge: 100,
  retirementBonus: 0,
  careerSteepness: 1,
}

export interface Stage {
  /** この年齢から */
  from: number
  /** 週の労働時間 */
  hours: number
}

export interface LifePolicy {
  id: string
  name: string
  description: string
  stages: Stage[]
  retireAge: number
  jobId: string
  /** optimal: 消費・貯蓄を最適化 / current: 引退まで今の貯蓄率を続ける */
  saving: 'optimal' | 'current'
}

export interface LifeYear {
  age: number
  /** 今の年齢から見て、その年齢まで生きている確率 */
  survival: number
  workHours: number
  commuteHours: number
  freeHours: number
  childcareHours: number
  householdSize: number
  partner: boolean
  childAges: number[]
  /** 額面（自分） */
  gross: number
  /** 世帯の手取り年収（給与＋年金＋児童手当、退職金を含む） */
  income: number
  pension: number
  education: number
  /** 世帯の月間消費 */
  consumption: number
  /** 年初の資産 */
  assets: number
  saving: number
  /** その年の期待効用（点） */
  utility: number
  eventUtility: number
  hours: Hours
  spend: Spend
}

export interface LifeResult {
  policy: LifePolicy
  years: LifeYear[]
  /** 生涯の平均効用（割引・生存確率で重み付け、点） */
  score: number
  assetsAtRetire: number
  minAssets: number
  /** 資金が尽きて生活費を切り詰めた年数 */
  shortfallYears: number
}

interface YearInputs {
  age: number
  surv: number
  hh: HouseholdYear
  hours: number
  commute: number
  free: number
  gross: number
  /** 手取り年収（世帯） */
  income: number
  pension: number
  education: number
  necessities: number
  event: number
  jobShift: number
  kit: UtilityKit
}

function stageHours(policy: LifePolicy, age: number): number {
  if (age >= policy.retireAge) return 0
  let h = policy.stages[0]?.hours ?? 0
  for (const s of policy.stages) if (age >= s.from) h = s.hours
  return h
}

export { caregivingHours }

/** 結婚・子ども・育児・介護・引退による、時間とお金以外の満足度の変化（点） */
export function lifeEvents(p: Profile, policy: LifePolicy, age: number, hh: HouseholdYear): number {
  const L = PRIORS.life
  let u = 0
  // 結婚・同居
  if (p.hasPartner) {
    u += L.marriageLong
  } else if (p.partnerPlanAge !== null) {
    const t = age - p.partnerPlanAge
    if (t === -1) u += L.marriageAnticipation
    if (t >= 0) u += L.marriageLong + (L.marriagePeak - L.marriageLong) * Math.exp(-t / L.marriageAdaptYears)
  }
  // 子ども：意味・喜び（第2子以降は半分）と、出産前後の一時的な上昇
  const order = [...p.children].sort((a, b) => a.parentAgeAtBirth - b.parentAgeAtBirth)
  order.forEach((c, i) => {
    const t = age - c.parentAgeAtBirth
    const peak = L.birthPeak[i] ?? 0
    const ant = L.birthAnticipation[i] ?? 0
    if (t === -1) u += ant
    if (t >= 0) {
      u += L.childMeaning * (i === 0 ? 1 : 0.5)
      u += peak * Math.exp(-t / L.birthAdaptYears)
    }
  })
  // 育児：少し楽しいが、1人で抱えすぎると疲労
  u += L.childcarePerHour * hh.childcareMine - L.childcareFatigue * Math.max(0, hh.childcareMine - L.childcareFatigueFrom)
  // 介護
  const care = caregivingHours(p, age)
  if (care > 0) u += care >= 20 ? L.caregivingHeavy : care < 10 ? L.caregivingLight : L.caregivingLight + ((care - 10) / 10) * (L.caregivingHeavy - L.caregivingLight)
  // 引退後：仕事の所属感は失われる（週の効用の側で自動的に 0 になる）。
  // 60歳より前に働いていない間は、周囲の規範とのずれなどで少し下がる
  if (age >= policy.retireAge) {
    u += age < L.normalRetireAge ? L.earlyNonwork : L.retirementVoluntary
  }
  return u
}

/**
 * 家賃・食費などの必需的支出を下回る暮らしの不効用（点）。
 * 消費の効用は CRRA だけだと「必需品が買えない」ことの重さを表せないので、下回った比率の対数に比例して下げる。
 * これがあると、長生きしたときに生活費が足りなくならないよう先を見越して備える。
 */
export const NEED_PENALTY = 1.0
function needPenalty(C: number, necessities: number): number {
  return C < necessities ? NEED_PENALTY * Math.log(necessities / Math.max(1, C)) : 0
}

/** 資金が尽きて借金になる額への罰則（借金を消費の基準額の何年分かで点数化） */
function shortfallPenalty(deficit: number): number {
  return deficit > 0 ? deficit / (12 * C_REF) : 0
}

export interface OptimizeOptions {
  hoursChoices?: number[]
  retireChoices?: number[]
  sweeps?: number
  onProgress?: (f: number) => void
}

export class LifeSimulator {
  private kits = new Map<string, UtilityKit>()
  readonly startAge: number
  readonly job: JobOption

  /** 外注する前の家事時間（時間/週） */
  readonly housework: number

  constructor(
    readonly profile: Profile,
    readonly thetas: Float64Array,
    readonly assumptions: LifeAssumptions = DEFAULT_ASSUMPTIONS,
  ) {
    this.startAge = profile.age
    this.job = currentJob(profile)
    this.housework = currentLife(profile).grossHousework
  }

  kitFor(age: number): { kit: UtilityKit; key: string } {
    const limits = limitsFor(this.profile, age)
    const fam = hasFamilyAt(this.profile, age)
    const famNow = hasFamilyAt(this.profile, this.startAge)
    const key = `${limits.max.family}-${fam}`
    let kit = this.kits.get(key)
    if (!kit) {
      let thetas = this.thetas
      if (fam !== famNow) {
        // 一人暮らし ⇔ パートナー・子どもがいる時期で「家族と過ごす時間」の価値を切り替える
        thetas = Float64Array.from(this.thetas)
        const i = ACTIVITY_KEYS.indexOf('family')
        const fw = fam ? 1 / PRIORS.fixed.familySingleW : PRIORS.fixed.familySingleW
        const fs = fam ? 1 / PRIORS.fixed.familySingleS : PRIORS.fixed.familySingleS
        for (let o = 0; o < thetas.length; o += N_PARAMS) {
          thetas[o + P_W + i] *= fw
          thetas[o + P_S + i] *= fs
        }
      }
      kit = new UtilityKit(thetas, limits)
      this.kits.set(key, kit)
    }
    return { kit, key }
  }

  private jobOf(policy: LifePolicy): JobOption {
    return this.profile.jobs.find((j) => j.id === policy.jobId) ?? this.job
  }

  /** 年ごとの外生的な入力（労働・収入・世帯）を作る */
  private inputs(policy: LifePolicy): YearInputs[] {
    const p = this.profile
    const A = this.assumptions
    const job = this.jobOf(policy)
    const shift = jobJoyShift(job, this.job)
    const out: YearInputs[] = []
    // 年金計算用：過去の厚生年金加入（22歳から今まで（70歳未満）、今の仕事の年収を年齢カーブで割り戻す。上限つき）
    let pensionYears = 0
    let pensionGrossSum = 0
    for (let a = 22; a < Math.min(p.age, 70); a++) {
      pensionYears++
      pensionGrossSum += Math.min(JP_RULES.pensionCap, this.job.annualIncome / wageMultiplier(a, p.age, p.sex, 0, A.careerSteepness))
    }
    const partnerPension = p.partnerIncome > 0 ? publicPension(Math.min(p.partnerIncome, JP_RULES.pensionCap), 40, 40) * A.pensionFactor : JP_RULES.basicPensionFull * A.pensionFactor
    const life = currentLife(p)
    const unlisted = life.unlisted
    const housework = life.grossHousework
    // すでに年金を受け取っているなら、その額をそのまま使う
    let ownPension = p.pensionNow > 0 ? p.pensionNow : 0
    const pensionStart = Math.max(p.age, p.pensionAge)
    // 生存確率：長時間労働の年が多いほど、45歳以降の死亡リスクを少し上乗せする
    let surv = 1
    let excessSum = 0
    let workedYears = 0
    for (let age = p.age; age <= A.maxAge; age++) {
      if (age > p.age) {
        const mult = age >= 45 && workedYears > 0 ? 1 + excessSum / workedYears : 1
        surv *= Math.exp(-mult * (cumulativeHazard(age, p.sex) - cumulativeHazard(age - 1, p.sex)))
      }
      const hh = householdAt(p, age)
      const hours = stageHours(policy, age)
      const commute = hours > 0 ? commuteAtHours(job, hours) : 0
      const gross = hours > 0 ? grossAtHours(job, hours) * wageMultiplier(p.age, age, p.sex, A.realWageGrowth, A.careerSteepness) : 0
      if (hours > 0 && age < 70) {
        pensionYears++
        pensionGrossSum += Math.min(JP_RULES.pensionCap, gross)
      }
      if (hours > 0) {
        workedYears++
        excessSum += longHoursExcessHazard(hours)
      }
      // 受給開始の年から（受給中に働いて厚生年金に入っていれば、毎年計算し直す：在職定時改定）
      if (p.pensionNow <= 0 && age >= pensionStart && (age === pensionStart || (hours > 0 && age < 70))) {
        const avg = pensionYears > 0 ? pensionGrossSum / pensionYears : 0
        ownPension = publicPension(avg, pensionYears, 40, p.pensionAge) * A.pensionFactor
      }
      const pension = age >= pensionStart || p.pensionNow > 0 ? ownPension : 0
      let income = takeHome(gross, age).net + pensionTakeHome(pension, age) + Math.max(0, p.otherIncome)
      // パートナー（同い年と仮定）：65歳までは給与（実質賃金上昇つき）、その後は年金
      const partnerEmployed = hh.partner && age < 65 && p.partnerIncome > 0
      if (hh.partner) {
        income += partnerEmployed
          ? takeHome(p.partnerIncome * Math.pow(1 + A.realWageGrowth, age - p.age), age).net
          : age >= 65
            ? pensionTakeHome(partnerPension, age)
            : 0
      }
      income += hh.allowance * 12
      if (age === policy.retireAge) income += A.retirementBonus
      // 60歳未満で働いていない年は国民年金・国民健康保険の保険料がかかる
      // （会社員のパートナーの扶養に入れる場合はかからない：第3号被保険者）
      if (hours === 0 && age < 60 && !(partnerEmployed && p.partnerIncome >= 1_060_000)) income -= 300_000
      const free = 168 - hours - commute - housework - p.personalCare - hh.childcareMine - p.otherDuties - caregivingHours(p, age) - unlisted
      const { kit } = this.kitFor(age)
      out.push({
        age,
        surv,
        hh,
        hours,
        commute,
        free,
        gross,
        income,
        pension,
        education: hh.education,
        necessities: necessitiesAt(p, hh.size),
        event: lifeEvents(p, policy, age, hh),
        jobShift: shift,
        kit,
      })
    }
    return out
  }

  /** その年の週の効用（消費 C、資産 A のとき） */
  private yearUtility(y: YearInputs, C: number, assets: number, detail = false) {
    const w = y.kit.week(
      {
        free: y.free,
        housework: this.housework,
        consumption: C,
        necessities: y.necessities,
        householdSize: y.hh.size,
        workHours: y.hours,
        commuteHours: y.commute,
        assetsMonths: C > 0 ? assets / C : 0,
        jobJoyShift: y.jobShift,
      },
      detail,
    )
    return w
  }

  simulate(policy: LifePolicy): LifeResult {
    const p = this.profile
    const A = this.assumptions
    const ys = this.inputs(policy)
    const T = ys.length
    const r = A.realReturn
    const delta = 1 / (1 + A.discount)

    // 資産グリッド（小さい額を細かく）
    // 一度も使わずに全部ためた場合の上限（運用益込み）
    let upper = Math.max(p.savings, 1) * Math.pow(1 + Math.max(r, 0), T)
    ys.forEach((y, t) => {
      upper += Math.max(0, y.income) * Math.pow(1 + Math.max(r, 0), T - t)
    })
    upper = Math.min(Math.max(upper, 50_000_000), 10_000_000_000)
    const NA = 110
    const grid = new Float64Array(NA)
    for (let i = 0; i < NA; i++) grid[i] = upper * (i / (NA - 1)) ** 2
    const gridIndex = (a: number) => Math.sqrt(Math.max(0, a) / upper) * (NA - 1)

    // 各年の「消費 → 週の効用」表（対数等間隔）
    const NC = 70
    const cLo = 40_000
    let cHi = 300_000
    for (const y of ys) cHi = Math.max(cHi, (y.income / 12) * 2.5)
    cHi = Math.max(cHi, (upper / 12 / 10) * 1.0)
    cHi = Math.min(cHi, 20_000_000)
    const lnLo = Math.log(cLo)
    const lnHi = Math.log(cHi)
    const W: Float64Array[] = ys.map((y) => {
      const arr = new Float64Array(NC)
      for (let i = 0; i < NC; i++) {
        const C = Math.exp(lnLo + ((lnHi - lnLo) * i) / (NC - 1))
        // 安心感は資産に依存するので別に足す（ここでは assets=0）
        arr[i] = this.yearUtility(y, C, 0).utility
      }
      return arr
    })
    const Wat = (t: number, C: number) => {
      const lc = Math.log(Math.max(C, 1))
      if (lc <= lnLo) {
        const slope = (W[t][1] - W[t][0]) / ((lnHi - lnLo) / (NC - 1))
        return W[t][0] + slope * (lc - lnLo) * 1.5
      }
      const f = ((lc - lnLo) / (lnHi - lnLo)) * (NC - 1)
      if (f >= NC - 1) return W[t][NC - 1]
      const i = Math.floor(f)
      const u = f - i
      return W[t][i] * (1 - u) + W[t][i + 1] * u
    }
    const periodU = (t: number, C: number, assets: number) =>
      Wat(t, C) + ys[t].kit.securityUtility(C > 0 ? assets / C : 0) + ys[t].event - needPenalty(C, ys[t].necessities)

    // 後ろ向き帰納法
    const V: Float64Array[] = new Array(T + 1)
    V[T] = new Float64Array(NA)
    const Vat = (t: number, a: number) => {
      const f = gridIndex(a)
      if (f >= NA - 1) return V[t][NA - 1]
      const i = Math.floor(f)
      const u = f - i
      return V[t][i] * (1 - u) + V[t][i + 1] * u
    }
    const choose = (t: number, a: number): { C: number; value: number; next: number; short: boolean } => {
      const y = ys[t]
      const cash = a + y.income - y.education
      const cont = t + 1 < T ? (delta * ys[t + 1].surv) / Math.max(1e-12, y.surv) : 0
      const floorC = consumptionFloor(y.necessities)
      const maxC = cash / 12
      if (maxC <= floorC) {
        // 資金不足：最低限の生活費で暮らし、不足分は「借金」としてペナルティ
        const C = floorC
        const deficit = 12 * C - cash
        return { C, value: periodU(t, C, a) - shortfallPenalty(deficit) + cont * Vat(t + 1, 0), next: 0, short: true }
      }
      const obj = (C: number) => periodU(t, C, a) + cont * Vat(t + 1, (cash - 12 * C) * (1 + r))
      // まず対数等間隔の16点で大まかに探し、いちばん良い点の両隣の区間で黄金分割探索（局所解を避ける）
      const NS = 16
      const lnF = Math.log(floorC)
      const lnM = Math.log(maxC)
      let bi = 0
      let bv = -Infinity
      const pts: number[] = []
      for (let i = 0; i < NS; i++) {
        const c = Math.exp(lnF + ((lnM - lnF) * i) / (NS - 1))
        pts.push(c)
        const v = obj(c)
        if (v > bv) {
          bv = v
          bi = i
        }
      }
      let lo = pts[Math.max(0, bi - 1)]
      let hi = pts[Math.min(NS - 1, bi + 1)]
      const g = 0.381966
      let x1 = lo + g * (hi - lo)
      let x2 = hi - g * (hi - lo)
      let f1 = obj(x1)
      let f2 = obj(x2)
      for (let it = 0; it < 20; it++) {
        if (f1 < f2) {
          lo = x1
          x1 = x2
          f1 = f2
          x2 = hi - g * (hi - lo)
          f2 = obj(x2)
        } else {
          hi = x2
          x2 = x1
          f2 = f1
          x1 = lo + g * (hi - lo)
          f1 = obj(x1)
        }
      }
      let C = (lo + hi) / 2
      let best = obj(C)
      if (bv > best) {
        best = bv
        C = pts[bi]
      }
      return { C, value: best, next: (cash - 12 * C) * (1 + r), short: false }
    }
    for (let t = T - 1; t >= 0; t--) {
      V[t] = new Float64Array(NA)
      for (let i = 0; i < NA; i++) V[t][i] = choose(t, grid[i]).value
    }

    // 前向きにたどる
    const years: LifeYear[] = []
    let assets = p.savings
    let num = 0
    let den = 0
    let assetsAtRetire = NaN
    let minAssets = Infinity
    let shortfallYears = 0
    const currentRate = this.currentSavingRate()
    for (let t = 0; t < T; t++) {
      const y = ys[t]
      let C: number
      let next: number
      let deficit = 0
      if (policy.saving === 'current' && y.age < policy.retireAge) {
        // 引退までは今の貯蓄率のまま（働いていない年も含む）
        const avail = y.income - y.education
        C = Math.max(consumptionFloor(y.necessities), (avail * (1 - currentRate)) / 12)
        const cash = assets + avail - 12 * C
        if (cash < 0) {
          deficit = -cash
          next = 0
        } else next = cash * (1 + r)
      } else {
        const c = choose(t, assets)
        C = c.C
        next = c.next
        if (c.short) deficit = 12 * C - (assets + y.income - y.education)
      }
      // 必需的支出をまかなえない年（資金が尽きた年を含む）
      if (deficit > 0 || C < y.necessities * 0.98) shortfallYears++
      const w = this.yearUtility(y, C, assets, true)
      const u = w.utility + y.event - shortfallPenalty(deficit) - needPenalty(C, y.necessities)
      const weight = Math.pow(delta, t) * y.surv
      num += weight * u
      den += weight
      if (y.age === policy.retireAge) assetsAtRetire = assets
      minAssets = Math.min(minAssets, assets)
      years.push({
        age: y.age,
        survival: y.surv,
        workHours: y.hours,
        commuteHours: y.commute,
        freeHours: y.free,
        childcareHours: y.hh.childcareMine,
        householdSize: y.hh.size,
        partner: y.hh.partner,
        childAges: y.hh.childAges,
        gross: y.gross,
        income: y.income,
        pension: y.pension,
        education: y.education,
        consumption: C,
        assets,
        saving: y.income - y.education - 12 * C,
        utility: u,
        eventUtility: y.event,
        hours: w.hours,
        spend: w.spend,
      })
      assets = next
    }
    if (Number.isNaN(assetsAtRetire)) assetsAtRetire = assets
    return { policy, years, score: num / den, assetsAtRetire, minAssets, shortfallYears }
  }

  /** 今の貯蓄率（手取り − 教育費 に対する割合） */
  currentSavingRate(): number {
    const p = this.profile
    const hh = householdAt(p, p.age)
    const gross = grossAtHours(this.job, this.job.weeklyHours)
    const net = householdNetAnnual(p, gross) + hh.allowance * 12 - hh.education
    return net > 0 ? Math.min(0.9, Math.max(0, (p.monthlySaving * 12) / net)) : 0
  }

  /** optimize の非同期版（1プランごとに画面へ制御を返す） */
  async optimizeAsync(base: LifePolicy, opts: OptimizeOptions = {}): Promise<LifeResult> {
    const it = this.optimizeSteps(base, opts)
    for (;;) {
      const r = it.next()
      if (r.done) return r.value
      opts.onProgress?.(r.value)
      await new Promise((res) => setTimeout(res, 0))
    }
  }

  optimize(base: LifePolicy, opts: OptimizeOptions = {}): LifeResult {
    const it = this.optimizeSteps(base, opts)
    for (;;) {
      const r = it.next()
      if (r.done) return r.value
      opts.onProgress?.(r.value)
    }
  }

  /** 労働時間（段階別）と引退年齢を座標降下法で探索して、生涯の平均効用が最大のプランを探す */
  *optimizeSteps(base: LifePolicy, opts: OptimizeOptions = {}): Generator<number, LifeResult, unknown> {
    const hoursChoices = opts.hoursChoices ?? [20, 25, 30, 35, 40, 45, 50, 55]
    // 健康の衰えを含めていないので、探索する引退年齢は70歳まで（高年齢者雇用安定法の努力義務の上限）
    const retireChoices = (opts.retireChoices ?? [50, 55, 60, 63, 65, 68, 70]).filter((a) => a > this.startAge)
    let best = this.simulate(base)
    let policy = base
    const sweeps = opts.sweeps ?? 2
    const totalSteps = sweeps * (policy.stages.length * hoursChoices.length + retireChoices.length)
    let step = 0
    for (let s = 0; s < sweeps; s++) {
      let improved = false
      for (let si = 0; si < policy.stages.length; si++) {
        for (const h of hoursChoices) {
          step++
          if (policy.stages[si].hours === h) continue
          const stages = policy.stages.map((st, j) => (j === si ? { ...st, hours: h } : st))
          const cand = this.simulate({ ...policy, stages })
          if (cand.score > best.score + 1e-6) {
            best = cand
            policy = cand.policy
            improved = true
          }
          yield step / totalSteps
        }
      }
      for (const ra of retireChoices) {
        step++
        if (policy.retireAge === ra) continue
        const cand = this.simulate({ ...policy, retireAge: ra })
        if (cand.score > best.score + 1e-6) {
          best = cand
          policy = cand.policy
          improved = true
        }
        yield step / totalSteps
      }
      if (!improved) break
    }
    return best
  }
}

/**
 * 年齢の区切り（今の年齢から引退まで、最大3段階）。
 * 40歳・55歳で区切るが、今の年齢に近すぎる・引退後になる区切りは使わず、その場合は10年ごとに区切る。
 */
export function defaultStages(age: number, hours: number, retireAge = 65): Stage[] {
  const cuts = [age]
  for (const c of [40, 55]) if (c >= age + 3 && c < retireAge - 2) cuts.push(c)
  while (cuts.length < 3) {
    const next = cuts[cuts.length - 1] + 10
    if (next >= retireAge - 2) break
    cuts.push(next)
  }
  return cuts.map((from) => ({ from, hours }))
}

function describeStages(stages: Stage[], retireAge: number): string {
  const parts = stages.map((s, i) => {
    const until = Math.min(stages[i + 1]?.from ?? retireAge, retireAge) - 1
    return until > s.from ? `${s.from}〜${until}歳は週${s.hours}時間` : `${s.from}歳は週${s.hours}時間`
  })
  return `${parts.join('、')}、${retireAge}歳で引退`
}

export function presetPolicies(p: Profile): LifePolicy[] {
  const job = currentJob(p)
  const H = job.weeklyHours
  const R = Math.max(p.retireAge, p.age + 1)
  const mk = (id: string, name: string, lead: string, hours: number[], retireAge: number, saving: 'optimal' | 'current'): LifePolicy => {
    const base = defaultStages(p.age, hours[0], retireAge)
    const stages = base.map((s, i) => ({ ...s, hours: hours[Math.min(i, hours.length - 1)] }))
    const plan = hours.every((h) => h <= 0) ? '仕事はしない' : describeStages(stages, retireAge)
    return { id, name, description: `${lead}：${plan}`, stages, retireAge, jobId: job.id, saving }
  }
  const out: LifePolicy[] = [
    mk('current', '今のまま', '今の働き方と今の貯蓄ペースを続ける', [H], R, 'current'),
    mk('current-opt', '今の働き方＋最適な貯蓄', '働き方は今のまま、毎年の消費と貯蓄を最適化', [H], R, 'optimal'),
  ]
  if (H > 0) {
    const relaxedH = Math.min(H, 35)
    const relaxedR = Math.max(R, 70)
    if (relaxedH !== H || relaxedR !== R) out.push(mk('relaxed', 'ゆとり型', '短めの時間で長く働く', [relaxedH], relaxedR, 'optimal'))
    out.push(mk('hustle', '前半がんばる型', '若いうちに長く働き、だんだん減らす', [Math.max(H, 50), 40, 35], R, 'optimal'))
    if (p.age < 48) out.push(mk('fire', '早期リタイア型', '長く働いて早く引退する', [Math.max(H, 50)], 50, 'optimal'))
  }
  return out
}
