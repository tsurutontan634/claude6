import { describe, expect, it } from 'vitest'
import { ACTIVITY_KEYS, type WeekState } from './types'
import { ACTIVITIES, N_PARAMS, PARAM_DEFS, P_TAU, utility } from './model'
import { compileDiff, evalDiff } from './diff'
import { createRng } from './rng'
import { Session, WeekPlanner, personalPrior } from './session'
import { sampleProfile } from './sample'
import { allocateSpendBonus, buildTimeValueTable, defaultLimits, expectedUtility, timeAlloc, TIME_STEP } from './week'
import { SPEND_MU_MIN, SPEND_SCALES } from './model'
import { LifeSimulator, presetPolicies } from './lifeplan'
import { generateCandidates, questionSignature } from './questions'
import { questionContext, currentLife, currentJob } from './household'
import { moneyCurve } from './insights'
import { responseProbs } from './choice'
import type { Response } from './types'
import { takeHome } from './tax'

function priorDraws(k: number, seed = 1): Float64Array {
  const { mu, sd } = personalPrior(sampleProfile())
  const rng = createRng(seed)
  const out = new Float64Array(k * N_PARAMS)
  for (let j = 0; j < k; j++)
    for (let i = 0; i < N_PARAMS; i++) {
      const z = mu[i] + sd[i] * rng.normal()
      out[j * N_PARAMS + i] = PARAM_DEFS[i].transform === 'log' ? Math.exp(z) : z
    }
  return out
}

describe('手取り（調査担当の独立計算と一致）', () => {
  it('300〜1500万円で T5 表と ±0.2万円以内', () => {
    const ref: [number, number][] = [
      [300, 240.6],
      [500, 390.3],
      [700, 530.7],
      [1000, 726.3],
      [1500, 1023.1],
    ]
    for (const [g, n] of ref) expect(Math.abs(takeHome(g * 10_000, 35).net / 10_000 - n)).toBeLessThan(0.2)
  })
})

describe('効用差の高速計算', () => {
  it('compileDiff/evalDiff が utility(A) − utility(B) と一致する', () => {
    const p = sampleProfile()
    const ctx = questionContext(p)
    const rng = createRng(7)
    const qs = generateCandidates(ctx, rng, 60)
    const th = priorDraws(20)
    expect(qs.length).toBeGreaterThan(30)
    for (const q of qs) {
      const d = compileDiff(q.a, q.b)
      for (let j = 0; j < 20; j++) {
        const o = j * N_PARAMS
        const direct = utility(th, q.a, o) - utility(th, q.b, o)
        expect(evalDiff(th, o, d)).toBeCloseTo(direct, 9)
      }
    }
  })
})

describe('質問の生成', () => {
  it('活動時間の入れ替えでは合計時間が変わらず、上下限も守る', () => {
    const p = sampleProfile()
    const ctx = questionContext(p)
    const qs = generateCandidates(ctx, createRng(3), 200)
    for (const q of qs) {
      for (const s of [q.a, q.b]) {
        for (const k of ACTIVITY_KEYS) {
          expect(s.hours[k]).toBeGreaterThanOrEqual(ctx.limits.min[k] - 1e-9)
          expect(s.hours[k]).toBeLessThanOrEqual(ctx.limits.max[k] + 1e-9)
        }
        expect(s.consumption).toBeGreaterThan(0)
      }
      if (q.template === 'timeSwap' || q.template === 'sleepTradeoff') {
        const sum = (s: WeekState) => ACTIVITY_KEYS.reduce((t, k) => t + s.hours[k], 0)
        expect(sum(q.a)).toBeCloseTo(sum(q.b), 9)
      }
      expect(q.textA.length).toBeGreaterThan(0)
      expect(q.textB.length).toBeGreaterThan(0)
    }
  })
})

