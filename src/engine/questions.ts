// 1対1質問の生成
//
// どの質問も「これから毎週がずっとこうだとしたら、どちらの生活が幸せか」を聞く。
// A と B で違う項目は 2〜3個までに絞り、残りは「今と同じ」とする（属性を増やしすぎると回答がぶれる）。
// テンプレートごとに測りたいパラメータが違う：
//   timeSwap       … 活動どうしの相対的な価値（w と S）
//   timeVsMoney    … 活動の価値をお金の価値（β）と比べる
//   workTradeoff   … 労働時間と収入（仕事の楽しさ・長時間労働のつらさ）
//   moneyCurvature … 収入水準が違うときのお金の価値（η：頭打ちの強さ）
//   sleepTradeoff  … 睡眠
//   spendMix       … 体験・モノ・人のための支出の上乗せ効果
//   timeBuying     … 時間を買う支出
//   security       … 貯金の安心感
//   commute        … 通勤の負担
//   check          … 明らかに良い方がある確認用（回答の丁寧さ）

import type { ActivityKey, Question, Spend, TemplateKey, WeekState } from './types'
import { ACTIVITY_KEYS } from './types'
import type { Rng } from './rng'
import { ACTIVITIES } from './model'
import type { TimeLimits } from './week'
import { hoursWeek, sleepPerNight, trimNum, yen } from './format'

export interface QuestionContext {
  /** 今の生活（定常状態） */
  base: WeekState
  /** 自分の労働時間 h のときの、世帯の月間消費（手取り − 貯蓄 − 義務的支出） */
  consumptionAtHours(workHours: number): number
  /** 労働時間 h のときの通勤時間（週） */
  commuteAtHours(workHours: number): number
  /** 1日あたり通勤（往復）の時間と、出社日数 */
  commuteDays: number
  commuteMinutesOneWay: number
  necessities: number
  limits: TimeLimits
  /** 体験・モノ・人のための支出の比率（合計1） */
  spendWeights: [number, number, number]
  timeBuyYenPerHour: number
  timeBuyMaxShare: number
  housework: number
  /** 今の仕事で労働時間を変えられるか（変えられないなら「仮に」と前置きする） */
  hoursFlexible: boolean
}

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  timeSwap: '時間の使い方',
  timeVsMoney: '時間とお金',
  workTradeoff: '働き方',
  moneyCurvature: 'お金の頭打ち',
  sleepTradeoff: '睡眠',
  spendMix: 'お金の使い道',
  timeBuying: '時間を買う',
  security: '貯金と安心',
  commute: '通勤',
  saturation: '頭打ち',
  check: '確認',
}

const FREE_ACTS: ActivityKey[] = ['friends', 'family', 'hobby', 'rest', 'exercise', 'learning']
const WEEKS_PER_MONTH = 4.345

// ---------------------------------------------------------------------------
// 状態の操作
// ---------------------------------------------------------------------------

export function cloneState(s: WeekState): WeekState {
  return { ...s, hours: { ...s.hours }, spend: { ...s.spend } }
}

function withinLimits(ctx: QuestionContext, k: ActivityKey, h: number): boolean {
  return h >= ctx.limits.min[k] - 1e-9 && h <= ctx.limits.max[k] + 1e-9
}

/** お金（月額）を増減させる。自由に使えるお金の配分比率に応じて内訳も動かす */
export function addMoney(ctx: QuestionContext, s: WeekState, delta: number): WeekState {
  const t = cloneState(s)
  t.consumption = Math.max(1, s.consumption + delta)
  const [we, wg, ws] = ctx.spendWeights
  t.spend.experience = Math.max(0, s.spend.experience + delta * we)
  t.spend.goods = Math.max(0, s.spend.goods + delta * wg)
  t.spend.social = Math.max(0, s.spend.social + delta * ws)
  return t
}

