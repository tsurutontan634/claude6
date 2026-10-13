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
  commuteAtHours,
  currentJob,
  currentLife,
  grossAtHours,
  hasFamilyAt,
  householdAt,
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
import { N_PARAMS, P_S, P_W } from './model'

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

/** 介護の時間（時間/週） */
export function caregivingHours(p: Profile, age: number): number {
  const c = p.caregiving
  if (!c) return 0
  return age >= c.startAge && age < c.startAge + c.years ? c.hoursPerWeek : 0
}

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
  // 引退後：仕事の所属感は失われる（週の効用の側で自動的に 0 になる）。60歳より前の早期リタイアは少し下がる
  if (age >= policy.retireAge) {
    u += policy.retireAge >= L.normalRetireAge ? L.retirementVoluntary : L.earlyNonwork
  }
  return u
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

  constructor(
    readonly profile: Profile,
    readonly thetas: Float64Array,
    readonly assumptions: LifeAssumptions = DEFAULT_ASSUMPTIONS,
  ) {
    this.startAge = profile.age
    this.job = currentJob(profile)
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
    // 年金計算用：過去の厚生年金加入（22歳から今まで、今の年収を年齢カーブで割り戻す）
    let pensionYears = 0
    let pensionGrossSum = 0
    for (let a = 22; a < p.age; a++) {
      pensionYears++
      pensionGrossSum += job.annualIncome / wageMultiplier(a, p.age, p.sex, 0, A.careerSteepness)
    }
    const partnerPension = p.partnerIncome > 0 ? publicPension(p.partnerIncome, 40, 40) * A.pensionFactor : JP_RULES.basicPensionFull * A.pensionFactor
    const unlisted = currentLife(p).unlisted
    let ownPension = 0
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
        pensionGrossSum += gross
      }
      if (hours > 0) {
        workedYears++
        excessSum += longHoursExcessHazard(hours)
      }
      if (age === p.pensionAge) {
        const avg = pensionYears > 0 ? pensionGrossSum / pensionYears : 0
        ownPension = publicPension(avg, pensionYears, 40, p.pensionAge) * A.pensionFactor
      }
      const pension = age >= p.pensionAge ? ownPension : 0
      let income = takeHome(gross, age).net + pensionTakeHome(pension, age)
      if (hh.partner) {
        income += age < 65 ? takeHome(p.partnerIncome, age).net : pensionTakeHome(partnerPension, age)
      }
      income += hh.allowance * 12
      if (age === policy.retireAge) income += A.retirementBonus
      // 60歳未満で働いていない年は国民年金・国民健康保険の保険料がかかる
      if (hours === 0 && age < 60) income -= 300_000
      const free = 168 - hours - commute - p.housework - p.personalCare - hh.childcareMine - p.otherDuties - caregivingHours(p, age) - unlisted
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
        housework: this.profile.housework,
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
    let upper = Math.max(p.savings, 1) * Math.pow(1 + Math.max(r, 0), T)
    for (const y of ys) upper += Math.max(0, y.income)
    upper = Math.min(Math.max(upper, 50_000_000), 5_000_000_000)
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
    const periodU = (t: number, C: number, assets: number) => Wat(t, C) + ys[t].kit.securityUtility(C > 0 ? assets / C : 0) + ys[t].event

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
      const floorC = Math.min(y.necessities * 0.6, 80_000)
      const maxC = cash / 12
      if (maxC <= floorC) {
        // 資金不足：最低限の生活費で暮らし、不足分は「借金」としてペナルティ
        const C = floorC
        const deficit = 12 * C - cash
        return { C, value: periodU(t, C, a) - deficit / (12 * 175_000) + cont * Vat(t + 1, 0), next: 0, short: true }
      }
      const obj = (C: number) => periodU(t, C, a) + cont * Vat(t + 1, (cash - 12 * C) * (1 + r))
      // 黄金分割探索（目的関数は C について単峰）
      let lo = floorC
      let hi = maxC
      const g = 0.381966
      let x1 = lo + g * (hi - lo)
      let x2 = hi - g * (hi - lo)
      let f1 = obj(x1)
      let f2 = obj(x2)
      for (let it = 0; it < 26; it++) {
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
      // 端点（全部使う／最低限）も確認
      const fEnd = obj(maxC)
      if (fEnd > best) {
        best = fEnd
        C = maxC
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
      let short = false
      if (policy.saving === 'current' && y.hours > 0) {
        const avail = y.income - y.education
        C = Math.max(40_000, (avail * (1 - currentRate)) / 12)
        next = (assets + avail - 12 * C) * (1 + r)
        if (next < 0) {
          short = true
          next = 0
        }
      } else {
        const c = choose(t, assets)
        C = c.C
        next = c.next
        short = c.short
      }
      if (short) shortfallYears++
      const w = this.yearUtility(y, C, assets, true)
      const u = w.utility + y.event
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
    let net = takeHome(gross, p.age).net + (hh.partner ? takeHome(p.partnerIncome, p.age).net : 0) + hh.allowance * 12
    net -= hh.education
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

/** 年齢の区切り（今の年齢から引退まで、3段階） */
export function defaultStages(age: number, hours: number): Stage[] {
  const cuts = [age, Math.max(age + 1, 40), Math.max(age + 2, 55)]
  return cuts.filter((c, i) => i === 0 || c > cuts[i - 1]).map((from) => ({ from, hours }))
}

export function presetPolicies(p: Profile): LifePolicy[] {
  const job = currentJob(p)
  const H = job.weeklyHours
  const R = p.retireAge
  const st = (h: number[]) => {
    const base = defaultStages(p.age, h[0])
    return base.map((s, i) => ({ ...s, hours: h[Math.min(i, h.length - 1)] }))
  }
  return [
    {
      id: 'current',
      name: '今のまま',
      description: '今の働き方と今の貯蓄ペースを、引退まで続ける',
      stages: st([H]),
      retireAge: R,
      jobId: job.id,
      saving: 'current',
    },
    {
      id: 'current-opt',
      name: '今の働き方＋最適な貯蓄',
      description: '働き方は今のまま、毎年の消費と貯蓄だけを最適化する',
      stages: st([H]),
      retireAge: R,
      jobId: job.id,
      saving: 'optimal',
    },
    {
      id: 'relaxed',
      name: 'ゆとり型',
      description: `週${Math.min(H, 35)}時間で長く働く（70歳まで）`,
      stages: st([Math.min(H, 35)]),
      retireAge: Math.max(R, 70),
      jobId: job.id,
      saving: 'optimal',
    },
    {
      id: 'hustle',
      name: '前半がんばる型',
      description: '40歳まで週50時間、その後は週40時間、55歳から週35時間',
      stages: st([50, 40, 35]),
      retireAge: R,
      jobId: job.id,
      saving: 'optimal',
    },
    {
      id: 'fire',
      name: '早期リタイア型',
      description: '週50時間で働き、50歳で引退する',
      stages: st([50]),
      retireAge: Math.max(p.age + 1, 50),
      jobId: job.id,
      saving: 'optimal',
    },
  ]
}
