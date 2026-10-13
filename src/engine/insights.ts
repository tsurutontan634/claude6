// 結果画面向けの分析：限界的な価値の円換算、推定の幅、タイプ判定、お金の満足度カーブ

import type { ActivityKey, Hours, Profile, WeekState } from './types'
import { ACTIVITY_KEYS } from './types'
import { ACTIVITIES, C_REF, N_PARAMS, P_BETA, P_ETA, P_S, P_W, PARAM_DEFS, P_SECMAX, P_AEXP, P_AGOODS, P_ASOCIAL, P_WORKJOY, crra, utilityBreakdown, BELOW_MIN_FACTOR, type UtilityBreakdown } from './model'
import { buildTimeValueTable, timeAlloc, type TimeLimits } from './week'
import { PRIORS } from './priors'
import { WEEKS_PER_MONTH, consumptionFloor, householdAt, type CurrentLife } from './household'
import { pensionTakeHome, takeHome } from './tax'
import type { ParticlePosterior } from './posterior'

/** 消費を月1円増やしたときの満足度の増分（点/円、粒子平均） */
export function moneyMarginal(thetas: Float64Array, consumption: number, householdSize: number): number {
  const k = thetas.length / N_PARAMS
  const sq = Math.sqrt(Math.max(1, householdSize))
  const x = consumption / sq / C_REF
  let s = 0
  for (let j = 0; j < k; j++) {
    const o = j * N_PARAMS
    s += (thetas[o + P_BETA] * Math.pow(x, -thetas[o + P_ETA])) / (sq * C_REF)
  }
  return s / k
}

export interface ActivityValue {
  key: ActivityKey
  /** 今の時間で、週1時間増やしたときの満足度の増分（点） */
  points: number
  /** それをお金に換算すると1時間あたり何円か */
  yenPerHour: number
}

/** 今の時間の使い方での、各活動の「あと1時間」の価値 */
export function activityValues(thetas: Float64Array, hours: Hours, consumption: number, householdSize: number): ActivityValue[] {
  const k = thetas.length / N_PARAMS
  const mu = moneyMarginal(thetas, consumption, householdSize)
  return ACTIVITY_KEYS.map((key, i) => {
    const meta = ACTIVITIES[key]
    const x = hours[key] - meta.min
    let s = 0
    for (let j = 0; j < k; j++) {
      const o = j * N_PARAMS
      // 最低限を下回っている（睡眠が1日5時間未満など）なら、急な損失の傾き
      s += x < 0 ? BELOW_MIN_FACTOR * thetas[o + P_W + i] : thetas[o + P_W + i] * Math.exp(-x / thetas[o + P_S + i])
    }
    let points = s / k - meta.fatigue
    // 休息＋趣味が多すぎるときのペナルティ（モデルと同じ）
    if ((key === 'rest' || key === 'hobby') && hours.rest + hours.hobby >= PRIORS.fixed.soloCap) points -= PRIORS.fixed.soloPenalty
    // 週1時間 = 月 4.345 時間。月あたりの金額に直してから1時間あたりにする
    const yenPerHour = mu > 0 ? points / mu / WEEKS_PER_MONTH : 0
    return { key, points, yenPerHour }
  })
}

/** 今の生活での各活動の「あと1時間」の価値（画面どうしで同じ値になるよう、計算をここにまとめる） */
export function lifeActivityValues(thetas: Float64Array, life: CurrentLife): ActivityValue[] {
  return activityValues(thetas, life.state.hours, Math.max(1, life.consumption - life.state.spend.timeBuy), life.state.householdSize)
}

/**
 * 推定の幅：事後分布から引いた「あり得るあなた」1人ずつについて最適な時間配分を出し、
 * 活動ごとに 10〜90% の範囲を取る（好みの不確かさで最適な時間がどれくらい動くか）。
 */
export function allocationRanges(thetas: Float64Array, free: number, limits: TimeLimits, maxDraws = 200): Record<ActivityKey, [number, number]> {
  const k = Math.min(maxDraws, thetas.length / N_PARAMS)
  const per: Record<ActivityKey, number[]> = {} as Record<ActivityKey, number[]>
  for (const key of ACTIVITY_KEYS) per[key] = []
  for (let j = 0; j < k; j++) {
    const one = thetas.slice(j * N_PARAMS, (j + 1) * N_PARAMS)
    const alloc = timeAlloc(buildTimeValueTable(one, free + 1, limits), free)
    for (const key of ACTIVITY_KEYS) per[key].push(alloc[key])
  }
  const out = {} as Record<ActivityKey, [number, number]>
  for (const key of ACTIVITY_KEYS) {
    const v = per[key].sort((a, b) => a - b)
    out[key] = [v[Math.floor(0.1 * (v.length - 1))], v[Math.ceil(0.9 * (v.length - 1))]]
  }
  return out
}