/** 消費水準を仮の値 C に置き換える（内訳は比例で伸縮） */
export function withConsumption(ctx: QuestionContext, s: WeekState, C: number): WeekState {
  const t = cloneState(s)
  const D0 = Math.max(0, s.consumption - ctx.necessities)
  const D1 = Math.max(0, C - ctx.necessities)
  const r = D0 > 0 ? D1 / D0 : 0
  t.consumption = C
  if (D0 > 0) {
    t.spend.experience = s.spend.experience * r
    t.spend.goods = s.spend.goods * r
    t.spend.social = s.spend.social * r
  } else {
    const [we, wg, ws] = ctx.spendWeights
    t.spend.experience = D1 * we
    t.spend.goods = D1 * wg
    t.spend.social = D1 * ws
  }
  return t
}

// ---------------------------------------------------------------------------
// 表示用テキスト
// ---------------------------------------------------------------------------

function actLabel(k: ActivityKey): string {
  return ACTIVITIES[k].label
}

function describeHours(k: ActivityKey, before: number, after: number): string {
  if (k === 'sleep') {
    if (Math.abs(before - after) < 1e-9) return `睡眠：${sleepPerNight(after)}（今のまま）`
    return `睡眠：${sleepPerNight(before)} → ${sleepPerNight(after)}`
  }
  if (Math.abs(before - after) < 1e-9) return `${actLabel(k)}：${hoursWeek(after)}（今のまま）`
  const d = after - before
  return `${actLabel(k)}：${hoursWeek(before)} → ${hoursWeek(after)}（${d > 0 ? '+' : '−'}${trimNum(Math.abs(d))}時間）`
}

function moneyLine(delta: number): string {
  return `毎月の自由に使えるお金：${delta >= 0 ? '+' : '−'}${yen(Math.abs(delta))}`
}

// ---------------------------------------------------------------------------
// 乱数ユーティリティ
// ---------------------------------------------------------------------------

function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[rng.int(xs.length)]
}

function roundYen(v: number, unit = 5000): number {
  return Math.max(unit, Math.round(v / unit) * unit)
}

/** 時間の受け渡し元を選ぶ（休息 → 趣味 → その他 の順で余裕がある活動） */
function donorFor(ctx: QuestionContext, s: WeekState, exclude: ActivityKey[], need: number): ActivityKey | null {
  const order: ActivityKey[] = ['rest', 'hobby', 'friends', 'family', 'learning', 'exercise']
  for (const k of order) {
    if (exclude.includes(k)) continue
    if (s.hours[k] - need >= ctx.limits.min[k] - 1e-9) return k
  }
  return null
}

let qCounter = 0
function qid(t: TemplateKey): string {
  qCounter = (qCounter + 1) % 1_000_000
  return `${t}-${Date.now().toString(36)}-${qCounter}`
}

// ---------------------------------------------------------------------------
// テンプレート
// ---------------------------------------------------------------------------

/** 仮の水準（頭打ちを測るため、今と違う時間量を前提にする） */
function maybeHypotheticalLevel(
  ctx: QuestionContext,
  rng: Rng,
  s: WeekState,
  k: ActivityKey,
  context: string[],
  prob = 0.35,
): WeekState {
  if (rng.next() > prob) return s
  const maxH = Math.min(ctx.limits.max[k], k === 'exercise' ? 12 : 30)
  const levels = [0, 1, 2, 4, 6, 8, 12, 16, 20, 25, 30].filter((v) => v <= maxH && Math.abs(v - s.hours[k]) >= 2)
  if (levels.length === 0) return s
  const L = pick(rng, levels)
  const t = cloneState(s)
  t.hours[k] = L
  context.push(`仮に、今の「${actLabel(k)}」が${hoursWeek(L)}だとします。`)
  return t
}

function timeSwap(ctx: QuestionContext, rng: Rng): Question | null {
  const i = pick(rng, FREE_ACTS)
  const j = pick(rng, FREE_ACTS.filter((k) => k !== i))
  const context: string[] = []
  const base = maybeHypotheticalLevel(ctx, rng, ctx.base, i, context)
  const delta = pick(rng, [1, 2, 3, 4, 5, 6, 8])
  const hi = base.hours[i] + delta
  const hj = base.hours[j] - delta
  if (!withinLimits(ctx, i, hi) || !withinLimits(ctx, j, hj)) return null
  const a = cloneState(base)
  a.hours[i] = hi
  a.hours[j] = hj
  return {
    id: qid('timeSwap'),
    template: 'timeSwap',
    context,
    a,
    b: base,
    textA: [describeHours(i, base.hours[i], hi), describeHours(j, base.hours[j], hj)],
    textB: [describeHours(i, base.hours[i], base.hours[i]), describeHours(j, base.hours[j], base.hours[j])],
    purpose: `「${actLabel(i)}」と「${actLabel(j)}」のどちらに時間を使うと幸せかを比べています。`,
  }
}

