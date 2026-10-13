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
  private drawsCache: { n: number; k: number; thetas: Float64Array } | null = null

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
    this.drawsCache = null
    if (this.answers.length) this.posterior.rebuild(this.answers.map(compileAnswer), onProgress)
  }

  /** 回答を読み込み直す（非同期版：段階の合間に画面を更新できる） */
  async loadAnswersAsync(answers: Answer[], onProgress?: (f: number) => void): Promise<void> {
    this.answers = answers.slice()
    this.usedSignatures = new Set(answers.map((a) => questionSignature(a.question)))
    this.posterior = this.freshPosterior()
    this.drawsCache = null
    if (!answers.length) return
    for (const phi of this.posterior.rebuildSteps(answers.map(compileAnswer))) {
      onProgress?.(phi)
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  async setProfileAsync(p: Profile, onProgress?: (f: number) => void): Promise<void> {
    this.profile = p
    await this.loadAnswersAsync(this.answers, onProgress)
  }

  /** 保存しておいた粒子から復元（回答が同じときだけ） */
  restore(answers: Answer[], data: Parameters<ParticlePosterior['restore']>[0]): boolean {
    this.answers = answers.slice()
    this.usedSignatures = new Set(answers.map((a) => questionSignature(a.question)))
    this.posterior = this.freshPosterior()
    this.drawsCache = null
    return this.posterior.restore(data, answers.map(compileAnswer))
  }

  loadAnswers(answers: Answer[], onProgress?: (f: number) => void): void {
    this.answers = answers.slice()
    this.usedSignatures = new Set(answers.map((a) => questionSignature(a.question)))
    this.posterior = this.freshPosterior()
    this.drawsCache = null
    if (answers.length) this.posterior.rebuild(answers.map(compileAnswer), onProgress)
  }

  answer(q: Question, r: Response): Answer {
    const a: Answer = { question: q, response: r, at: Date.now() }
    this.answers.push(a)
    this.usedSignatures.add(questionSignature(q))
    this.posterior.addAnswer(compileAnswer(a))
    this.drawsCache = null
    return a
  }

  /** 直前の回答を取り消す（事後分布は回答の再適用で作り直す） */
  undo(onProgress?: (f: number) => void): Answer | null {
    const last = this.answers.pop() ?? null
    if (last) this.loadAnswers(this.answers, onProgress)
    return last
  }

  /** 事後分布からの等重みサンプル（k × N_PARAMS） */
  draws(k: number): Float64Array {
    const n = this.answers.length
    if (this.drawsCache && this.drawsCache.n === n && this.drawsCache.k === k) return this.drawsCache.thetas
    const thetas = this.posterior.draw(k, 1000 + n)
    this.drawsCache = { n, k, thetas }
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

  /** 今の生活そのものの期待効用（最適化しない） */
  currentUtility(): number {
    const k = this.thetas.length / N_PARAMS
    let u = 0
    for (let j = 0; j < k; j++) u += utility(this.thetas, this.life.state, j * N_PARAMS)
    return u / k
  }

  /** 仕事 job・労働時間 h のときの最適な1週間（貯蓄額は今と同じ） */
  plan(job: JobOption, h: number, monthlySaving = this.profile.monthlySaving): WeekPlan {
    const p = this.profile
    const hh = householdAt(p, p.age)
    const commute = h > 0 ? commuteAtHours(job, h) : 0
    const netMonthly = householdNetAnnual(p, grossAtHours(job, h)) / 12 + hh.allowance
    const consumption = Math.max(1, netMonthly - monthlySaving - hh.education / 12)
    const free = 168 - h - commute - p.housework - p.personalCare - hh.childcareMine - p.otherDuties - this.life.unlisted
    const shift = jobJoyShift(job, currentJob(p))
    const outcome = this.kit.week(
      {
        free,
        housework: p.housework,
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
      houseworkHours: Math.max(0, p.housework - outcome.freedHours),
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
      outcome,
      state,
    }
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
      const pl = this.plan(job, h)
      out.push({ hours: h, utility: pl.outcome.utility, netMonthly: pl.netMonthly })
    }
    return out
  }

  /** 各仕事の候補について、労働時間も含めて最適化した結果 */
  compareJobs(): { job: JobOption; fixed: WeekPlan; best: WeekPlan }[] {
    return this.profile.jobs.map((job) => {
      const fixed = this.plan(job, job.weeklyHours)
      let best = fixed
      if (job.hoursFlexible) {
        for (let h = 10; h <= 65; h += 1) {
          const pl = this.plan(job, h)
          if (pl.outcome.utility > best.outcome.utility) best = pl
        }
      }
      return { job, fixed, best }
    })
  }
}
