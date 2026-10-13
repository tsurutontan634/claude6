// 事前分布（研究データから作る「平均的な人」の効用関数）
// 単位：効用は 0〜10点の人生満足度ポイント、時間は 時間/週、お金は 円/月。
// ここで決めた値は「回答がゼロのときの出発点」で、1対1質問の回答でベイズ更新されていく。
// 各値の根拠は docs/MODEL.md と sources.ts を参照。
//
// 校正の考え方：
//   自由時間1時間の限界的な価値 λ ≈ β ×（1時間の手取り）/（週の消費）
//   ≈ 0.45 × 2,000円 / 6万円 ≈ 0.015点。通勤の補償研究（Stutzer & Frey 2008 ほか）とも整合する。
//   各活動の w・S は、DRM（Kahneman et al. 2004）の楽しさと用量反応の研究
//   （睡眠7〜9時間、運動 週2〜6時間、自由時間 1日2〜5時間 など）から、
//   限界効用が λ になる時間が研究の示す最適域に入るように決めている。

import type { ActivityKey } from './types'

export interface ActivityPrior {
  /** 最初の1時間の価値（点/時間）の事前中央値 */
  w: number
  /** log(w) の標準偏差 */
  wSd: number
  /** 頭打ちの目安（時間/週）の事前中央値 */
  S: number
  /** log(S) の標準偏差 */
  SSd: number
  sources: string[]
}

/** 自由時間1時間の限界的な価値の目安（点/時間） */
export const LAMBDA_TIME = 0.015