describe('1週間の最適化', () => {
  it('どの0.25時間の付け替えでも期待効用が増えない（局所最適＝限界効用均等）', () => {
    const th = priorDraws(200, 11)
    const limits = defaultLimits()
    const table = buildTimeValueTable(th, 168, limits)
    for (const free of [60, 80, 100]) {
      const h = timeAlloc(table, free)
      const total = ACTIVITY_KEYS.reduce((s, k) => s + h[k], 0)
      expect(total).toBeCloseTo(free, 6)
      const base: WeekState = {
        hours: h,
        workHours: 40,
        commuteHours: 5,
        consumption: 250_000,
        householdSize: 1,
        spend: { experience: 30_000, goods: 20_000, social: 5_000, timeBuy: 0 },
        assetsMonths: 6,
        jobJoyShift: 0,
        houseworkHours: 6,
      }
      const u0 = expectedUtility(th, base)
      for (const a of ACTIVITY_KEYS)
        for (const b of ACTIVITY_KEYS) {
          if (a === b) continue
          if (h[b] - TIME_STEP < limits.min[b] - 1e-9 || h[a] + TIME_STEP > limits.max[a] + 1e-9) continue
          const s = { ...base, hours: { ...h, [a]: h[a] + TIME_STEP, [b]: h[b] - TIME_STEP } }
          expect(expectedUtility(th, s)).toBeLessThanOrEqual(u0 + 1e-9)
        }
    }
  })

  it('支出の配分は合計が D 以下で、使っているカテゴリの限界効用がそろう（余りは限界が下限に達したときだけ）', () => {
    const alphas: [number, number, number] = [0.035, 0.005, 0.012]
    for (const D of [5_000, 30_000, 80_000, 400_000]) {
      const xs = allocateSpendBonus(alphas, D)
      const sum = xs[0] + xs[1] + xs[2]
      expect(sum).toBeLessThanOrEqual(D + 1e-6)
      const mus = xs.map((x, k) => (alphas[k] / SPEND_SCALES[k]) * Math.exp(-x / SPEND_SCALES[k]))
      const used = mus.filter((_, k) => xs[k] > 1)
      for (const m of used) expect(Math.abs(m - used[0]) / used[0]).toBeLessThan(1e-3)
      // 使い切っていないなら、限界効用は下限ちょうど
      if (sum < D - 1) for (const m of used) expect(m).toBeCloseTo(SPEND_MU_MIN, 12)
      else expect(sum).toBeCloseTo(D, 3)
    }
  })

  it('早見表（kit）で求めた最適値が、モデルで直接計算した期待効用と一致する', () => {
    const p = sampleProfile()
    const th = priorDraws(150, 5)
    const wp = new WeekPlanner(p, th)
    const plan = wp.optimalNow()
    const direct = expectedUtility(th, plan.state)
    expect(plan.outcome.utility).toBeCloseTo(direct, 2)
    // 最適化した週は、今の生活より悪くならない
    expect(plan.outcome.utility).toBeGreaterThanOrEqual(wp.currentUtility() - 1e-6)
  })

  it('研究データだけ（回答ゼロ）での最適な時間は研究の示す範囲に入る', () => {
    const p = sampleProfile()
    const s = new Session(p, { particles: 800 })
    const wp = new WeekPlanner(p, s.draws(300))
    const h = wp.optimalNow().outcome.hours
    expect(h.sleep / 7).toBeGreaterThan(6.5) // 1日6.5〜8.5時間
    expect(h.sleep / 7).toBeLessThan(8.5)
    expect(h.exercise).toBeGreaterThan(1.5) // 週2〜6時間（Chekroud 2018）
    expect(h.exercise).toBeLessThan(6.5)
    const discretionary = h.friends + h.family + h.hobby + h.rest + h.exercise + h.learning
    expect(discretionary / 7).toBeGreaterThan(2) // 1日2〜5時間程度（Sharif 2021）
    expect(discretionary / 7).toBeLessThan(6)
  })
})

describe('ベイズ推定', () => {
  it('回答すると事後分布が真の値の方向に動き、ESS が保たれる', () => {
    const p = sampleProfile()
    const s = new Session(p, { particles: 800 })
    const truth = priorDraws(1, 99)
    // 友人の時間の価値を高めにした「真のあなた」
    truth[1] *= 2.5
    const rng = createRng(4)
    const probs = new Float64Array(5)
    for (let i = 0; i < 40; i++) {
      const nq = s.nextQuestion()!
      responseProbs(evalDiff(truth, 0, compileDiff(nq.q.a, nq.q.b)), truth[P_TAU], probs)
      let u = rng.next()
      let r = 4
      for (let k = 0; k < 5; k++) {
        u -= probs[k]
        if (u <= 0) {
          r = k
          break
        }
      }
      s.answer(nq.q, r as Response)
    }
    expect(s.posterior.ess()).toBeGreaterThan(50)
    const prior = Math.exp(s.posterior.mu[1])
    const post = s.posterior.quantile(1, 0.5)
    expect(Math.abs(Math.log(post / truth[1]))).toBeLessThan(Math.abs(Math.log(prior / truth[1])))
  }, 60_000)

  it('保存した粒子から同じ事後分布を復元できる', () => {
    const p = sampleProfile()
    const s = new Session(p, { particles: 400 })
    for (let i = 0; i < 6; i++) {
      const nq = s.nextQuestion()!
      s.answer(nq.q, (i % 5) as Response)
    }
    const data = s.posterior.serialize()
    const t = new Session(p, { particles: 400 })
    expect(t.restore(s.answers, data)).toBe(true)
    for (let j = 0; j < N_PARAMS; j++) expect(t.posterior.quantile(j, 0.5)).toBeCloseTo(s.posterior.quantile(j, 0.5), 3)
  })
})