function timeVsMoney(ctx: QuestionContext, rng: Rng): Question | null {
  const i = pick(rng, FREE_ACTS.filter((k) => k !== 'rest'))
  const context: string[] = []
  const base = maybeHypotheticalLevel(ctx, rng, ctx.base, i, context)
  const delta = pick(rng, [1, 2, 3, 4, 6])
  const donor = donorFor(ctx, base, [i], delta)
  if (!donor || !withinLimits(ctx, i, base.hours[i] + delta)) return null
  const money = roundYen(base.consumption * pick(rng, [0.02, 0.04, 0.07, 0.1, 0.15, 0.2]))
  const a = cloneState(base)
  a.hours[i] += delta
  a.hours[donor] -= delta
  const b = addMoney(ctx, base, money)
  return {
    id: qid('timeVsMoney'),
    template: 'timeVsMoney',
    context,
    a,
    b,
    textA: [describeHours(i, base.hours[i], a.hours[i]), `（その分、${actLabel(donor)}が${trimNum(delta)}時間減る）`],
    textB: [moneyLine(money), `（${actLabel(i)}は${hoursWeek(base.hours[i])}のまま）`],
    purpose: `「${actLabel(i)}」の時間をお金に換算するといくらの価値かを測っています。`,
  }
}

function workTradeoff(ctx: QuestionContext, rng: Rng): Question | null {
  const H = ctx.base.workHours
  if (H <= 0) return null
  const d = pick(rng, [-10, -8, -5, -4, -2, 2, 4, 5, 8, 10])
  const H2 = H + d
  if (H2 < 8 || H2 > 72) return null
  const context: string[] = []
  if (!ctx.hoursFlexible) context.push('仮に、今の仕事で労働時間を調整でき、時給は変わらないとします。')
  const a = cloneState(ctx.base)
  a.workHours = H2
  a.commuteHours = ctx.commuteAtHours(H2)
  const dC = ctx.consumptionAtHours(H2) - ctx.consumptionAtHours(H)
  const moved = addMoney(ctx, a, dC)
  a.consumption = moved.consumption
  a.spend = moved.spend
  // 増減した時間（労働＋通勤）をどの活動で吸収するか
  const freed = H - H2 + (ctx.base.commuteHours - a.commuteHours)
  const lines: string[] = [
    `仕事：${hoursWeek(H)} → ${hoursWeek(H2)}`,
    `毎月の使えるお金（世帯）：${dC >= 0 ? '+' : '−'}${yen(Math.abs(dC))}`,
  ]
  if (Math.abs(a.commuteHours - ctx.base.commuteHours) > 1e-9) {
    lines.push(`通勤：${hoursWeek(ctx.base.commuteHours)} → ${hoursWeek(a.commuteHours)}`)
  }
  if (freed > 0) {
    const targets = pick(rng, [['hobby', 'friends'], ['rest', 'hobby'], ['family', 'hobby'], ['friends', 'rest'], ['exercise', 'hobby']] as ActivityKey[][])
    const per = freed / targets.length
    for (const k of targets) {
      if (!withinLimits(ctx, k, a.hours[k] + per)) return null
      a.hours[k] += per
    }
    lines.push(`増えた時間は「${actLabel(targets[0])}」と「${actLabel(targets[1])}」に半分ずつ`)
  } else if (freed < 0) {
    let need = -freed
    const takenFrom: string[] = []
    for (const k of ['rest', 'hobby', 'friends', 'family'] as ActivityKey[]) {
      const can = Math.min(need, a.hours[k] - ctx.limits.min[k])
      if (can > 0) {
        a.hours[k] -= can
        need -= can
        takenFrom.push(actLabel(k))
      }
      if (need <= 1e-9) break
    }
    if (need > 1e-9) return null
    lines.push(`減った時間は「${takenFrom.join('」「')}」から削る`)
  }
  return {
    id: qid('workTradeoff'),
    template: 'workTradeoff',
    context,
    a,
    b: ctx.base,
    textA: lines,
    textB: [`仕事：${hoursWeek(H)}（今のまま）`, '使えるお金・自由時間も今のまま'],
    purpose: '労働時間を増やして収入を取るか、減らして時間を取るか。仕事そのものの楽しさと長時間労働のつらさを測っています。',
  }
}

