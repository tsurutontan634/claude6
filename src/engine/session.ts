// エンジンの窓口：プロフィール＋回答 → 事後分布 → 次の質問・最適な1週間・人生計画

import type { Answer, JobOption, Profile, Question, Response, TemplateKey, WeekState } from './types'
import { ACTIVITY_KEYS } from './types'
import { N_PARAMS, P_S, P_W, P_WORKJOY, PARAM_DEFS, utility } from './model'
import { ParticlePosterior, type CompiledAnswer } from './posterior'
import { compileDiff } from './diff'
import { createRng, hashSeed } from './rng'
import { generateCandidates, questionSignature, TEMPLATES } from './questions'
import { selectQuestion, predictiveDistribution } from './design'
import {
  commuteAtHours,
  currentJob,
  currentLife,
  grossAtHours,
  hasFamilyAt,
  householdAt,
  householdNetAnnual,
  jobJoyShift,
  likingMultiplier,
  limitsFor,
  questionContext,
  type CurrentLife,
} from './household'
import { UtilityKit, type WeekOutcome } from './kit'
import { expectedUtility } from './week'
import { PRIORS } from './priors'

export const DRAWS_FOR_DESIGN = 300
export const DRAWS_FOR_PLAN = 400

/** プロフィールに応じて個人補正した事前分布（z 空間の平均と標準偏差） */
export function personalPrior(p: Profile): { mu: Float64Array; sd: Float64Array } {
  const mu = Float64Array.from(PARAM_DEFS.map((d) => d.mu))
  const sd = Float64Array.from(PARAM_DEFS.map((d) => d.sd))
  ACTIVITY_KEYS.forEach((k, i) => {
    mu[P_W + i] += Math.log(likingMultiplier(p.liking[k]))
  })
  // 一人暮らしの時期は「家族と過ごす時間」＝親や親族との時間なので、価値と頭打ちを小さめにする
  if (!hasFamilyAt(p, p.age)) {
    const i = ACTIVITY_KEYS.indexOf('family')
    mu[P_W + i] += Math.log(PRIORS.fixed.familySingleW)
    mu[P_S + i] += Math.log(PRIORS.fixed.familySingleS)
  }
  // 仕事の好き度（1〜5、3が普通）で仕事の楽しさの事前平均をずらす
  const job = currentJob(p)
  mu[P_WORKJOY] += (job.enjoyment - 3) * PRIORS.work.jobJoyPerStep
  return { mu, sd }
}

export function compileAnswer(a: Answer): CompiledAnswer {
  return { diff: compileDiff(a.question.a, a.question.b), r: a.response }
}

export interface SessionOptions {
  particles?: number
}

export class Session {
  posterior: ParticlePosterior
  answers: Answer[] = []
  private usedSignatures = new Set<string>()
  /** 事後分布からのサンプルのキャッシュ（粒子数 k ごと。回答や事前分布が変わったら消す） */
  private drawsCache = new Map<number, Float64Array>()

  constructor(
    public profile: Profile,
    private opts: SessionOptions = {},
  ) {
    this.posterior = this.freshPosterior()
  }

  private freshPosterior(): ParticlePosterior {
    const { mu, sd } = personalPrior(this.profile)
    return new ParticlePosterior(mu, sd, { particles: this.opts.particles ?? 2000, seed: hashSeed('life-utility') })
  }

  /** プロフィールが変わったら事前分布から作り直し、回答を再適用する */
  setProfile(p: Profile, onProgress?: (f: number) => void): void {
    this.profile = p
    this.posterior = this.freshPosterior()
    this.drawsCache.clear()
    if (this.answers.length) this.posterior.rebuild(this.answers.map(compileAnswer), onProgress)
  }