describe('人生計画', () => {
  const p = sampleProfile()
  const th = priorDraws(120, 21)
  const sim = new LifeSimulator(p, th)
  const results = presetPolicies(p).map((pol) => sim.simulate(pol))

  it('資産は負にならず、会計の恒等式を満たす', () => {
    for (const r of results) {
      for (let i = 0; i < r.years.length - 1; i++) {
        const y = r.years[i]
        const next = r.years[i + 1]
        expect(y.assets).toBeGreaterThanOrEqual(-1)
        if (r.shortfallYears === 0) {
          expect(next.assets).toBeCloseTo((y.assets + y.income - y.education - 12 * y.consumption) * 1.02, -2)
        }
      }
    }
  })

  it('引退前後の満足度の変化は研究の範囲（自発的な引退はほぼ中立）', () => {
    const r = results[1]
    const R = r.policy.retireAge
    const before = r.years.find((y) => y.age === R - 1)!.utility
    const after = r.years.find((y) => y.age === R + 1)!.utility
    expect(Math.abs(after - before)).toBeLessThan(0.35)
  })

  it('「今のまま」より消費・貯蓄を最適化したプランの方が点数が高い（またはほぼ同じ）', () => {
    expect(results[1].score).toBeGreaterThanOrEqual(results[0].score - 0.01)
  })

  it('今の生活の時間の合計に未記入があっても、最適化で時間が増えない', () => {
    const life = currentLife(p)
    expect(life.freeHours + life.state.workHours + life.commuteHours + p.housework + p.personalCare + life.unlisted).toBeCloseTo(168, 6)
    expect(ACTIVITIES.sleep.min).toBe(35)
  })
})

describe('レビューで見つかった不具合の再発防止', () => {
  const th = priorDraws(150, 31)

  it('労働時間カーブは今の労働時間で連続（収入が足りない人でも山ができない）', () => {
    for (const p of [sampleProfile(), { ...sampleProfile(), monthlySaving: 200_000 }]) {
      const wp = new WeekPlanner(p, th)
      const job = currentJob(p)
      const at = (h: number) => wp.plan(job, h, { samePayRate: true, keepSavingRate: true }).outcome.utility
      const H = job.weeklyHours
      const jumpLeft = Math.abs(at(H) - at(H - 1))
      const jumpRight = Math.abs(at(H + 1) - at(H))
      expect(jumpLeft).toBeLessThan(0.08)
      expect(jumpRight).toBeLessThan(0.08)
    }
  })

  it('今の仕事と全く同じ条件の候補は、比較で同じ点数になる', () => {
    const p = sampleProfile()
    const copy = { ...p.jobs[0], id: 'copy', name: 'コピー' }
    const q = { ...p, jobs: [p.jobs[0], copy] }
    const wp = new WeekPlanner(q, th)
    const [a, b] = wp.compareJobs()
    expect(wp.expected(b.fixed)).toBeCloseTo(wp.expected(a.fixed), 6)
  })

  it('お金の満足度カーブは今の年収で今の満足度を通る（年金などの収入があっても）', () => {
    for (const p of [sampleProfile(), { ...sampleProfile(), pensionNow: 1_500_000, otherIncome: 600_000 }]) {
      const wp = new WeekPlanner(p, th)
      const gross = currentJob(p).annualIncome
      const pt = moneyCurve(p, th, gross, wp.life.consumption, [gross / 10_000])[0]
      expect(pt.ls).toBeCloseTo(p.lifeSatisfaction, 6)
    }
  })

  it('A と B を入れ替えた質問は同じ署名になる', () => {
    const p = sampleProfile()
    const q = generateCandidates(questionContext(p), createRng(5), 1)[0]
    const swapped = { ...q, a: q.b, b: q.a, textA: q.textB, textB: q.textA }
    expect(questionSignature(swapped)).toBe(questionSignature(q))
  })
})