function moneyCurvature(ctx: QuestionContext, rng: Rng): Question | null {
  const mult = pick(rng, [0.5, 0.7, 1.5, 2, 3, 4])
  const C = Math.max(ctx.necessities + 30_000, roundYen(ctx.base.consumption * mult, 10_000))
  const base = withConsumption(ctx, ctx.base, C)
  const i = pick(rng, ['friends', 'hobby', 'family', 'rest'] as ActivityKey[])
  const delta = pick(rng, [2, 3, 4, 6])
  const donor = donorFor(ctx, base, [i], delta)
  if (!donor || !withinLimits(ctx, i, base.hours[i] + delta)) return null
  const money = roundYen(C * pick(rng, [0.03, 0.06, 0.1, 0.15]))
  const a = cloneState(base)
  a.hours[i] += delta
  a.hours[donor] -= delta
  const b = addMoney(ctx, base, money)
  return {
    id: qid('moneyCurvature'),
    template: 'moneyCurvature',
    context: [`仮に、世帯の毎月の生活費（貯金を除いて使えるお金）が${yen(C)}の暮らしだとします。`],
    a,
    b,
    textA: [describeHours(i, base.hours[i], a.hours[i]), `（その分、${actLabel(donor)}が${trimNum(delta)}時間減る）`],
    textB: [moneyLine(money)],
    purpose: '収入が多い・少ない暮らしで、お金の価値がどれくらい変わるか（お金の頭打ち）を測っています。',
  }
}

function sleepTradeoff(ctx: QuestionContext, rng: Rng): Question | null {
  const perNight = pick(rng, [-1, -0.5, 0.5, 1])
  const delta = perNight * 7
  const k = pick(rng, ['hobby', 'rest', 'friends', 'family'] as ActivityKey[])
  const s = ctx.base
  const sl = s.hours.sleep + delta
  const hk = s.hours[k] - delta
  if (!withinLimits(ctx, 'sleep', sl) || !withinLimits(ctx, k, hk)) return null
  const a = cloneState(s)
  a.hours.sleep = sl
  a.hours[k] = hk
  return {
    id: qid('sleepTradeoff'),
    template: 'sleepTradeoff',
    context: [],
    a,
    b: s,
    textA: [describeHours('sleep', s.hours.sleep, sl), describeHours(k, s.hours[k], hk)],
    textB: [describeHours('sleep', s.hours.sleep, s.hours.sleep), describeHours(k, s.hours[k], s.hours[k])],
    purpose: '睡眠時間と起きている時間の楽しみのバランスを測っています。',
  }
}

const SPEND_TEXT: Record<'experience' | 'goods' | 'social', string> = {
  experience: '体験（旅行・外食・ライブ・習い事など）に使う',
  goods: 'モノ（服・ガジェット・インテリアなど）を買う',
  social: '人のため（プレゼント・ごちそう・寄付など）に使う',
}

function spendMix(ctx: QuestionContext, rng: Rng): Question | null {
  const cats = ['experience', 'goods', 'social'] as const
  const c1 = pick(rng, cats)
  const c2 = pick(rng, cats.filter((c) => c !== c1))
  const Y = pick(rng, [10_000, 20_000, 30_000, 50_000])
  const base = ctx.base
  const a = cloneState(base)
  a.consumption += Y
  a.spend[c1] += Y
  const b = cloneState(base)
  b.consumption += Y
  b.spend[c2] += Y
  return {
    id: qid('spendMix'),
    template: 'spendMix',
    context: [`毎月${yen(Y)}の臨時収入がずっと続くとします。`],
    a,
    b,
    textA: [`すべて${SPEND_TEXT[c1]}`],
    textB: [`すべて${SPEND_TEXT[c2]}`],
    purpose: '同じ金額でも、何に使うと幸せが大きいか（体験・モノ・人のため）を測っています。',
  }
}

