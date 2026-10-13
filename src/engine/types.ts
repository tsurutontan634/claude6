// エンジン全体で共有する型。UI には依存しない。

/** 週の自由時間から配分を最適化する活動 */
export type ActivityKey = 'sleep' | 'friends' | 'family' | 'hobby' | 'rest' | 'exercise' | 'learning'

export const ACTIVITY_KEYS: readonly ActivityKey[] = [
  'sleep',
  'friends',
  'family',
  'hobby',
  'rest',
  'exercise',
  'learning',
] as const

/** 自由に使えるお金（月額）の使い道 */
export type SpendKey = 'experience' | 'goods' | 'social' | 'timeBuy'

export const SPEND_KEYS: readonly SpendKey[] = ['experience', 'goods', 'social', 'timeBuy'] as const

export type Hours = Record<ActivityKey, number>
export type Spend = Record<SpendKey, number>

/**
 * 「1週間がずっとこうだったら」という定常状態の記述。
 * 時間は 時間/週、お金は 円/月（世帯）。
 */
export interface WeekState {
  hours: Hours
  workHours: number
  commuteHours: number
  /** 世帯の月間消費総額（必需品込み、教育費などの義務的支出は除く） */
  consumption: number
  /** 世帯人数（等価尺度 √n に使う） */
  householdSize: number
  /** 自由に使えるお金の内訳（consumption の一部） */
  spend: Spend
  /** 流動資産（何か月分の生活費か） */
  assetsMonths: number
  /** 家事の時間（時間/週、外注した分を除く） */
  houseworkHours: number
  /** 仕事の楽しさ補正（職業ごとの差、点/時間）。現職は 0 */
  jobJoyShift: number
}

export type Sex = 'male' | 'female' | 'other'

export interface JobOption {
  id: string
  name: string
  /** 額面年収（円） */
  annualIncome: number
  /** 実労働時間（時間/週、残業込み） */
  weeklyHours: number
  workDays: number
  commuteMinutesOneWay: number
  remoteDaysPerWeek: number
  /** 仕事そのものの好き度 1〜5 */
  enjoyment: number
  /** 労働時間を変えたとき収入が比例するか（時短・残業代） */
  hoursFlexible: boolean
  /** 残業代が出るか（出ないなら週40h超でも収入は増えない） */
  overtimePaid: boolean
}

export interface ChildPlan {
  /** 生まれる/生まれた年のユーザーの年齢（既にいる子は 現在の年齢 − 子の年齢） */
  parentAgeAtBirth: number
  /** 大学まで私立か公立か（費用に影響） */
  schooling: 'public' | 'mixed' | 'private'
}

export interface Profile {
  version: 1
  age: number
  sex: Sex
  /** 今の人生満足度 0〜10 */
  lifeSatisfaction: number
  hasPartner: boolean
  /** パートナーの手取りではなく額面年収（円） */
  partnerIncome: number
  /** 結婚・同居予定の年齢（予定なしなら null） */
  partnerPlanAge: number | null
  children: ChildPlan[]
  jobs: JobOption[]
  currentJobId: string
  /** 金融資産（円） */
  savings: number
  /** 毎月の貯蓄額（円） */
  monthlySaving: number
  /** 家賃・光熱費・食費など必需的支出（世帯・月額・円） */
  necessities: number
  /** 現在の時間の使い方（時間/週） */
  currentHours: Hours
  /** 家事（時間/週） */
  housework: number
  /** 食事・入浴・身支度など（時間/週） */
  personalCare: number
  /** 自由に使えるお金（手取り − 必需的支出 − 貯蓄）の使い道の割合（%、合計100） */
  spendShare: Spend
  /** 育児・家事のうち自分が担う割合（0〜1） */
  careShare: number
  /** 活動ごとの好き度 1〜5（事前分布の個人補正） */
  liking: Record<ActivityKey, number>
  /** 引退したい年齢 */
  retireAge: number
  /** 年金の受給開始年齢 */
  pensionAge: number
  /** 介護などその他の義務的時間（時間/週） */
  otherDuties: number
  /** すでに受け取っている公的年金（額面・年額、円）。まだなら 0 */
  pensionNow: number
  /** 仕事以外の収入（手取り・年額、円）：家賃収入・仕送り・副業など */
  otherIncome: number
  /** 共働きなどで保育所・学童を使うか */
  daycare: boolean
  /** 親の介護の見込み（なければ null） */
  caregiving: { startAge: number; years: number; hoursPerWeek: number } | null
}

/** 5段階回答：0=Bがかなり良い … 2=同じくらい … 4=Aがかなり良い */
export type Response = 0 | 1 | 2 | 3 | 4

export type TemplateKey =
  | 'timeSwap'
  | 'timeVsMoney'
  | 'workTradeoff'
  | 'moneyCurvature'
  | 'sleepTradeoff'
  | 'spendMix'
  | 'timeBuying'
  | 'security'
  | 'commute'
  | 'saturation'
  | 'check'

export interface Question {
  id: string
  template: TemplateKey
  /** 画面に出す前置き（例: 仮に月の手取りが50万円だとしたら） */
  context: string[]
  a: WeekState
  b: WeekState
  /** 選択肢の説明（箇条書き） */
  textA: string[]
  textB: string[]
  /** 何を測るための質問か（「なぜこの質問？」用） */
  purpose: string
}

export interface Answer {
  question: Question
  response: Response
  /** ms since epoch */
  at: number
}