// ---------------------------------------------------------------------------
// タイプ判定
// ---------------------------------------------------------------------------

export interface TypeResult {
  id: string
  name: string
  description: string
  /** 判定に使った分野ごとのスコア（事前分布からのずれ、標準偏差単位） */
  scores: { label: string; score: number }[]
}

const DOMAINS: { id: string; label: string; params: number[] }[] = [
  { id: 'connect', label: '人とのつながり', params: [P_W + 1, P_S + 1, P_W + 2, P_S + 2] },
  { id: 'me', label: '自分の時間', params: [P_W + 3, P_S + 3, P_W + 4] },
  { id: 'body', label: '体と睡眠', params: [P_W + 0, P_W + 5, P_S + 5] },
  { id: 'growth', label: '学び・仕事', params: [P_W + 6, P_S + 6, P_WORKJOY] },
  { id: 'money', label: 'お金と体験', params: [P_BETA, P_AEXP, P_AGOODS, P_ASOCIAL] },
  { id: 'safety', label: '安心・備え', params: [P_SECMAX] },
]

const TYPES: Record<string, { name: string; description: string }> = {
  connect: { name: 'つながり重視タイプ', description: '友人や家族と過ごす時間が、平均的な人より幸せに効きやすいタイプ。予定が埋まりがちな週でも、人と会う時間を先に確保すると満足度が上がりやすい。' },
  me: { name: 'マイペースタイプ', description: '趣味やひとりの時間が満足度の土台になるタイプ。自由時間がまとまって取れる働き方と相性が良い。' },
  body: { name: 'からだ資本タイプ', description: '睡眠や運動が満足度を大きく左右するタイプ。まず睡眠時間と運動の習慣を守る配分がおすすめ。' },
  growth: { name: '探究・成長タイプ', description: '学びや仕事そのものから満足を得やすいタイプ。働く時間が多少長くても満足度が落ちにくい。' },
  money: { name: '実利タイプ', description: 'お金や体験への支出が満足度に効きやすいタイプ。収入を増やす選択の価値が平均より大きい。' },
  safety: { name: '堅実タイプ', description: '貯金による安心感が満足度に効きやすいタイプ。生活防衛資金を先に確保すると落ち着いて過ごせる。' },
  balance: { name: 'バランスタイプ', description: '特定の何かに偏らず、平均的な人に近い好みのタイプ。どれか1つを増やすより、全体を少しずつ整えるのが効く。' },
}

export function personalityType(post: ParticlePosterior, minAnswers = 12): TypeResult | null {
  if (post.answers.length < minAnswers) return null
  const w = post.weights()
  const n = post.n
  const p = post.p
  const mean = new Float64Array(p)
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mean[j] += w[i] * post.z[i * p + j]
  const dev = (j: number) => (mean[j] - post.mu[j]) / post.sd[j]
  // 回答でどれだけ分かったか（learned）で重み付けし、パラメータの数が違う分野を公平に比べる：
  //   score = Σ l_j·dev_j / √Σ l_j²（ほとんど分かっていないパラメータは分子にも分母にもほぼ効かない）
  const learned = Array.from({ length: p }, (_, j) => post.learned(j))
  const scores = DOMAINS.map((d) => {
    const num = d.params.reduce((s, j) => s + learned[j] * dev(j), 0)
    const den = Math.sqrt(d.params.reduce((s, j) => s + learned[j] * learned[j], 0))
    return { id: d.id, label: d.label, score: den > 0.02 ? num / den : 0 }
  })
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a))
  const id = best.score < 0.35 ? 'balance' : best.id
  return { id, ...TYPES[id], scores: scores.map(({ label, score }) => ({ label, score })) }
}

// ---------------------------------------------------------------------------
// お金の満足度カーブ（個人の推定 vs 内閣府の世帯年収別データ）
// ---------------------------------------------------------------------------

/** 内閣府「満足度・生活の質に関する調査」第1次報告書（2019）図表5：世帯年収別の総合主観満足度 */
export const CAO_INCOME_BANDS: { label: string; mid: number; ls: number }[] = [
  { label: '100万円未満', mid: 50, ls: 5.01 },
  { label: '100〜300万円', mid: 200, ls: 5.2 },
  { label: '300〜500万円', mid: 400, ls: 5.68 },
  { label: '500〜700万円', mid: 600, ls: 5.91 },
  { label: '700〜1,000万円', mid: 850, ls: 6.24 },
  { label: '1,000〜2,000万円', mid: 1414, ls: 6.52 },
  { label: '2,000〜3,000万円', mid: 2449, ls: 6.84 },
  { label: '3,000〜5,000万円', mid: 3873, ls: 6.6 },
  { label: '5,000万〜1億円', mid: 7071, ls: 6.5 },
]

