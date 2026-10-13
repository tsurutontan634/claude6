// 効用関数の本体：パラメータの並び（レジストリ）と、週の定常状態 → 効用（人生満足度ポイント）の計算
//
// 単位：効用は「0〜10点の人生満足度に換算したポイント」。
//       「もし毎週がこうだったら、満足度が何点上がる/下がるか」として解釈する。
// 時間は 時間/週、お金は 円/月。

import type { ActivityKey, SpendKey, WeekState } from './types'
import { ACTIVITY_KEYS } from './types'
import { PRIORS } from './priors'

export interface ActivityMeta {
  key: ActivityKey
  label: string
  short: string
  /** この時間未満にはできない（例：睡眠は1日5時間 = 週35時間） */
  min: number
  /** 現実的な上限（時間/週） */
  max: number
  /** 疲労・機会費用などで1時間ごとに差し引く量（逆U字を作る。点/時間） */
  fatigue: number
  color: string
}

export const ACTIVITIES: Record<ActivityKey, ActivityMeta> = {
  sleep: { key: 'sleep', label: '睡眠', short: '睡眠', min: 35, max: 70, fatigue: PRIORS.fixed.sleepFatigue, color: 'var(--c-sleep)' },
  friends: { key: 'friends', label: '友人と過ごす', short: '友人', min: 0, max: 40, fatigue: 0, color: 'var(--c-friends)' },
  family: { key: 'family', label: '家族・パートナーと過ごす', short: '家族', min: 0, max: 70, fatigue: PRIORS.fixed.familyFatigue, color: 'var(--c-family)' },
  hobby: { key: 'hobby', label: '趣味・楽しみ', short: '趣味', min: 0, max: 60, fatigue: PRIORS.fixed.hobbyFatigue, color: 'var(--c-hobby)' },
  rest: { key: 'rest', label: '休息・だらだら（動画・SNSなど）', short: '休息', min: 0, max: 60, fatigue: PRIORS.fixed.restFatigue, color: 'var(--c-rest)' },
  exercise: { key: 'exercise', label: '運動', short: '運動', min: 0, max: 20, fatigue: PRIORS.fixed.exerciseFatigue, color: 'var(--c-exercise)' },
  learning: { key: 'learning', label: '学び・自己投資', short: '学び', min: 0, max: 30, fatigue: 0, color: 'var(--c-learning)' },
}

export interface SpendMeta {
  key: SpendKey
  label: string
  example: string
}

export const SPENDS: Record<SpendKey, SpendMeta> = {
  experience: { key: 'experience', label: '体験', example: '旅行・外食・ライブ・習い事など' },
  goods: { key: 'goods', label: 'モノ', example: '服・ガジェット・インテリアなど' },
  social: { key: 'social', label: '人のため', example: 'プレゼント・おごり・寄付など' },
  timeBuy: { key: 'timeBuy', label: '時間を買う', example: '家事代行・時短家電・タクシーなど' },
}

// ---------------------------------------------------------------------------
// パラメータ・レジストリ
// ---------------------------------------------------------------------------

export type Transform = 'log' | 'identity'

export interface ParamDef {
  key: string
  label: string
  transform: Transform
  /** 事前分布（変換後の空間での正規分布）の平均と標準偏差 */
  mu: number
  sd: number
  unit: string
  description: string
  sources: string[]
}

const actIndex = (k: ActivityKey) => ACTIVITY_KEYS.indexOf(k)

export const N_ACT = ACTIVITY_KEYS.length
/** 各活動の「最初の1時間の価値」 w_a */
export const P_W = 0
/** 各活動の「頭打ちの目安（時間/週）」 S_a */
export const P_S = N_ACT
export const P_BETA = 2 * N_ACT
export const P_ETA = P_BETA + 1
export const P_SECMAX = P_BETA + 2
export const P_SECM = P_BETA + 3
export const P_WORKJOY = P_BETA + 4
export const P_OVERWORK = P_BETA + 5
export const P_COMMUTE = P_BETA + 6
export const P_AEXP = P_BETA + 7
export const P_AGOODS = P_BETA + 8
export const P_ASOCIAL = P_BETA + 9
export const P_TAU = P_BETA + 10
export const N_PARAMS = P_TAU + 1

