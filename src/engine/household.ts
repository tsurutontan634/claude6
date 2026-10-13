// プロフィール → 計算に使う状態（今の生活の定常状態、年齢ごとの世帯の状況、仕事の収入と通勤）

import type { JobOption, Profile, Spend, WeekState } from './types'
import { ACTIVITY_KEYS } from './types'
import { pensionTakeHome, takeHome } from './tax'
import { CHILD, childAllowanceMonthly, educationCostAnnual } from './data'
import { defaultLimits, type TimeLimits } from './week'
import type { QuestionContext } from './questions'
import { PRIORS } from './priors'

export const WEEKS_PER_YEAR = 52.14
export const WEEKS_PER_MONTH = WEEKS_PER_YEAR / 12

export function currentJob(p: Profile): JobOption {
  return p.jobs.find((j) => j.id === p.currentJobId) ?? p.jobs[0]
}

/**
 * 週あたりの労働時間 h のときの額面年収（今の水準）。
 * 時間を調整できない仕事で週35時間未満にする場合は、パートタイムに移るとみなして時給を下げる
 * （samePayRate=true なら「仮に時給が同じなら」の計算）。
 */
export function grossAtHours(job: JobOption, h: number, samePayRate = false): number {
  if (h <= 0) return 0
  // 労働時間が0なのに年収がある（休職中など）場合は、標準的な週40時間で稼いでいるとみなす
  const base = job.weeklyHours > 0 ? job.weeklyHours : 40
  // フルタイムからパートタイムに移る場合だけ時給を下げる（もともと短時間の仕事には二重にかけない）
  const partTime = !samePayRate && !job.hoursFlexible && base >= 35 && h < 35 ? PRIORS.work.partTimeWageRatio : 1
  if (!job.overtimePaid) {
    // 固定給：所定（最大40時間）より短くすると比例して減り、それ以上は増えない
    const ref = Math.min(base, 40)
    return job.annualIncome * Math.min(1, h / ref) * partTime
  }
  const eff = (x: number) => Math.min(x, 40) + 1.25 * Math.max(0, x - 40)
  return ((job.annualIncome * eff(h)) / eff(base)) * partTime
}

/** 週の出社日数 */
export function workDaysAtHours(job: JobOption, h: number): number {
  if (h <= 0 || job.workDays <= 0) return 0
  const perDay = job.weeklyHours / Math.max(1, job.workDays)
  return Math.min(7, Math.max(1, Math.round(h / Math.max(4, perDay))))
}

/** 週の通勤時間（往復、在宅勤務日を除く） */
export function commuteAtHours(job: JobOption, h: number): number {
  const days = workDaysAtHours(job, h)
  const remoteShare = job.workDays > 0 ? Math.min(1, job.remoteDaysPerWeek / job.workDays) : 0
  return (days * (1 - remoteShare) * 2 * job.commuteMinutesOneWay) / 60
}

export interface HouseholdYear {
  age: number
  partner: boolean
  size: number
  /** 子どもに関わる家事・育児の追加時間（世帯合計、時間/週） */
  childcareHousehold: number
  /** そのうち自分の分 */
  childcareMine: number
  /** 教育費（年額） */
  education: number
  /** 児童手当（月額） */
  allowance: number
  /** 家にいる子どもの年齢 */
  childAges: number[]
}

export function partnerAt(p: Profile, age: number): boolean {
  return p.hasPartner || (p.partnerPlanAge !== null && age >= p.partnerPlanAge)
}

