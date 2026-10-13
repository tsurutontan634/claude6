// 粒子（逐次モンテカルロ, SMC）によるベイズ推定
//
// 事前分布：文献から作った正規分布（log 変換したパラメータは対数正規）
// 尤度    ：choice.ts の順序ロジット
// 1問答えるごとに粒子の重みを更新し、有効粒子数が半分を切ったら
// 「リサンプリング＋メトロポリス・ヘイスティングス移動」で粒子を作り直す（resample-move）。

import type { Response } from './types'
import { createRng, type Rng } from './rng'
import { N_PARAMS, P_TAU, PARAM_DEFS } from './model'
import { evalDiff, type CompiledDiff } from './diff'
import { logLik } from './choice'

export interface CompiledAnswer {
  diff: CompiledDiff
  r: Response
}

export interface PosteriorOptions {
  particles?: number
  seed?: number
  /** MH 移動の回数（リサンプリングのたび） */
  moves?: number
}

const LOG_TRANSFORM: boolean[] = PARAM_DEFS.map((d) => d.transform === 'log')
/** 取り消せる回答の数（それより前は回答から作り直す） */
const UNDO_DEPTH = 5

export class ParticlePosterior {
  readonly n: number
  readonly p = N_PARAMS
  /** 制約なし空間の粒子 n×p */
  z: Float64Array
  /** 自然パラメータ n×p（z から計算したキャッシュ） */
  theta: Float64Array
  logw: Float64Array
  /** 各粒子の「これまでの全回答の対数尤度」 */
  loglik: Float64Array
  answers: CompiledAnswer[] = []
  readonly mu: Float64Array
  readonly sd: Float64Array
  private rng: Rng
  private moves: number
  /** MH 提案幅の適応係数 */
  private scale = 0.5
  lastAcceptance = NaN
  resampleCount = 0