export interface MoneyCurvePoint {
  /** 世帯の額面年収（万円） */
  income: number
  /** 推定した人生満足度（今の満足度を基準に、消費の効用の差だけ動かす） */
  ls: number
  lo: number
  hi: number
}

/**
 * 世帯年収 I（額面）のときの満足度。手取りに直し、今と同じ貯蓄率で消費すると仮定する。
 * 個人の推定は「今の年収・今の満足度」を基準点にして、消費の効用の差で動かす。
 */
export function moneyCurve(
  p: Profile,
  thetas: Float64Array,
  currentGrossHousehold: number,
  currentConsumption: number,
  incomes?: number[],
): MoneyCurvePoint[] {
  const hh = householdAt(p, p.age)
  const sq = Math.sqrt(hh.size)
  // 給与以外の収入（年金・その他・児童手当）は年収が変わっても同じとする
  const nonWage = (p.pensionNow > 0 ? pensionTakeHome(p.pensionNow, p.age) : 0) + Math.max(0, p.otherIncome) + hh.allowance * 12
  const net0 = takeHome(currentGrossHousehold, p.age).net + nonWage
  const consRatio = net0 > 0 ? (currentConsumption * 12) / net0 : 0.8
  const k = thetas.length / N_PARAMS
  const x0 = currentConsumption / sq / C_REF
  const out: MoneyCurvePoint[] = []
  const grid = incomes ?? Array.from({ length: 61 }, (_, i) => Math.exp(Math.log(100) + ((Math.log(8000) - Math.log(100)) * i) / 60))
  for (const I of grid) {
    const C = Math.max(consumptionFloor(p.necessities), ((takeHome(I * 10_000, p.age).net + nonWage) * consRatio) / 12)
    const x = C / sq / C_REF
    const vals: number[] = []
    for (let j = 0; j < k; j++) {
      const o = j * N_PARAMS
      const eta = thetas[o + P_ETA]
      vals.push(thetas[o + P_BETA] * (crra(x, eta) - crra(x0, eta)))
    }
    vals.sort((a, b) => a - b)
    const q = (f: number) => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))]
    out.push({ income: I, ls: p.lifeSatisfaction + q(0.5), lo: p.lifeSatisfaction + q(0.1), hi: p.lifeSatisfaction + q(0.9) })
  }
  return out
}

/** パラメータの要約（事前・事後の中央値と80%区間、どれだけ分かったか） */
export interface ParamSummary {
  index: number
  key: string
  label: string
  unit: string
  description: string
  prior: [number, number, number]
  post: [number, number, number]
  learned: number
  sources: string[]
}

export function paramSummaries(post: ParticlePosterior): ParamSummary[] {
  const tr = (j: number, z: number) => (PARAM_DEFS[j].transform === 'log' ? Math.exp(z) : z)
  return PARAM_DEFS.map((d, j) => {
    const mu = post.mu[j]
    const sd = post.sd[j]
    return {
      index: j,
      key: d.key,
      label: d.label,
      unit: d.unit,
      description: d.description,
      prior: [tr(j, mu - 1.2816 * sd), tr(j, mu), tr(j, mu + 1.2816 * sd)],
      post: [post.quantile(j, 0.1), post.quantile(j, 0.5), post.quantile(j, 0.9)],
      learned: post.learned(j),
      sources: d.sources,
    }
  })
}

/** 効用の内訳を粒子で平均する */
export function meanBreakdown(thetas: Float64Array, s: WeekState): UtilityBreakdown {
  const k = thetas.length / N_PARAMS
  const acc = utilityBreakdown(thetas, s, 0)
  for (let j = 1; j < k; j++) {
    const b = utilityBreakdown(thetas, s, j * N_PARAMS)
    for (const key of ACTIVITY_KEYS) acc.activities[key] += b.activities[key]
    acc.money += b.money
    acc.spendMix += b.spendMix
    acc.security += b.security
    acc.work += b.work
    acc.commute += b.commute
    acc.other += b.other
    acc.total += b.total
  }
  for (const key of ACTIVITY_KEYS) acc.activities[key] /= k
  acc.money /= k
  acc.spendMix /= k
  acc.security /= k
  acc.work /= k
  acc.commute /= k
  acc.other /= k
  acc.total /= k
  return acc
}
