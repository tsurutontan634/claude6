// 日本の統計に基づく表（年齢別賃金・子どもの時間と費用・生存率など）
// 値の出典は各定数のコメントと sources.ts を参照。

import type { ChildPlan, Sex } from './types'

/** 線形補間（xs は昇順） */
export function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1]
  let i = 1
  while (xs[i] < x) i++
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
  return ys[i - 1] * (1 - t) + ys[i] * t
}

// ---------------------------------------------------------------------------
// 年齢別の賃金カーブ
// 厚生労働省「賃金構造基本統計調査」（令和7年）一般労働者の年収（きまって支給する給与×12＋賞与）を
// 25〜29歳＝1 とした指数。年齢階級の中央の年齢に置き、間は線形補間する。
// 一部の階級は前後の年から補間した値（docs/MODEL.md 参照）。
// ---------------------------------------------------------------------------

const WAGE_AGES = [18, 22, 27, 32, 37, 42, 47, 52, 57, 62, 67, 72]
const WAGE_ALL = [0.7, 0.81, 1.0, 1.16, 1.27, 1.35, 1.42, 1.46, 1.47, 1.1, 0.9, 0.83]
const WAGE_MALE = [0.7, 0.81, 1.0, 1.19, 1.32, 1.42, 1.5, 1.56, 1.58, 1.16, 0.93, 0.84]
const WAGE_FEMALE = [0.72, 0.83, 1.0, 1.05, 1.09, 1.13, 1.14, 1.15, 1.14, 0.91, 0.8, 0.77]

export function wageIndex(age: number, sex: Sex, steepness = 1): number {
  const ys = sex === 'male' ? WAGE_MALE : sex === 'female' ? WAGE_FEMALE : WAGE_ALL
  const base = interp(WAGE_AGES, ys, 22)
  return base + steepness * (interp(WAGE_AGES, ys, age) - base)
}

/**
 * 今の年収を、年齢カーブに沿って将来に引き伸ばす倍率（実質）。
 * steepness は「年功カーブの急さ」（1 = 統計どおり、0 = 年齢で変わらない）
 */
export function wageMultiplier(fromAge: number, toAge: number, sex: Sex, realGrowth: number, steepness = 1): number {
  return (wageIndex(toAge, sex, steepness) / wageIndex(fromAge, sex, steepness)) * Math.pow(1 + realGrowth, toAge - fromAge)
}

// ---------------------------------------------------------------------------
// 子ども
// ---------------------------------------------------------------------------

export const CHILD = {
  /** 家計から独立する年齢 */
  leaveHomeAge: 22,
  /**
   * 第1子がいることで増える家事・育児時間（世帯合計、時間/週）。
   * 総務省「社会生活基本調査」（令和3年）の、6歳未満の子がいる夫婦の育児時間（夫1時間05分・妻3時間54分/日）と
   * 家事関連時間をもとに、年齢とともに減っていくよう設定。第2子以降は同じ年齢で 0.6 倍（まとめて世話できる分）。
   */
  careHours(childAge: number): number {
    if (childAge < 0) return 0
    if (childAge < 1) return 55
    if (childAge < 3) return 42
    if (childAge < 6) return 30
    if (childAge < 9) return 18
    if (childAge < 13) return 12
    if (childAge < 16) return 7
    if (childAge < 19) return 4
    return 0
  },
  additionalChildFactor: 0.6,
  /** 共働きで保育所を使う場合に減る時間（0〜5歳、世帯合計、時間/週） */
  daycareOffset: 9,
}

/**
 * 教育費（年額、円）。文部科学省「子供の学習費調査」（令和5年度）の学習費総額、
 * 大学は日本政策金融公庫「教育費負担の実態調査」（令和3年度）の在学費用と入学費用（18歳時）、
 * 0〜2歳は保育料の平均的な水準を概算（3歳以降は幼保無償化）。
 *   public  … 高校まで公立、国公立大学
 *   mixed   … 高校まで公立、私立大学（文系）
 *   private … 小学校から私立、私立大学（理系）
 */
export function educationCostAnnual(childAge: number, schooling: ChildPlan['schooling'], daycare = true): number {
  if (childAge < 0) return 0
  const priv = schooling === 'private'
  if (childAge < 3) return daycare ? 300_000 : 0 // 保育所を使わなければ保育料はかからない
  if (childAge < 6) return priv ? 347_000 : 185_000 // 幼稚園
  if (childAge < 12) return priv ? 1_828_000 : 336_000 // 小学校
  if (childAge < 15) return priv ? 1_560_000 : 542_000 // 中学校
  if (childAge < 18) return priv ? 1_029_000 : 598_000 // 高校
  if (childAge < 22) {
    const yearly = schooling === 'public' ? 1_035_000 : schooling === 'mixed' ? 1_520_000 : 1_832_000
    const entry = schooling === 'public' ? 672_000 : schooling === 'mixed' ? 818_000 : 887_000
    return yearly + (childAge < 19 ? entry : 0)
  }
  return 0
}

/** 児童手当（月額、2024年10月以降の制度）。order は第何子か */
export function childAllowanceMonthly(childAge: number, order: number): number {
  if (childAge < 0 || childAge >= 18) return 0
  if (order >= 3) return 30_000
  return childAge < 3 ? 15_000 : 10_000
}

// ---------------------------------------------------------------------------
// 生存率（厚生労働省「簡易生命表」令和6年 に合わせたゴンペルツ・メイカム近似）
// ---------------------------------------------------------------------------

/** 死力 μ(x) = A + B·e^{c·x} のパラメータ */
const GOMPERTZ: Record<Sex, { A: number; B: number; c: number }> = {
  // 平均寿命（男81.09年・女87.13年）と65・75・90歳までの生存率に合わせて推定
  male: { A: 0.0004, B: 7.106e-6, c: 0.11 },
  female: { A: 0.0005, B: 5.776e-7, c: 0.132 },
  // 性別を答えない場合は男女の中間（平均寿命 約84年）
  other: { A: 0.00045, B: 2.2e-6, c: 0.12 },
}

/** 累積ハザード H(x) = ∫μ */
export function cumulativeHazard(age: number, sex: Sex): number {
  const { A, B, c } = GOMPERTZ[sex]
  return A * age + (B / c) * Math.exp(c * age)
}

/**
 * 長時間労働による死亡リスクの上乗せ（年あたり、ハザードへの倍率 −1）。
 * Kivimäki et al. 2015・Pega et al. 2021 の脳卒中・虚血性心疾患のリスク比を、全死因に占める割合で薄めた概算。
 */
export function longHoursExcessHazard(hours: number): number {
  // 日本の死因に占める虚血性心疾患 約4%・脳血管疾患 約6.6% で薄める
  if (hours >= 55) return 0.03
  if (hours >= 49) return 0.01
  return 0
}

/** age0 で生きている人が age まで生きる確率 */
export function survival(age0: number, age: number, sex: Sex): number {
  if (age <= age0) return 1
  const { A, B, c } = GOMPERTZ[sex]
  const H = (x: number) => A * x + (B / c) * Math.exp(c * x)
  return Math.exp(-(H(age) - H(age0)))
}

/** 出生時の平均余命（検算用） */
export function lifeExpectancy(age0: number, sex: Sex): number {
  let e = 0
  for (let a = age0; a < 120; a += 0.5) e += 0.5 * survival(age0, a + 0.25, sex)
  return e
}