  constructor(mu: ArrayLike<number>, sd: ArrayLike<number>, opts: PosteriorOptions = {}) {
    this.n = opts.particles ?? 2000
    this.moves = opts.moves ?? 4
    this.rng = createRng(opts.seed ?? 12345)
    this.mu = Float64Array.from(mu)
    this.sd = Float64Array.from(sd)
    const { n, p } = this
    this.z = new Float64Array(n * p)
    this.theta = new Float64Array(n * p)
    this.logw = new Float64Array(n)
    this.loglik = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < p; j++) this.z[i * p + j] = this.mu[j] + this.sd[j] * this.rng.normal()
      this.refreshTheta(i)
    }
  }

  private refreshTheta(i: number): void {
    const o = i * this.p
    for (let j = 0; j < this.p; j++) {
      const v = this.z[o + j]
      this.theta[o + j] = LOG_TRANSFORM[j] ? Math.exp(v) : v
    }
  }

  logPrior(z: ArrayLike<number>, o = 0): number {
    let s = 0
    for (let j = 0; j < this.p; j++) {
      const d = (z[o + j] - this.mu[j]) / this.sd[j]
      s -= 0.5 * d * d
    }
    return s
  }

  /** θ 行（offset o）について、回答群の対数尤度 */
  static answersLogLik(theta: ArrayLike<number>, o: number, answers: CompiledAnswer[]): number {
    const tau = theta[o + P_TAU]
    let s = 0
    for (const a of answers) s += logLik(evalDiff(theta, o, a.diff), tau, a.r)
    return s
  }

  /** 正規化した重み */
  weights(): Float64Array {
    const { n, logw } = this
    let m = -Infinity
    for (let i = 0; i < n; i++) if (logw[i] > m) m = logw[i]
    const w = new Float64Array(n)
    let s = 0
    for (let i = 0; i < n; i++) {
      w[i] = Math.exp(logw[i] - m)
      s += w[i]
    }
    for (let i = 0; i < n; i++) w[i] /= s
    return w
  }

  ess(): number {
    const w = this.weights()
    let s = 0
    for (let i = 0; i < this.n; i++) s += w[i] * w[i]
    return 1 / s
  }

  /** 取り消し用に、回答を取り込む直前の状態を保存しておく（直近 UNDO_DEPTH 問ぶん） */
  private snapshots: { z: Float64Array; theta: Float64Array; logw: Float64Array; loglik: Float64Array; scale: number; resampleCount: number }[] = []

  /** 事前分布だけを差し替える（プロフィール変更時）。重要度で重みを付け直し、偏ったら作り直す */
  setPrior(mu: ArrayLike<number>, sd: ArrayLike<number>): number {
    const { n, p } = this
    for (let i = 0; i < n; i++) this.logw[i] -= this.logPrior(this.z, i * p)
    this.mu.set(mu)
    this.sd.set(sd)
    for (let i = 0; i < n; i++) this.logw[i] += this.logPrior(this.z, i * p)
    this.snapshots = []
    const ess = this.ess()
    if (ess < n / 2) this.resampleMove(1)
    return ess
  }

  /** 直前の回答を取り消す。保存しておいた状態があれば即座に戻せる（なければ false） */
  undoLast(): boolean {
    const snap = this.snapshots.pop()
    if (!snap) return false
    this.answers.pop()
    this.z = snap.z
    this.theta = snap.theta
    this.logw = snap.logw
    this.loglik = snap.loglik
    this.scale = snap.scale
    this.resampleCount = snap.resampleCount
    return true
  }

  /** 1問の回答を取り込む */
  addAnswer(ans: CompiledAnswer): void {
    this.snapshots.push({
      z: this.z.slice(),
      theta: this.theta.slice(),
      logw: this.logw.slice(),
      loglik: this.loglik.slice(),
      scale: this.scale,
      resampleCount: this.resampleCount,
    })
    if (this.snapshots.length > UNDO_DEPTH) this.snapshots.shift()
    this.answers.push(ans)
    const { n, p } = this
    for (let i = 0; i < n; i++) {
      const o = i * p
      const ll = logLik(evalDiff(this.theta, o, ans.diff), this.theta[o + P_TAU], ans.r)
      this.logw[i] += ll
      this.loglik[i] += ll
    }
    // 回答が多いほど1回の移動が重くなるので、回数を減らして画面が止まる時間を抑える
    if (this.ess() < n / 2) this.resampleMove(1, this.answers.length > 150 ? 2 : this.moves)
  }

  /**
   * 全回答をまとめて取り込み直す（保存データからの復元用）。
   * 尤度に温度 φ を掛けて 0→1 へ少しずつ上げる（likelihood tempering）。
   */
  rebuild(answers: CompiledAnswer[], onProgress?: (frac: number) => void): void {
    for (const phi of this.rebuildSteps(answers)) onProgress?.(phi)
  }

  /** rebuild を1段階ずつ進めるジェネレーター（画面を止めないよう、呼び出し側で間に休憩を挟める） */
  *rebuildSteps(answers: CompiledAnswer[]): Generator<number, void, unknown> {
    this.snapshots = []
    this.answers = answers.slice()
    const { n, p } = this
    for (let i = 0; i < n; i++) {
      this.loglik[i] = ParticlePosterior.answersLogLik(this.theta, i * p, this.answers)
      this.logw[i] = 0
    }
    let phi = 0
    let guard = 0
    while (phi < 1 && guard++ < 200) {
      // ESS が半分になる Δφ を二分探索
      let lo = 0
      let hi = 1 - phi
      const essAt = (dphi: number) => {
        let m = -Infinity
        const lw = new Float64Array(n)
        for (let i = 0; i < n; i++) {
          lw[i] = dphi * this.loglik[i]
          if (lw[i] > m) m = lw[i]
        }
        let s = 0
        let s2 = 0
        for (let i = 0; i < n; i++) {
          const w = Math.exp(lw[i] - m)
          s += w
          s2 += w * w
        }
        return (s * s) / s2
      }
      let dphi = hi
      if (essAt(hi) < n / 2) {
        for (let it = 0; it < 30; it++) {
          const mid = (lo + hi) / 2
          if (essAt(mid) < n / 2) hi = mid
          else lo = mid
        }
        dphi = Math.max(lo, 1e-6)
      }
      for (let i = 0; i < n; i++) this.logw[i] = dphi * this.loglik[i]
      phi = Math.min(1, phi + dphi)
      // 焼きなましの途中は移動を少なめに、最後の段階だけしっかり混ぜる
      this.resampleMove(phi, phi >= 1 ? this.moves : 2)
      yield phi
    }
  }

  /** 重み付き平均と共分散（z 空間） */
  private moments(w: Float64Array): { mean: Float64Array; cov: Float64Array } {
    const { n, p, z } = this
    const mean = new Float64Array(p)
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) mean[j] += w[i] * z[i * p + j]
    const cov = new Float64Array(p * p)
    for (let i = 0; i < n; i++) {
      if (w[i] < 1e-12) continue
      for (let a = 0; a < p; a++) {
        const da = z[i * p + a] - mean[a]
        for (let b = 0; b <= a; b++) cov[a * p + b] += w[i] * da * (z[i * p + b] - mean[b])
      }
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) cov[b * p + a] = cov[a * p + b]
    return { mean, cov }
  }

  /** 系統リサンプリング → MH 移動。phi は尤度の温度 */
  private resampleMove(phi: number, moves = this.moves): void {
    const { n, p } = this
    const w = this.weights()
    const { cov } = this.moments(w)
    // 共分散が潰れないよう、事前分散の 1% を下限として足す
    for (let j = 0; j < p; j++) cov[j * p + j] += 0.0001 * this.sd[j] * this.sd[j] + 1e-10
    const L = cholesky(cov, p)

    // 系統リサンプリング
    const idx = new Int32Array(n)
    const u0 = this.rng.next() / n
    let c = w[0]
    let k = 0
    for (let i = 0; i < n; i++) {
      const u = u0 + i / n
      while (u > c && k < n - 1) c += w[++k]
      idx[i] = k
    }
    const z2 = new Float64Array(n * p)
    const ll2 = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      z2.set(this.z.subarray(idx[i] * p, idx[i] * p + p), i * p)
      ll2[i] = this.loglik[idx[i]]
    }
    this.z = z2
    this.loglik = ll2
    for (let i = 0; i < n; i++) this.refreshTheta(i)
    this.logw.fill(0)
    this.resampleCount++

    // MH 移動
    const prop = new Float64Array(p)
    const thetaProp = new Float64Array(p)
    const eps = new Float64Array(p)
    let accepted = 0
    let total = 0
    for (let m = 0; m < moves; m++) {
      const s = (this.scale * 2.38) / Math.sqrt(p)
      let accM = 0
      for (let i = 0; i < n; i++) {
        const o = i * p
        for (let j = 0; j < p; j++) eps[j] = this.rng.normal()
        for (let a = 0; a < p; a++) {
          let v = 0
          for (let b = 0; b <= a; b++) v += L[a * p + b] * eps[b]
          prop[a] = this.z[o + a] + s * v
        }
        for (let j = 0; j < p; j++) thetaProp[j] = LOG_TRANSFORM[j] ? Math.exp(prop[j]) : prop[j]
        const llProp = ParticlePosterior.answersLogLik(thetaProp, 0, this.answers)
        const cur = this.logPrior(this.z, o) + phi * this.loglik[i]
        const nxt = this.logPrior(prop, 0) + phi * llProp
        if (Math.log(this.rng.next()) < nxt - cur) {
          this.z.set(prop, o)
          this.theta.set(thetaProp, o)
          this.loglik[i] = llProp
          accM++
        }
      }
      accepted += accM
      total += n
      const rate = accM / n
      if (rate > 0.35) this.scale *= 1.25
      else if (rate < 0.15) this.scale *= 0.75
      this.scale = Math.min(2, Math.max(0.05, this.scale))
    }
    this.lastAcceptance = accepted / total
  }

  /** 重み付き平均（自然パラメータ） */
  meanTheta(): Float64Array {
    const w = this.weights()
    const out = new Float64Array(this.p)
    for (let i = 0; i < this.n; i++) for (let j = 0; j < this.p; j++) out[j] += w[i] * this.theta[i * this.p + j]
    return out
  }

  /** 事後中央値（自然パラメータ）。歪んだ分布でも代表値として安定 */
  medianTheta(): Float64Array {
    const out = new Float64Array(this.p)
    for (let j = 0; j < this.p; j++) out[j] = this.quantile(j, 0.5)
    return out
  }

  /** パラメータ j の重み付き分位点（自然パラメータ） */
  quantile(j: number, q: number): number {
    const w = this.weights()
    const order = Array.from({ length: this.n }, (_, i) => i).sort(
      (a, b) => this.theta[a * this.p + j] - this.theta[b * this.p + j],
    )
    let c = 0
    for (const i of order) {
      c += w[i]
      if (c >= q) return this.theta[i * this.p + j]
    }
    return this.theta[order[order.length - 1] * this.p + j]
  }

  /** 重みに従って k 個の粒子を引く（等重み、自然パラメータ k×p） */
  draw(k: number, seed = 777): Float64Array {
    const w = this.weights()
    const rng = createRng(seed)
    const out = new Float64Array(k * this.p)
    const u0 = rng.next() / k
    let c = w[0]
    let idx = 0
    for (let i = 0; i < k; i++) {
      const u = u0 + i / k
      while (u > c && idx < this.n - 1) c += w[++idx]
      out.set(this.theta.subarray(idx * this.p, idx * this.p + this.p), i * this.p)
    }
    return out
  }

  /**
   * パラメータ j について、事前分布からどれだけ絞り込まれたか（0〜1）。
   * 1 − 事後SD/事前SD（z 空間）
   */
  learned(j: number): number {
    const w = this.weights()
    let m = 0
    for (let i = 0; i < this.n; i++) m += w[i] * this.z[i * this.p + j]
    let v = 0
    for (let i = 0; i < this.n; i++) {
      const d = this.z[i * this.p + j] - m
      v += w[i] * d * d
    }
    return Math.max(0, Math.min(1, 1 - Math.sqrt(v) / this.sd[j]))
  }

  /** 保存用（Float32 に落として容量を節約） */
  serialize(): { z: number[]; logw: number[]; scale: number; resampleCount: number } {
    return {
      z: Array.from(new Float32Array(this.z)),
      logw: Array.from(new Float32Array(this.logw)),
      scale: this.scale,
      resampleCount: this.resampleCount,
    }
  }

  restore(data: { z: number[]; logw: number[]; scale: number; resampleCount: number }, answers: CompiledAnswer[]): boolean {
    if (data.z.length !== this.n * this.p || data.logw.length !== this.n) return false
    this.snapshots = []
    this.z = Float64Array.from(data.z)
    this.logw = Float64Array.from(data.logw)
    this.scale = data.scale
    this.resampleCount = data.resampleCount
    this.answers = answers.slice()
    for (let i = 0; i < this.n; i++) {
      this.refreshTheta(i)
      this.loglik[i] = ParticlePosterior.answersLogLik(this.theta, i * this.p, this.answers)
    }
    return true
  }
}

/** 対称正定値行列の下三角コレスキー分解（失敗時は対角で代用） */
export function cholesky(a: Float64Array, p: number): Float64Array {
  const L = new Float64Array(p * p)
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * p + j]
      for (let k = 0; k < j; k++) s -= L[i * p + k] * L[j * p + k]
      if (i === j) {
        if (s <= 0) {
          // 数値的に不安定：対角だけで近似し直す
          const D = new Float64Array(p * p)
          for (let d = 0; d < p; d++) D[d * p + d] = Math.sqrt(Math.max(a[d * p + d], 1e-10))
          return D
        }
        L[i * p + i] = Math.sqrt(s)
      } else {
        L[i * p + j] = s / L[j * p + j]
      }
    }
  }
  return L
}
