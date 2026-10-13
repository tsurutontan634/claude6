import { describe, expect, it } from 'vitest'
import { takeHome } from './tax'
import { lifeExpectancy, survival } from './data'
import { responseProbs, responseProb } from './choice'
import type { Response } from './types'

describe('手取りの概算', () => {
  it('年収ごとの手取りがおおよそ妥当な範囲に入る', () => {
    const cases: [number, number, number][] = [
      [3_000_000, 2_250_000, 2_450_000],
      [5_000_000, 3_750_000, 4_050_000],
      [7_000_000, 5_100_000, 5_500_000],
      [10_000_000, 6_900_000, 7_500_000],
      [15_000_000, 9_700_000, 10_600_000],
    ]
    for (const [gross, lo, hi] of cases) {
      const net = takeHome(gross, 35).net
      expect(net, `gross ${gross}`).toBeGreaterThan(lo)
      expect(net, `gross ${gross}`).toBeLessThan(hi)
    }
  })
  it('手取りは額面に対して単調に増える', () => {
    let prev = 0
    for (let g = 1_000_000; g <= 30_000_000; g += 250_000) {
      const n = takeHome(g, 45).net
      expect(n).toBeGreaterThan(prev)
      prev = n
    }
  })
})

describe('生存率', () => {
  it('平均寿命が簡易生命表に近い', () => {
    expect(lifeExpectancy(0, 'male')).toBeGreaterThan(79.5)
    expect(lifeExpectancy(0, 'male')).toBeLessThan(82.5)
    expect(lifeExpectancy(0, 'female')).toBeGreaterThan(85.5)
    expect(lifeExpectancy(0, 'female')).toBeLessThan(88.5)
  })
  it('単調減少', () => {
    expect(survival(30, 30, 'male')).toBe(1)
    expect(survival(30, 60, 'male')).toBeGreaterThan(survival(30, 80, 'male'))
  })
})

describe('順序ロジット', () => {
  it('5つの確率の合計が1', () => {
    const out = new Float64Array(5)
    for (const du of [-1, -0.1, 0, 0.02, 0.5, 3]) {
      responseProbs(du, 0.05, out)
      const s = out.reduce((a, b) => a + b, 0)
      expect(s).toBeCloseTo(1, 10)
      for (let r = 0; r < 5; r++) expect(responseProb(du, 0.05, r as Response)).toBeCloseTo(out[r], 12)
    }
  })
  it('A がずっと良いと「Aがかなり良い」が最も起こりやすい', () => {
    const out = new Float64Array(5)
    responseProbs(1, 0.05, out)
    expect(out[4]).toBeGreaterThan(0.9)
    responseProbs(0, 0.05, out)
    expect(out[2]).toBeGreaterThan(out[4])
  })
})