export function buildParamDefs(): ParamDef[] {
  const defs: ParamDef[] = new Array(N_PARAMS)
  for (const k of ACTIVITY_KEYS) {
    const pr = PRIORS.activity[k]
    defs[P_W + actIndex(k)] = {
      key: `w_${k}`,
      label: `${ACTIVITIES[k].short}：最初の1時間の価値`,
      transform: 'log',
      mu: Math.log(pr.w),
      sd: pr.wSd,
      unit: '点/時間',
      description: `${ACTIVITIES[k].label}の時間が週0時間から1時間増えたときに増える満足度`,
      sources: pr.sources,
    }
    defs[P_S + actIndex(k)] = {
      key: `S_${k}`,
      label: `${ACTIVITIES[k].short}：頭打ちの目安`,
      transform: 'log',
      mu: Math.log(pr.S),
      sd: pr.SSd,
      unit: '時間/週',
      description: `この時間（${k === 'sleep' ? '最低睡眠を超えた分' : '週あたり'}）で、追加1時間の価値が最初の約37%まで下がる`,
      sources: pr.sources,
    }
  }
  const m = PRIORS.money
  defs[P_BETA] = {
    key: 'beta',
    label: 'お金：消費が倍になったときの価値',
    transform: 'log',
    mu: Math.log(m.beta),
    sd: m.betaSd,
    unit: '点/対数単位',
    description: '基準の消費水準で、消費が e 倍（約2.7倍）になると増える満足度。倍増なら約0.69倍の効果',
    sources: m.betaSources,
  }
  defs[P_ETA] = {
    key: 'eta',
    label: 'お金：頭打ちの強さ（η）',
    transform: 'log',
    mu: Math.log(m.eta),
    sd: m.etaSd,
    unit: '',
    description: 'η=1 なら「収入が倍になるごとに同じだけ幸せ」、1より大きいほど高収入で頭打ちになりやすい',
    sources: m.etaSources,
  }
  defs[P_SECMAX] = {
    key: 'secMax',
    label: '安心：貯金による安心感の最大値',
    transform: 'log',
    mu: Math.log(m.secMax),
    sd: m.secMaxSd,
    unit: '点',
    description: '貯金ゼロの状態から、十分な貯金がある状態になったときに増える満足度',
    sources: m.secSources,
  }
  defs[P_SECM] = {
    key: 'secM',
    label: '安心：頭打ちの目安',
    transform: 'log',
    mu: Math.log(m.secM),
    sd: m.secMSd,
    unit: '月分',
    description: '貯金がこの月数分あると、安心感の上積みが小さくなり始める',
    sources: m.secSources,
  }
  const w = PRIORS.work
  defs[P_WORKJOY] = {
    key: 'workJoy',
    label: '仕事：1時間あたりの楽しさ',
    transform: 'identity',
    mu: w.joy,
    sd: w.joySd,
    unit: '点/時間',
    description: '収入とは別に、仕事そのものから得る満足（マイナスなら苦痛）',
    sources: w.sources,
  }
  defs[P_OVERWORK] = {
    key: 'overwork',
    label: '仕事：長時間労働のつらさ',
    transform: 'log',
    mu: Math.log(w.overwork),
    sd: w.overworkSd,
    unit: '点/時間²',
    description: `週${w.overworkFrom}時間を超えた分の2乗に比例して満足度が下がる係数`,
    sources: w.sources,
  }
  defs[P_COMMUTE] = {
    key: 'commute',
    label: '通勤：1時間あたりの負担',
    transform: 'log',
    mu: Math.log(w.commute),
    sd: w.commuteSd,
    unit: '点/時間',
    description: '通勤時間そのもののつらさ（その時間を他に使えない損失とは別）',
    sources: w.commuteSources,
  }
  const sp = PRIORS.spend
  defs[P_AEXP] = {
    key: 'aExperience',
    label: '体験にお金を使う上乗せ効果（最大）',
    transform: 'log',
    mu: Math.log(sp.experience.max),
    sd: sp.experience.sd,
    unit: '点',
    description: '旅行・外食などの体験への支出が、同じ金額の普通の消費よりも多くもたらす満足の上限',
    sources: sp.sources,
  }
  defs[P_AGOODS] = {
    key: 'aGoods',
    label: 'モノにお金を使う上乗せ効果（最大）',
    transform: 'log',
    mu: Math.log(sp.goods.max),
    sd: sp.goods.sd,
    unit: '点',
    description: 'モノへの支出が、同じ金額の普通の消費よりも多くもたらす満足の上限',
    sources: sp.sources,
  }
  defs[P_ASOCIAL] = {
    key: 'aSocial',
    label: '人のためにお金を使う上乗せ効果（最大）',
    transform: 'log',
    mu: Math.log(sp.social.max),
    sd: sp.social.sd,
    unit: '点',
    description: 'プレゼントや寄付など、他人のための支出が、同じ金額の普通の消費よりも多くもたらす満足の上限',
    sources: sp.sources,
  }
  defs[P_TAU] = {
    key: 'tau',
    label: '回答のゆらぎ',
    transform: 'log',
    mu: Math.log(PRIORS.noise.tau),
    sd: PRIORS.noise.tauSd,
    unit: '点',
    description: 'この程度の満足度の差だと、同じ質問でも答えが揺れやすい',
    sources: PRIORS.noise.sources,
  }
  return defs
}

