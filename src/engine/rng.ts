// 再現性のある疑似乱数（同じシード・同じ回答なら同じ推定結果になるようにする）

export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number
  /** 標準正規乱数 */
  normal(): number
  /** [0, n) の整数 */
  int(n: number): number
  /** 現在の内部状態（保存・復元用） */
  state(): number
}

/** mulberry32: 32bit 状態の高速 PRNG */
export function createRng(seed: number): Rng {
  let s = seed >>> 0
  let spare: number | null = null
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const normal = () => {
    if (spare !== null) {
      const v = spare
      spare = null
      return v
    }
    // Box-Muller（極座標法）
    let u = 0
    let v = 0
    let r = 0
    do {
      u = next() * 2 - 1
      v = next() * 2 - 1
      r = u * u + v * v
    } while (r === 0 || r >= 1)
    const f = Math.sqrt((-2 * Math.log(r)) / r)
    spare = v * f
    return u * f
  }
  return {
    next,
    normal,
    int: (n: number) => Math.floor(next() * n),
    state: () => s,
  }
}

/** 文字列から 32bit シードを作る（FNV-1a） */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
