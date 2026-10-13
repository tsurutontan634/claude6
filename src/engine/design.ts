// 次の質問の選び方：期待情報利得（EIG）が最大の候補を選ぶ
//
// EIG = H[ p̄(r) ] − E_θ[ H[ p(r|θ) ] ]
//   p̄(r) は粒子で平均した回答の予測分布。
//   「粒子（＝あり得るあなた）同士で答えの予想が割れている」質問ほど、答えると多くを学べる。
// 同じ種類の質問ばかりにならないよう、直近で使ったテンプレートには割引をかける。

import type { Question, TemplateKey } from './types'
import { N_PARAMS, P_TAU } from './model'
import { compileDiff, evalDiff } from './diff'
import { N_RESPONSES, responseProbs } from './choice'

function entropy(p: ArrayLike<number>): number {
  let h = 0
  for (let i = 0; i < p.length; i++) if (p[i] > 0) h -= p[i] * Math.log(p[i])
  return h
}

/** 等重みの粒子 thetas（k×N_PARAMS）での EIG（ナット） */
export function expectedInfoGain(thetas: Float64Array, q: Question): number {
  const k = thetas.length / N_PARAMS
  const d = compileDiff(q.a, q.b)
  const pbar = new Float64Array(N_RESPONSES)
  const p = new Float64Array(N_RESPONSES)
  let condH = 0
  for (let j = 0; j < k; j++) {
    const o = j * N_PARAMS
    responseProbs(evalDiff(thetas, o, d), thetas[o + P_TAU], p)
    condH += entropy(p)
    for (let r = 0; r < N_RESPONSES; r++) pbar[r] += p[r]
  }
  for (let r = 0; r < N_RESPONSES; r++) pbar[r] /= k
  return entropy(pbar) - condH / k
}

/** 回答の予測分布（粒子平均） */
export function predictiveDistribution(thetas: Float64Array, q: Question): Float64Array {
  const k = thetas.length / N_PARAMS
  const d = compileDiff(q.a, q.b)
  const pbar = new Float64Array(N_RESPONSES)
  const p = new Float64Array(N_RESPONSES)
  for (let j = 0; j < k; j++) {
    const o = j * N_PARAMS
    responseProbs(evalDiff(thetas, o, d), thetas[o + P_TAU], p)
    for (let r = 0; r < N_RESPONSES; r++) pbar[r] += p[r] / k
  }
  return pbar
}

export interface Scored {
  q: Question
  eig: number
  score: number
}

/**
 * 候補を EIG で採点して最良のものを返す。
 * recent：直近に出したテンプレート（新しい順）
 */
export function selectQuestion(thetas: Float64Array, candidates: Question[], recent: TemplateKey[], used: Set<string>, signature: (q: Question) => string): Scored | null {
  let best: Scored | null = null
  for (const q of candidates) {
    if (used.has(signature(q))) continue
    const eig = expectedInfoGain(thetas, q)
    let penalty = 1
    for (let i = 0; i < Math.min(recent.length, 4); i++) if (recent[i] === q.template) penalty *= i === 0 ? 0.5 : 0.8
    const score = eig * penalty
    if (!best || score > best.score) best = { q, eig, score }
  }
  return best
}