function timeBuying(ctx: QuestionContext, rng: Rng): Question | null {
  const Y = pick(rng, [10_000, 20_000, 30_000, 50_000])
  const hoursBought = Y / WEEKS_PER_MONTH / ctx.timeBuyYenPerHour
  if (hoursBought > ctx.housework * ctx.timeBuyMaxShare) return null
  const k = pick(rng, ['hobby', 'friends', 'family', 'rest'] as ActivityKey[])
  const base = ctx.base
  if (!withinLimits(ctx, k, base.hours[k] + hoursBought)) return null
  const a = cloneState(base)
  a.consumption += Y
  a.spend.timeBuy += Y
  a.hours[k] += hoursBought
  a.houseworkHours = Math.max(0, base.houseworkHours - hoursBought)
  const b = cloneState(base)
  b.consumption += Y
  b.spend.experience += Y
  return {
    id: qid('timeBuying'),
    template: 'timeBuying',
    context: [`毎月${yen(Y)}の臨時収入がずっと続くとします。`],
    a,
    b,
    textA: [
      `家事代行や時短サービスに使い、家事が週${trimNum(hoursBought)}時間減る`,
      `空いた時間は「${actLabel(k)}」に（${hoursWeek(base.hours[k])} → ${hoursWeek(a.hours[k])}）`,
    ],
    textB: ['体験（旅行・外食など）に使う', '家事の時間は今のまま'],
    purpose: 'お金で時間を買うことの価値を測っています。',
  }
}

function security(ctx: QuestionContext, rng: Rng): Question | null {
  const levels = [0, 1, 3, 6, 12, 24, 48]
  const m1 = pick(rng, levels.slice(1))
  const m2 = pick(rng, levels.filter((v) => v < m1))
  const Y = roundYen(ctx.base.consumption * pick(rng, [0.03, 0.06, 0.1, 0.15]))
  const a = cloneState(ctx.base)
  a.assetsMonths = m1
  const b = addMoney(ctx, ctx.base, Y)
  b.assetsMonths = m2
  const mtext = (m: number) => (m === 0 ? '貯金：ほぼゼロ' : `貯金：生活費の${m}か月分（約${yen(ctx.base.consumption * m, 0)}）`)
  return {
    id: qid('security'),
    template: 'security',
    context: ['次の状態がずっと続くとします（貯金額は増えも減りもしない）。'],
    a,
    b,
    textA: [mtext(m1), '毎月の自由に使えるお金：今のまま'],
    textB: [mtext(m2), moneyLine(Y)],
    purpose: '貯金があることの安心感を、毎月使えるお金と比べています。',
  }
}

function commute(ctx: QuestionContext, rng: Rng): Question | null {
  if (ctx.commuteDays <= 0 || ctx.base.workHours <= 0) return null
  const dMin = pick(rng, [-30, -20, -15, 15, 20, 30, 45])
  const newMin = ctx.commuteMinutesOneWay + dMin
  if (newMin < 0 || newMin > 120) return null
  const dHours = (dMin * 2 * ctx.commuteDays) / 60
  const money = roundYen(ctx.base.consumption * pick(rng, [0.03, 0.05, 0.08, 0.12]))
  const s = ctx.base
  const a = cloneState(s)
  a.commuteHours = s.commuteHours + dHours
  const k: ActivityKey = 'rest'
  const k2: ActivityKey = 'hobby'
  // 通勤が延びた分は休息と趣味から半分ずつ、縮んだ分は半分ずつ足す
  a.hours[k] -= dHours / 2
  a.hours[k2] -= dHours / 2
  if (!withinLimits(ctx, k, a.hours[k]) || !withinLimits(ctx, k2, a.hours[k2])) return null
  const moved = addMoney(ctx, a, dMin > 0 ? money : -money)
  a.consumption = moved.consumption
  a.spend = moved.spend
  return {
    id: qid('commute'),
    template: 'commute',
    context: dMin > 0 ? ['家賃が安い場所への引っ越し、または給料の良い職場への転職を考えています。'] : ['職場に近い場所への引っ越し（家賃が上がる）を考えています。'],
    a,
    b: s,
    textA: [
      `通勤：片道${ctx.commuteMinutesOneWay}分 → ${newMin}分（週${trimNum(Math.abs(dHours))}時間${dMin > 0 ? '増' : '減'}）`,
      dMin > 0 ? moneyLine(money) : moneyLine(-money),
      `（通勤の増減分は「休息」と「趣味」で半分ずつ調整）`,
    ],
    textB: [`通勤：片道${ctx.commuteMinutesOneWay}分（今のまま）`, '使えるお金も今のまま'],
    purpose: '通勤時間のつらさをお金に換算しています。',
  }
}