export const PARAM_DEFS: ParamDef[] = buildParamDefs()

/** 変換前（制約なし空間）z → 自然なパラメータ θ */
export function toTheta(z: ArrayLike<number>, out: Float64Array, offset = 0, zOffset = 0): void {
  for (let i = 0; i < N_PARAMS; i++) {
    const v = z[zOffset + i]
    out[offset + i] = PARAM_DEFS[i].transform === 'log' ? Math.exp(v) : v
  }
}

// ---------------------------------------------------------------------------
// 効用関数
// ---------------------------------------------------------------------------

/** 等価消費の基準（円/月/等価人数）。この水準で β が「対数消費1単位あたりの点数」になる */
export const C_REF = PRIORS.money.cRef
/** 支出カテゴリ上乗せ効果の飽和スケール（円/月）：体験・モノ・人のため */
export const SPEND_SCALES: [number, number, number] = [
  PRIORS.spend.experience.scale,
  PRIORS.spend.goods.scale,
  PRIORS.spend.social.scale,
]
export const OVERWORK_FROM = PRIORS.work.overworkFrom
/** 支出の上乗せをこれ以上は求めない限界効用（点/円）。残りは「その他（ふつうの消費）」 */
export const SPEND_MU_MIN = (PRIORS.spend.minMarginalRatio * PRIORS.money.beta) / PRIORS.money.cRef

/** CRRA型：x=1 で 0、傾き 1 */
export function crra(x: number, eta: number): number {
  if (x <= 0) return -1e3
  if (Math.abs(eta - 1) < 1e-6) return Math.log(x)
  return (Math.pow(x, 1 - eta) - 1) / (1 - eta)
}

/** 飽和型の活動効用：w·S·(1 − e^{−(h−min)/S}) − fatigue·(h−min) */
export function activityUtility(w: number, S: number, fatigue: number, h: number, min: number): number {
  const x = Math.max(0, h - min)
  return w * S * (1 - Math.exp(-x / S)) - fatigue * x
}

/** 活動の限界効用（h での追加1時間の価値） */
export function activityMarginal(w: number, S: number, fatigue: number, h: number, min: number): number {
  const x = Math.max(0, h - min)
  return w * Math.exp(-x / S) - fatigue
}

/**
 * 消費の満足に数える金額：家事代行など「時間を買う」支出は除く
 * （その価値は浮いた時間の側で数えるので、二重計上しない）
 */
export function goodsConsumption(s: WeekState): number {
  return Math.max(1, s.consumption - s.spend.timeBuy)
}

export function equivalizedConsumption(consumption: number, householdSize: number): number {
  return consumption / Math.sqrt(Math.max(1, householdSize))
}

/** 貯金の安心感：secMax·(1 − e^{−m/secM})、m は生活費の何か月分か */
export function securityUtility(secMax: number, secM: number, months: number): number {
  return secMax * (1 - Math.exp(-Math.max(0, months) / secM))
}

export function workUtility(joy: number, overwork: number, hours: number): number {
  const over = Math.max(0, hours - OVERWORK_FROM)
  return joy * hours - overwork * over * over
}

// ---------------------------------------------------------------------------
// 推定しない固定の項（研究から決めた値をそのまま使う）
// ---------------------------------------------------------------------------

const F = PRIORS.fixed