export function householdAt(p: Profile, age: number): HouseholdYear {
  const partner = partnerAt(p, age)
  let care = 0
  let education = 0
  let allowance = 0
  const childAges: number[] = []
  const sorted = [...p.children].sort((a, b) => a.parentAgeAtBirth - b.parentAgeAtBirth)
  const demands: number[] = []
  sorted.forEach((c, idx) => {
    const ca = age - c.parentAgeAtBirth
    if (ca < 0) return
    if (ca < CHILD.leaveHomeAge) childAges.push(ca)
    demands.push(Math.max(0, CHILD.careHours(ca) - (p.daycare && ca < 6 && ca >= 1 ? CHILD.daycareOffset : 0)))
    education += educationCostAnnual(ca, c.schooling, p.daycare)
    // 児童手当の「第何子」は、22歳未満の子の中で数える
    const order = sorted.slice(0, idx + 1).filter((x) => {
      const xa = age - x.parentAgeAtBirth
      return xa >= 0 && xa < 22
    }).length
    allowance += childAllowanceMonthly(ca, order)
  })
  // いちばん手のかかる子は全量、ほかの子は 0.6 倍
  demands.sort((a, b) => b - a)
  demands.forEach((d, i) => {
    care += i === 0 ? d : d * CHILD.additionalChildFactor
  })
  const share = partner ? p.careShare : 1
  return {
    age,
    partner,
    size: 1 + (partner ? 1 : 0) + childAges.length,
    childcareHousehold: care,
    childcareMine: care * share,
    education,
    allowance,
    childAges,
  }
}

/** パートナーか、家にいる子どもがいるか（「家族と過ごす時間」の中身が変わる） */
export function hasFamilyAt(p: Profile, age: number): boolean {
  const hh = householdAt(p, age)
  return hh.partner || hh.childAges.length > 0
}

/** 世帯人数の変化に応じて必需的支出を調整（等価尺度 √n） */
export function necessitiesAt(p: Profile, size: number): number {
  const size0 = householdAt(p, p.age).size
  return p.necessities * Math.sqrt(size / size0)
}

/** 今の世帯の手取り（年額）：給与（本人・パートナー）＋受給中の年金＋その他の収入 */
export function householdNetAnnual(p: Profile, ownGross: number, age = p.age): number {
  const own = takeHome(ownGross, age).net
  const partner = partnerAt(p, age) && p.partnerIncome > 0 ? takeHome(p.partnerIncome, age).net : 0
  const pension = p.pensionNow > 0 ? pensionTakeHome(p.pensionNow, age) : 0
  return own + partner + pension + Math.max(0, p.otherIncome)
}

/** 介護の時間（時間/週） */
export function caregivingHours(p: Profile, age: number): number {
  const c = p.caregiving
  if (!c) return 0
  return age >= c.startAge && age < c.startAge + c.years ? c.hoursPerWeek : 0
}

/** 収入が足りないときの消費の下限（貯金を取り崩して暮らす前提） */
export function consumptionFloor(necessities: number): number {
  return Math.max(30_000, necessities * 0.6)
}

/** 家事代行などで今すでに減らしている家事の時間（時間/週） */
export function boughtHousework(p: Profile, timeBuyMonthly: number): number {
  const bought = timeBuyMonthly / WEEKS_PER_MONTH / PRIORS.spend.timeBuyYenPerHour
  // 外注しているぶんを足し戻した「もとの家事時間」の maxShare までしか外注できない
  const gross = p.housework + bought
  return Math.min(bought, gross * PRIORS.spend.timeBuyMaxShare)
}

/** 活動時間の上限・下限（プロフィールに応じて家族の時間の上限を変える） */
export function limitsFor(p: Profile, age = p.age): TimeLimits {
  const l = defaultLimits()
  if (!hasFamilyAt(p, age)) l.max.family = PRIORS.fixed.familyMaxSingle
  // 今すでにそれ以上使っている場合は上限を広げる
  for (const k of ACTIVITY_KEYS) l.max[k] = Math.max(l.max[k], p.currentHours[k])
  return l
}

function normalizedShares(s: Spend): [number, number, number] {
  const tot = s.experience + s.goods + s.social
  if (tot <= 0) return [0.5, 0.3, 0.2]
  return [s.experience / tot, s.goods / tot, s.social / tot]
}

export interface CurrentLife {
  state: WeekState
  netMonthly: number
  /** 収入が必需的支出の6割に届かず、貯金を取り崩して暮らしている前提で計算しているか */
  drawingDown: boolean
  /** 外注前の家事時間（時間/週） */
  grossHousework: number
  /** 今いま介護に使っている時間（時間/週） */
  caregiving: number
  consumption: number
  discretionary: number
  necessities: number
  /** 自由時間（睡眠や趣味などに使える時間の合計） */
  freeHours: number
  /** 時間の合計が168時間と合わない分（正なら未記入の時間） */
  unaccounted: number
  /** 未記入の時間（その他の固定時間として扱う。最適化で自由時間に数えない） */
  unlisted: number
  household: HouseholdYear
  commuteHours: number
}