  /** 回答を読み込み直す（非同期版：段階の合間に画面を更新できる） */
  async loadAnswersAsync(answers: Answer[], onProgress?: (f: number) => void): Promise<void> {
    this.answers = answers.slice()
    this.usedSignatures = new Set(answers.map((a) => questionSignature(a.question)))
    this.posterior = this.freshPosterior()
    this.drawsCache.clear()
    if (!answers.length) return
    for (const phi of this.posterior.rebuildSteps(answers.map(compileAnswer))) {
      onProgress?.(phi)
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  /**
   * プロフィールを変える。回答（比べた2つの生活の中身）はそのままなので、事前分布だけを差し替えて
   * 重要度で重みを付け直す。重みが偏りすぎたときだけ、回答から作り直す。
   */
  async setProfileAsync(p: Profile, onProgress?: (f: number) => void): Promise<void> {
    this.profile = p
    this.drawsCache.clear()
    const { mu, sd } = personalPrior(p)
    if (this.answers.length === 0) {
      this.posterior = this.freshPosterior()
      return
    }
    const ess = this.posterior.setPrior(mu, sd)
    if (ess < this.posterior.n * 0.05) await this.loadAnswersAsync(this.answers, onProgress)
  }

  /** 保存しておいた粒子から復元（回答が同じときだけ） */
  restore(answers: Answer[], data: Parameters<ParticlePosterior['restore']>[0]): boolean {
    this.answers = answers.slice()
    this.usedSignatures = new Set(answers.map((a) => questionSignature(a.question)))
    this.posterior = this.freshPosterior()
    this.drawsCache.clear()
    return this.posterior.restore(data, answers.map(compileAnswer))
  }

  loadAnswers(answers: Answer[], onProgress?: (f: number) => void): void {
    this.answers = answers.slice()
    this.usedSignatures = new Set(answers.map((a) => questionSignature(a.question)))
    this.posterior = this.freshPosterior()
    this.drawsCache.clear()
    if (answers.length) this.posterior.rebuild(answers.map(compileAnswer), onProgress)
  }

  answer(q: Question, r: Response): Answer {
    const a: Answer = { question: q, response: r, at: Date.now() }
    this.answers.push(a)
    this.usedSignatures.add(questionSignature(q))
    this.posterior.addAnswer(compileAnswer(a))
    this.drawsCache.clear()
    return a
  }

  /** 直前の回答を取り消す。直近の数問は保存した状態に即座に戻し、それより前は回答から作り直す */
  async undoAsync(onProgress?: (f: number) => void): Promise<Answer | null> {
    const last = this.answers.pop() ?? null
    if (!last) return null
    this.drawsCache.clear()
    if (this.posterior.undoLast()) {
      this.usedSignatures = new Set(this.answers.map((a) => questionSignature(a.question)))
      return last
    }
    await this.loadAnswersAsync(this.answers, onProgress)
    return last
  }

  /** 事後分布からの等重みサンプル（k × N_PARAMS） */
  draws(k: number): Float64Array {
    const hit = this.drawsCache.get(k)
    if (hit) return hit
    const thetas = this.posterior.draw(k, 1000 + this.answers.length)
    this.drawsCache.set(k, thetas)
    return thetas
  }

  /** 出題をスキップした質問（同じものを続けて出さない） */
  skip(q: Question): void {
    this.usedSignatures.add(questionSignature(q))
  }

  nextQuestion(salt = 0): { q: Question; eig: number; predictive: Float64Array } | null {
    const ctx = questionContext(this.profile)
    const n = this.answers.length
    const rng = createRng(hashSeed(`q-${n}-${salt}-${this.profile.age}`))
    // 30問ごとに1問、答えが明らかな確認問題
    if (salt === 0 && n > 0 && n % 30 === 15) {
      const q = TEMPLATES.check(ctx, rng)
      if (q) return { q, eig: 0, predictive: predictiveDistribution(this.draws(DRAWS_FOR_DESIGN), q) }
    }
    const thetas = this.draws(DRAWS_FOR_DESIGN)
    // 25問ごとに1問、20問以上前の質問を左右を入れ替えてもう一度（回答のぶれを測る）
    if (salt === 0 && n >= 25 && n % 25 === 20) {
      const old = this.answers[rng.int(n - 20)].question
      const q: Question = { ...old, id: `${old.id}-again-${n}`, a: old.b, b: old.a, textA: old.textB, textB: old.textA }
      return { q, eig: 0, predictive: predictiveDistribution(thetas, q) }
    }
    const candidates = generateCandidates(ctx, rng, 90)
    const recent: TemplateKey[] = this.answers
      .slice(-4)
      .reverse()
      .map((a) => a.question.template)
    const best = selectQuestion(thetas, candidates, recent, this.usedSignatures, questionSignature)
    if (!best) return null
    // 左右の位置の偏りを避けるため、半分の確率で A と B を入れ替える
    const q = rng.next() < 0.5 ? best.q : { ...best.q, a: best.q.b, b: best.q.a, textA: best.q.textB, textB: best.q.textA }
    return { q, eig: best.eig, predictive: predictiveDistribution(thetas, q) }
  }

  /** パラメータごとの「どれだけ分かったか」（0〜1）の平均 */
  confidence(): number {
    let s = 0
    for (let j = 0; j < N_PARAMS; j++) s += this.posterior.learned(j)
    return s / N_PARAMS
  }
}

// ---------------------------------------------------------------------------
// 1週間の最適化
// ---------------------------------------------------------------------------

export interface WeekPlan {
  job: JobOption
  workHours: number
  commuteHours: number
  /** 外注する前の家事時間（時間/週） */
  housework: number
  /** 収入が足りず、貯金を取り崩して暮らす前提か */
  drawingDown: boolean
  /** 睡眠などの最低限の時間が確保できるか */
  feasible: boolean
  /** 世帯の月間手取り（給与＋児童手当） */
  netMonthly: number
  consumption: number
  necessities: number
  monthlySaving: number
  education: number
  freeHours: number
  outcome: WeekOutcome
  state: WeekState
}

export interface HoursPoint {
  hours: number
  utility: number
  netMonthly: number
}

export class WeekPlanner {
  readonly kit: UtilityKit
  readonly life: CurrentLife

  constructor(
    readonly profile: Profile,
    readonly thetas: Float64Array,
  ) {
    this.kit = new UtilityKit(thetas, limitsFor(profile))
    this.life = currentLife(profile)
  }

  /** 今の貯蓄率（手取り − 教育費 に対する割合） */
  get savingRate(): number {
    const avail = this.life.netMonthly - this.life.household.education / 12
    return avail > 0 ? Math.min(0.9, Math.max(0, this.profile.monthlySaving / avail)) : 0
  }

  /** 今の生活そのものの期待効用（最適化しない） */
  currentUtility(): number {
    const k = this.thetas.length / N_PARAMS
    let u = 0
    for (let j = 0; j < k; j++) u += utility(this.thetas, this.life.state, j * N_PARAMS)
    return u / k
  }

  /**
   * 仕事 job・労働時間 h のときの最適な1週間（貯蓄額は今と同じ）。
   * samePayRate=true なら「時給が同じなら」（パートタイムの時給の低下を入れない）
   */
  plan(job: JobOption, h: number, opts: { samePayRate?: boolean; keepSavingRate?: boolean } = {}): WeekPlan {
    const p = this.profile
    const life = this.life
    const hh = householdAt(p, p.age)
    const commute = h > 0 ? commuteAtHours(job, h) : 0
    const netMonthly = householdNetAnnual(p, grossAtHours(job, h, opts.samePayRate ?? false)) / 12 + hh.allowance
    // 消費は「今の実際の消費」を基準に、手取りの増減ぶんだけ動かす（今の点で連続になり、比較がぶれない）。
    // 働き方を変える仮定では貯蓄「率」を今と同じにし（増減の (1 − 貯蓄率) を消費に回す）、
    // そうでなければ貯蓄「額」を今と同じにする（増減はすべて消費に回る）
    const dNet = netMonthly - life.netMonthly
    const monthlySaving = opts.keepSavingRate ? p.monthlySaving + dNet * this.savingRate : p.monthlySaving
    const consumption = Math.max(5_000, life.consumption + dNet * (opts.keepSavingRate ? 1 - this.savingRate : 1))
    const drawingDown = life.drawingDown && consumption <= life.consumption + 1
    // 家事は「外注する前の時間」から始め、時間を買うかどうかも最適化する
    const housework = life.grossHousework
    const free = 168 - h - commute - housework - p.personalCare - hh.childcareMine - p.otherDuties - life.caregiving - life.unlisted
    const shift = jobJoyShift(job, currentJob(p))
    const outcome = this.kit.week(
      {
        free,
        housework,
        consumption,
        necessities: p.necessities,
        householdSize: hh.size,
        workHours: h,
        commuteHours: commute,
        assetsMonths: p.savings / consumption,
        jobJoyShift: shift,
      },
      true,
    )
    const state: WeekState = {
      hours: outcome.hours,
      workHours: h,
      commuteHours: commute,
      consumption,
      householdSize: hh.size,
      spend: outcome.spend,
      assetsMonths: p.savings / consumption,
      jobJoyShift: shift,
      houseworkHours: Math.max(0, housework - outcome.freedHours),
    }
    return {
      job,
      workHours: h,
      commuteHours: commute,
      netMonthly,
      consumption,
      necessities: p.necessities,
      monthlySaving,
      education: hh.education / 12,
      freeHours: free,
      housework,
      drawingDown,
      feasible: free >= this.kit.table.base - 1e-9,
      outcome,
      state,
    }
  }

  /** モデルで直接計算した期待効用（今の生活との比較に使う） */
  expected(pl: WeekPlan): number {
    return expectedUtility(this.thetas, pl.state)
  }

  /** 今の仕事・今の労働時間のまま、時間とお金の使い方だけを最適化 */
  optimalNow(): WeekPlan {
    const job = currentJob(this.profile)
    return this.plan(job, job.weeklyHours)
  }

  /** 労働時間を変えられたら？（時給一定の仮定）の効用カーブ */
  hoursCurve(job: JobOption, from = 0, to = 70, step = 1): HoursPoint[] {
    const out: HoursPoint[] = []
    for (let h = from; h <= to + 1e-9; h += step) {
      const pl = this.plan(job, h, { samePayRate: true, keepSavingRate: true })
      out.push({ hours: h, utility: pl.outcome.utility, netMonthly: pl.netMonthly })
    }
    return out
  }

  /** 各仕事の候補について、労働時間も含めて最適化した結果 */
  compareJobs(): { job: JobOption; fixed: WeekPlan; best: WeekPlan }[] {
    return this.profile.jobs.map((job) => {
      const fixed = this.plan(job, job.weeklyHours, { keepSavingRate: true })
      let best = fixed
      if (job.hoursFlexible) {
        for (let h = 10; h <= 65; h += 1) {
          const pl = this.plan(job, h, { keepSavingRate: true })
          if (pl.outcome.utility > best.outcome.utility) best = pl
        }
      }
      return { job, fixed, best }
    })
  }
}