/** 仕事がもたらす所属・役割・生活リズム（収入とは別）。週8時間ほどでほぼ飽和する */
export function employmentBenefit(hours: number): number {
  if (hours <= 0) return 0
  return F.employmentMax * (1 - Math.exp(-hours / F.employmentS))
}

/** 一人の受け身の時間（休息＋趣味）が多すぎることによる低下 */
export function soloPenalty(rest: number, hobby: number): number {
  return -F.soloPenalty * Math.max(0, rest + hobby - F.soloCap)
}

export function houseworkUtility(hours: number): number {
  return -F.houseworkDislike * Math.max(0, hours)
}

/** 固定の項の合計（パラメータ θ に依存しない） */
export function fixedUtility(s: WeekState): number {
  return employmentBenefit(s.workHours) + soloPenalty(s.hours.rest, s.hours.hobby) + houseworkUtility(s.houseworkHours)
}

/** 支出の上乗せ効果：A·(1 − e^{−x/X})（上限 A に飽和） */
export function spendBonus(A: number, yen: number, scale: number): number {
  return A * (1 - Math.exp(-Math.max(0, yen) / scale))
}

export interface UtilityBreakdown {
  activities: Record<ActivityKey, number>
  money: number
  spendMix: number
  security: number
  /** 仕事そのもの（楽しさ・長時間のつらさ・所属感） */
  work: number
  commute: number
  /** 家事の負担と、一人の受け身の時間の取りすぎ */
  other: number
  total: number
}

/** θ（自然パラメータ、offset から N_PARAMS 個）で週の定常状態の効用を計算する */
export function utility(theta: ArrayLike<number>, s: WeekState, o = 0): number {
  let u = 0
  for (let i = 0; i < N_ACT; i++) {
    const k = ACTIVITY_KEYS[i]
    const meta = ACTIVITIES[k]
    u += activityUtility(theta[o + P_W + i], theta[o + P_S + i], meta.fatigue, s.hours[k], meta.min)
  }
  u += theta[o + P_BETA] * crra(equivalizedConsumption(goodsConsumption(s), s.householdSize) / C_REF, theta[o + P_ETA])
  u += spendBonus(theta[o + P_AEXP], s.spend.experience, SPEND_SCALES[0])
  u += spendBonus(theta[o + P_AGOODS], s.spend.goods, SPEND_SCALES[1])
  u += spendBonus(theta[o + P_ASOCIAL], s.spend.social, SPEND_SCALES[2])
  u += securityUtility(theta[o + P_SECMAX], theta[o + P_SECM], s.assetsMonths)
  u += workUtility(theta[o + P_WORKJOY] + s.jobJoyShift, theta[o + P_OVERWORK], s.workHours)
  u -= theta[o + P_COMMUTE] * s.commuteHours
  return u + fixedUtility(s)
}

export function utilityBreakdown(theta: ArrayLike<number>, s: WeekState, o = 0): UtilityBreakdown {
  const activities = {} as Record<ActivityKey, number>
  let total = 0
  for (let i = 0; i < N_ACT; i++) {
    const k = ACTIVITY_KEYS[i]
    const meta = ACTIVITIES[k]
    const v = activityUtility(theta[o + P_W + i], theta[o + P_S + i], meta.fatigue, s.hours[k], meta.min)
    activities[k] = v
    total += v
  }
  const money = theta[o + P_BETA] * crra(equivalizedConsumption(goodsConsumption(s), s.householdSize) / C_REF, theta[o + P_ETA])
  const spendMix =
    spendBonus(theta[o + P_AEXP], s.spend.experience, SPEND_SCALES[0]) +
    spendBonus(theta[o + P_AGOODS], s.spend.goods, SPEND_SCALES[1]) +
    spendBonus(theta[o + P_ASOCIAL], s.spend.social, SPEND_SCALES[2])
  const security = securityUtility(theta[o + P_SECMAX], theta[o + P_SECM], s.assetsMonths)
  const work = workUtility(theta[o + P_WORKJOY] + s.jobJoyShift, theta[o + P_OVERWORK], s.workHours) + employmentBenefit(s.workHours)
  const commute = -theta[o + P_COMMUTE] * s.commuteHours
  const other = soloPenalty(s.hours.rest, s.hours.hobby) + houseworkUtility(s.houseworkHours)
  total += money + spendMix + security + work + commute + other
  return { activities, money, spendMix, security, work, commute, other, total }
}