/** プロフィールから「今の生活」を組み立てる */
export function currentLife(p: Profile): CurrentLife {
  const job = currentJob(p)
  const hh = householdAt(p, p.age)
  const gross = grossAtHours(job, job.weeklyHours)
  const netMonthly = householdNetAnnual(p, gross) / 12 + hh.allowance
  const raw = netMonthly - p.monthlySaving - hh.education / 12
  const floor = consumptionFloor(p.necessities)
  const drawingDown = raw < floor
  // 収入で必需品もまかなえない場合は、貯金を取り崩して必需的支出ぶんは使っているとみなす
  const consumption = drawingDown ? Math.max(floor, Math.min(p.necessities, p.savings / 12)) : raw
  const discretionary = Math.max(0, consumption - p.necessities)
  const shareTot = p.spendShare.experience + p.spendShare.goods + p.spendShare.social + p.spendShare.timeBuy
  const f = (k: keyof Spend) => (shareTot > 0 ? (discretionary * p.spendShare[k]) / shareTot : 0)
  const commuteHours = commuteAtHours(job, job.weeklyHours)
  const hours = { ...p.currentHours }
  const used =
    ACTIVITY_KEYS.reduce((s, k) => s + hours[k], 0) +
    job.weeklyHours +
    commuteHours +
    p.housework +
    p.personalCare +
    hh.childcareMine +
    p.otherDuties +
    caregivingHours(p, p.age)
  const state: WeekState = {
    hours,
    workHours: job.weeklyHours,
    commuteHours,
    consumption,
    householdSize: hh.size,
    spend: { experience: f('experience'), goods: f('goods'), social: f('social'), timeBuy: f('timeBuy') },
    assetsMonths: p.savings / consumption,
    jobJoyShift: 0,
    houseworkHours: p.housework,
  }
  const care = caregivingHours(p, p.age)
  return {
    state,
    netMonthly,
    drawingDown,
    grossHousework: p.housework + boughtHousework(p, state.spend.timeBuy),
    caregiving: care,
    consumption,
    discretionary,
    necessities: p.necessities,
    freeHours: 168 - job.weeklyHours - commuteHours - p.housework - p.personalCare - hh.childcareMine - p.otherDuties - care - Math.max(0, 168 - used),
    unaccounted: 168 - used,
    unlisted: Math.max(0, 168 - used),
    household: hh,
    commuteHours,
  }
}

/** 仕事の好き度（1〜5）の差 → 1時間あたりの楽しさの差（点/時間） */
export function jobJoyShift(job: JobOption, current: JobOption): number {
  return (job.enjoyment - current.enjoyment) * PRIORS.work.jobJoyPerStep
}

/** 質問生成に使う文脈 */
export function questionContext(p: Profile): QuestionContext {
  const life = currentLife(p)
  const job = currentJob(p)
  const hh = life.household
  return {
    base: life.state,
    // 質問は「仮に時給が同じなら」で聞く
    consumptionAtHours: (h: number) =>
      Math.max(consumptionFloor(p.necessities), householdNetAnnual(p, grossAtHours(job, h, true)) / 12 + hh.allowance - p.monthlySaving - hh.education / 12),
    commuteAtHours: (h: number) => commuteAtHours(job, h),
    commuteDays: job.workDays > 0 ? workDaysAtHours(job, job.weeklyHours) * (1 - Math.min(1, job.remoteDaysPerWeek / job.workDays)) : 0,
    commuteMinutesOneWay: job.commuteMinutesOneWay,
    necessities: p.necessities,
    limits: limitsFor(p),
    spendWeights: normalizedShares(p.spendShare),
    timeBuyYenPerHour: PRIORS.spend.timeBuyYenPerHour,
    timeBuyMaxShare: PRIORS.spend.timeBuyMaxShare,
    housework: p.housework,
    hoursFlexible: job.hoursFlexible,
  }
}

/** 好き度（1〜5）から活動の「最初の1時間の価値」の事前平均を何倍するか */
export function likingMultiplier(r: number): number {
  const table = [0.45, 0.7, 1, 1.4, 2]
  const i = Math.min(5, Math.max(1, Math.round(r))) - 1
  return table[i]
}