export const PRIORS = {
  activity: {
    // 睡眠は「1日5時間（週35時間）を超えた分」に対する効用
    sleep: { w: 0.09, wSd: 0.45, S: 10, SSd: 0.3, sources: ['sleep-guideline', 'time-use-jp'] },
    friends: { w: 0.075, wSd: 0.55, S: 5, SSd: 0.4, sources: ['drm', 'helliwell-huang', 'hall-friendship', 'sharif-time'] },
    // パートナーがいる場合の値。一人暮らしの時期は family の w×0.7・S×0.5（親や親族と過ごす時間）に切り替える
    family: { w: 0.05, wSd: 0.5, S: 10, SSd: 0.4, sources: ['drm', 'harvard-study', 'lucas-marriage'] },
    hobby: { w: 0.06, wSd: 0.45, S: 6, SSd: 0.4, sources: ['drm', 'sharif-time'] },
    // テレビ・SNS（DRM では平均並み）と「くつろぎ」（DRM で2番目に楽しい）をまとめた区分なので頭打ちは8時間
    rest: { w: 0.045, wSd: 0.45, S: 8, SSd: 0.4, sources: ['drm', 'sharif-time', 'social-media'] },
    exercise: { w: 0.105, wSd: 0.5, S: 2.5, SSd: 0.3, sources: ['chekroud-exercise'] },
    learning: { w: 0.03, wSd: 0.6, S: 4, SSd: 0.45, sources: ['drm'] },
  } satisfies Record<ActivityKey, ActivityPrior>,
  fixed: {
    /** 休息（受け身の余暇）の疲労・後悔（点/時間） */
    restFatigue: 0.002,
    /** 家族の時間の混み合い（点/時間） */
    familyFatigue: 0.001,
    /** 一人暮らしの時期の「家族と過ごす時間」の w・S の倍率（親・親族との時間） */
    familySingleW: 0.7,
    familySingleS: 0.5,
    /** 運動のやりすぎによる疲労（点/時間） */
    exerciseFatigue: 0.012,
    /** 睡眠の取りすぎ（点/時間） */
    sleepFatigue: 0.0045,
    /** 趣味の疲労（点/時間） */
    hobbyFatigue: 0.00075,
    /** 一人の受け身の時間（休息＋趣味）がこれを超えると満足度が下がり始める（時間/週） */
    soloCap: 35,
    soloPenalty: 0.0045,
    /** 家事1時間あたりの負担感（点/時間） */
    houseworkDislike: 0.003,
    /** 仕事がもたらす所属・役割・生活リズム（収入とは別、点）：E·(1 − e^{−h/S}) */
    employmentMax: 0.54,
    employmentS: 6,
    /** 一人暮らしで家族と過ごせる時間の上限（時間/週） */
    familyMaxSingle: 10,
  },
  money: {
    beta: 0.45,
    betaSd: 0.4,
    eta: 1.15,
    etaSd: 0.17,
    /** 等価消費の基準（円/月/等価人数）。家賃を含む消費なので、等価可処分所得の中央値 約254万円/年 から貯蓄を除いた水準 */
    cRef: 195_000,
    secMax: 0.4,
    secMaxSd: 0.5,
    secM: 3,
    secMSd: 0.45,
    betaSources: ['income-slope', 'killingsworth', 'kahneman-deaton', 'kkm-2023', 'cao-satisfaction'],
    etaSources: ['layard-eta', 'gandelman-eta'],
    secSources: ['ruberton', 'vanguard-emergency'],
  },
  work: {
    /** 仕事そのものの楽しさ（点/時間）。DRM では仕事は平均的な活動より約0.45不快 × 換算係数 0.0105 */
    joy: -0.0045,
    joySd: 0.006,
    /**
     * 長時間労働のつらさ：c·max(0, h − 48)²（55時間 −0.05点、60時間 −0.14点、65時間 −0.29点）。
     * 失われる余暇の分は時間の側で数えるので、ここはストレス・疲労の上乗せだけ
     */
    overwork: 0.001,
    overworkSd: 0.5,
    overworkFrom: 48,
    /** 通勤そのもののつらさ（失われる時間とは別、点/時間） */
    commute: 0.006,
    commuteSd: 0.5,
    /** 仕事の好き度 1段階あたりの1時間の楽しさの差（点/時間） */
    jobJoyPerStep: 0.003,
    /** パートタイムの時給 ÷ フルタイムの時給（賃金構造基本統計調査 2025：1,518円 ÷ 約2,090円） */
    partTimeWageRatio: 0.73,
    sources: ['drm', 'work-hours', 'kamerade-employment', 'who-long-hours', 'unemployment'],
    commuteSources: ['stutzer-frey', 'clark-commute'],
  },
  spend: {
    experience: { max: 0.06, sd: 0.6, scale: 40_000 },
    goods: { max: 0.015, sd: 0.7, scale: 30_000 },
    social: { max: 0.1, sd: 0.7, scale: 8_000 },
    /** 家事代行などで家事1時間を買う価格（円） */
    timeBuyYenPerHour: 3000,
    /** 家事のうち外注・時短できる最大割合 */
    timeBuyMaxShare: 0.5,
    sources: ['experiential', 'prosocial', 'buying-time'],
  },
  noise: {
    tau: 0.03,
    tauSd: 0.6,
    sources: ['benjamin-sp'],
  },
  life: {
    /** 結婚・同居：前年の期待（点）、その年の上乗せ（点）、慣れの時定数（年）、長期的な上乗せ（点） */
    marriageAnticipation: 0.15,
    marriagePeak: 0.3,
    marriageAdaptYears: 1.5,
    marriageLong: 0.05,
    /** 出産：第1子・第2子の前年の期待と、その年の上乗せ（点）。第3子以降は0 */
    birthAnticipation: [0.15, 0.05],
    birthPeak: [0.3, 0.15],
    birthAdaptYears: 1,
    /**
     * 子ども1人あたり、時間・お金の負担とは別の満足（意味・喜び）（点）。第2子以降は半分。
     * 平均的な親で「末子が0〜5歳の間は差し引き −0.1点前後、その後は 0 前後」になるよう校正（docs/MODEL.md）
     */
    childMeaning: 0.28,
    /** 育児1時間あたりの満足（点/時間）。家事より楽しく、一部は「子どもと過ごす家族の時間」でもある */
    childcarePerHour: 0.003,
    /** 1人あたり週25時間を超える育児の疲労（点/時間） */
    childcareFatigueFrom: 25,
    childcareFatigue: 0.006,
    /** 介護：週20時間以上は −0.3点、週10時間未満は −0.05点（慣れない） */
    caregivingHeavy: -0.3,
    caregivingLight: -0.05,
    /**
     * 引退後の「仕事の所属感」の扱い。仕事の所属感（employmentMax）は失われ、その代わりにこの値を足す。
     * 研究では60歳以降の自発的な引退は満足度にほぼ中立〜わずかにプラス（Bonsang & Klein 2012、日本の男性ではプラス）。
     * このモデルでは自由時間の増加と仕事のつらさがなくなる分がすでに入るので、引退前後の変化が
     * 平均的な人で +0.1点前後になるよう 0 に校正（docs/MODEL.md）。
     */
    retirementVoluntary: 0,
    /** 60歳より前に自分で選んで働かない（早期リタイア）：周囲の規範とのずれなどで少し下がる（点） */
    earlyNonwork: -0.15,
    /** 「引退後も所属感が保たれる」とみなす年齢 */
    normalRetireAge: 60,
  },
}