function check(ctx: QuestionContext, rng: Rng): Question | null {
  const Y = roundYen(ctx.base.consumption * pick(rng, [0.1, 0.15]))
  const a = addMoney(ctx, ctx.base, Y)
  const swap = rng.next() < 0.5
  return {
    id: qid('check'),
    template: 'check',
    context: ['確認のための質問です。'],
    a: swap ? ctx.base : a,
    b: swap ? a : ctx.base,
    textA: swap ? ['今のまま'] : [moneyLine(Y), 'それ以外は今のまま'],
    textB: swap ? [moneyLine(Y), 'それ以外は今のまま'] : ['今のまま'],
    purpose: '答えがはっきりしている質問で、回答のぶれ具合を確かめています。',
  }
}

export const TEMPLATES: Record<Exclude<TemplateKey, 'saturation'>, (ctx: QuestionContext, rng: Rng) => Question | null> = {
  timeSwap,
  timeVsMoney,
  workTradeoff,
  moneyCurvature,
  sleepTradeoff,
  spendMix,
  timeBuying,
  security,
  commute,
  check,
}

/** 候補として出す割合（相対的な重み） */
export const TEMPLATE_WEIGHTS: Record<Exclude<TemplateKey, 'saturation'>, number> = {
  timeSwap: 4,
  timeVsMoney: 4,
  workTradeoff: 2,
  moneyCurvature: 2,
  sleepTradeoff: 1,
  spendMix: 0.5,
  timeBuying: 1,
  security: 1.5,
  commute: 1,
  check: 0,
}

/** 候補質問をまとめて作る */
export function generateCandidates(ctx: QuestionContext, rng: Rng, count: number): Question[] {
  const keys = Object.keys(TEMPLATE_WEIGHTS) as (keyof typeof TEMPLATE_WEIGHTS)[]
  const total = keys.reduce((s, k) => s + TEMPLATE_WEIGHTS[k], 0)
  const out: Question[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 10) {
    let r = rng.next() * total
    let key = keys[0]
    for (const k of keys) {
      r -= TEMPLATE_WEIGHTS[k]
      if (r <= 0) {
        key = k
        break
      }
    }
    const q = TEMPLATES[key](ctx, rng)
    if (q) out.push(q)
  }
  return out
}

/** 同じ質問を何度も出さないための署名 */
export function questionSignature(q: Question): string {
  const f = (s: WeekState) =>
    [
      ...ACTIVITY_KEYS.map((k) => s.hours[k].toFixed(2)),
      s.workHours.toFixed(1),
      s.commuteHours.toFixed(1),
      Math.round(s.consumption / 1000),
      Math.round(s.assetsMonths),
      ...(['experience', 'goods', 'social', 'timeBuy'] as (keyof Spend)[]).map((k) => Math.round(s.spend[k] / 1000)),
    ].join(',')
  // A と B を入れ替えて出した質問も同じ質問とみなす（順序に依存しない署名）
  const x = f(q.a)
  const y = f(q.b)
  return `${q.template}|${x < y ? `${x}|${y}` : `${y}|${x}`}`
}
