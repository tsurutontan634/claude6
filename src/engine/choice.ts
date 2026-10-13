// 5段階の1対1比較に対する順序ロジット（ordered logit）選択モデル
//
// 潜在変数 y = ΔU/τ + ε,  ε ~ Logistic(0,1),  ΔU = U(A) − U(B)
// 回答 r は y が閾値 CUTS のどこに入るかで決まる:
//   0: Bがかなり良い | 1: Bがやや良い | 2: 同じくらい | 3: Aがやや良い | 4: Aがかなり良い
// うっかり押し間違いに頑健にするため、確率 LAPSE で一様にランダムな回答が混ざると仮定する。

import type { Response } from './types'

/**
 * 標準化した潜在尺度での閾値。本当に同じくらいのとき「同じくらい」が約46%、
 * 「かなり」がどちらかに約14% になる幅（反復選択の実験で見られるぶれ方に合わせる）
 */
export const CUTS = [-2.6, -1.0, 1.0, 2.6] as const
/**
 * 表明された選好（想像の中の選択）は、実際に経験する満足度とずれる（フォーカシング・イリュージョンなど）。
 * 尤度を 0.7 乗して1問を0.7問ぶんとして数え、何百問答えても研究データの出発点が消えすぎないようにする
 * （一般化ベイズ：Bissiri, Holmes & Walker 2016）
 */
export const LIKELIHOOD_TEMPER = 0.7
export const LAPSE = 0.04
export const N_RESPONSES = 5

const sigmoid = (x: number) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)))

/** 回答 r の確率（ラプス込み） */
export function responseProb(dU: number, tau: number, r: Response): number {
  const z = dU / tau
  let p: number
  switch (r) {
    case 0:
      p = sigmoid(CUTS[0] - z)
      break
    case 1:
      p = sigmoid(CUTS[1] - z) - sigmoid(CUTS[0] - z)
      break
    case 2:
      p = sigmoid(CUTS[2] - z) - sigmoid(CUTS[1] - z)
      break
    case 3:
      p = sigmoid(CUTS[3] - z) - sigmoid(CUTS[2] - z)
      break
    default:
      p = 1 - sigmoid(CUTS[3] - z)
  }
  if (p < 0) p = 0
  return (1 - LAPSE) * p + LAPSE / N_RESPONSES
}

/** 5つの回答確率をまとめて out に書き込む */
export function responseProbs(dU: number, tau: number, out: Float64Array | number[]): void {
  const z = dU / tau
  const s0 = sigmoid(CUTS[0] - z)
  const s1 = sigmoid(CUTS[1] - z)
  const s2 = sigmoid(CUTS[2] - z)
  const s3 = sigmoid(CUTS[3] - z)
  const k = 1 - LAPSE
  const e = LAPSE / N_RESPONSES
  out[0] = k * s0 + e
  out[1] = k * Math.max(0, s1 - s0) + e
  out[2] = k * Math.max(0, s2 - s1) + e
  out[3] = k * Math.max(0, s3 - s2) + e
  out[4] = k * (1 - s3) + e
}

/** 推定に使う（温度をかけた）対数尤度 */
export function logLik(dU: number, tau: number, r: Response): number {
  return LIKELIHOOD_TEMPER * Math.log(responseProb(dU, tau, r))
}

/** 回答を「Aを選んだ度合い」(-2..+2) に変換（表示用） */
export function responseScore(r: Response): number {
  return r - 2
}

export const RESPONSE_LABELS: Record<Response, string> = {
  0: 'Bがかなり良い',
  1: 'Bがやや良い',
  2: '同じくらい',
  3: 'Aがやや良い',
  4: 'Aがかなり良い',
}
