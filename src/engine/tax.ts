// 会社員の手取り（概算）と公的年金（概算）
// 扶養・各種控除（配偶者控除、生命保険料控除、iDeCo、ふるさと納税など）は考慮しない簡易版。
// 出典と前提は JP_RULES.sources を参照。

export const JP_RULES = {
  /** 従業員負担の社会保険料率（2026年度） */
  health: 0.0495, // 協会けんぽ全国平均 9.9% の折半
  childSupport: 0.00115, // 子ども・子育て支援金（2026年5月から）
  care: 0.0081, // 介護保険（40〜64歳）
  pension: 0.0915, // 厚生年金 18.3% の折半
  employment: 0.005, // 雇用保険（一般の事業）
  /** 厚生年金の保険料がかかる年収の上限（標準報酬月額 65万円 × 12。賞与の上限は簡略化） */
  pensionCap: 7_800_000,
  /** 健康保険・介護保険がかかる年収の上限（標準報酬月額 139万円 × 12） */
  healthCap: 16_680_000,
  /** 住民税の均等割＋森林環境税、所得割の税率、基礎控除、調整控除 */
  residentFlat: 5_000,
  residentRate: 0.1,
  residentBasic: 430_000,
  residentAdjust: 2_500,
  /** 老齢基礎年金の満額（年額、2026年度） */
  basicPensionFull: 847_300,
  /** 報酬比例部分の乗率（2003年4月以降） */
  pensionMultiplier: 5.481 / 1000,
  sources: [
    '国税庁「給与所得控除」「基礎控除」（令和7年度税制改正後）',
    '国税庁「所得税の税率」',
    '全国健康保険協会「保険料率」・厚生労働省「雇用保険料率」・こども家庭庁「子ども・子育て支援金」',
    '日本年金機構「老齢基礎年金の年金額」「報酬比例部分」',
  ],
}

/** 給与所得控除（令和7年分以降：最低保障 65万円） */
export function employmentIncomeDeduction(gross: number): number {
  if (gross <= 1_900_000) return Math.min(gross, 650_000)
  if (gross <= 3_600_000) return gross * 0.3 + 80_000
  if (gross <= 6_600_000) return gross * 0.2 + 440_000
  if (gross <= 8_500_000) return gross * 0.1 + 1_100_000
  return 1_950_000
}

/** 所得税の基礎控除（令和7年度改正：合計所得に応じて 95万〜58万、2,350万超で逓減） */
export function basicDeductionIncomeTax(totalIncome: number): number {
  if (totalIncome <= 1_320_000) return 950_000
  if (totalIncome <= 3_360_000) return 880_000
  if (totalIncome <= 4_890_000) return 680_000
  if (totalIncome <= 6_550_000) return 630_000
  if (totalIncome <= 23_500_000) return 580_000
  if (totalIncome <= 24_000_000) return 480_000
  if (totalIncome <= 24_500_000) return 320_000
  if (totalIncome <= 25_000_000) return 160_000
  return 0
}

/** 所得税（復興特別所得税 2.1% 込み） */
export function incomeTax(taxable: number): number {
  if (taxable <= 0) return 0
  const t = Math.floor(taxable / 1000) * 1000
  let tax: number
  if (t <= 1_949_000) tax = t * 0.05
  else if (t <= 3_299_000) tax = t * 0.1 - 97_500
  else if (t <= 6_949_000) tax = t * 0.2 - 427_500
  else if (t <= 8_999_000) tax = t * 0.23 - 636_000
  else if (t <= 17_999_000) tax = t * 0.33 - 1_536_000
  else if (t <= 39_999_000) tax = t * 0.4 - 2_796_000
  else tax = t * 0.45 - 4_796_000
  return tax * 1.021
}

export interface TakeHome {
  gross: number
  socialInsurance: number
  incomeTax: number
  residentTax: number
  net: number
}

/** 会社員の年間手取り（概算） */
export function takeHome(gross: number, age: number): TakeHome {
  if (gross <= 0) return { gross: 0, socialInsurance: 0, incomeTax: 0, residentTax: 0, net: 0 }
  const r = JP_RULES
  const healthBase = Math.min(gross, r.healthCap)
  // 厚生年金は70歳まで
  const pensionBase = age >= 70 ? 0 : Math.min(gross, r.pensionCap)
  const care = age >= 40 && age < 65 ? r.care : 0
  // 年収 106万円未満は社会保険の対象外とみなす（簡略化）
  const si = gross < 1_060_000 ? 0 : healthBase * (r.health + r.childSupport + care) + pensionBase * r.pension + gross * r.employment
  const employmentIncome = Math.max(0, gross - employmentIncomeDeduction(gross))
  const it = incomeTax(employmentIncome - si - basicDeductionIncomeTax(employmentIncome))
  const residentTaxable = employmentIncome - si - r.residentBasic
  const rt = employmentIncome <= 450_000 ? 0 : Math.max(0, Math.max(0, residentTaxable) * r.residentRate - r.residentAdjust) + r.residentFlat
  const net = gross - si - it - rt
  return { gross, socialInsurance: si, incomeTax: it, residentTax: rt, net }
}

/** 年金生活者の手取り（概算）：公的年金等控除 110万（65歳以上）と国保・介護保険を簡略化 */
export function pensionTakeHome(pension: number, age: number): number {
  if (pension <= 0) return 0
  const deduction = age >= 65 ? Math.max(1_100_000, pension * 0.25 + 275_000) : 600_000
  const income = Math.max(0, pension - deduction)
  // 国民健康保険・介護保険（年金生活者）をおおまかに所得の 11% ＋ 均等割 5万円とする
  const si = income * 0.11 + 50_000
  const it = incomeTax(income - si - basicDeductionIncomeTax(income))
  const rt = income <= 0 ? 0 : Math.max(0, income - si - JP_RULES.residentBasic) * 0.1 + JP_RULES.residentFlat
  return Math.max(0, pension - si - it - rt)
}

/**
 * 公的年金（65歳開始、年額）の概算。
 * @param avgGross 厚生年金加入期間の平均額面年収（各年の上限 pensionCap を適用済みのもの）
 * @param years 厚生年金の加入年数
 * @param basicYears 国民年金の加入年数（最大40年）
 * @param startAge 受給開始年齢（60〜75。65歳より前は月0.4%減、後は月0.7%増）
 */
export function publicPension(avgGross: number, years: number, basicYears: number, startAge = 65): number {
  const r = JP_RULES
  const avgMonthly = avgGross / 12
  const earnings = avgMonthly * r.pensionMultiplier * years * 12
  const basic = r.basicPensionFull * Math.min(1, Math.max(0, basicYears) / 40)
  const months = (startAge - 65) * 12
  const adj = months < 0 ? 1 + 0.004 * months : 1 + 0.007 * Math.min(months, 120)
  return (earnings + basic) * adj
}
