// 表示用の書式（日本語）

/** 円 → 「12.3万円」「3,000円」 */
export function yen(v: number, digits = 1): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 100_000_000) return `${sign}${(a / 100_000_000).toFixed(2)}億円`
  if (a >= 10_000) {
    const man = a / 10_000
    const d = man >= 100 ? 0 : digits
    return `${sign}${man.toFixed(d).replace(/\.0+$/, '')}万円`
  }
  return `${sign}${Math.round(a).toLocaleString('ja-JP')}円`
}

/** 符号付きの円差 */
export function yenDelta(v: number): string {
  if (Math.abs(v) < 1) return '±0円'
  return (v > 0 ? '+' : '') + yen(v)
}

/** 時間/週 → 「週7.5時間」 */
export function hoursWeek(h: number): string {
  return `週${trimNum(h)}時間`
}

export function hoursDelta(d: number): string {
  if (Math.abs(d) < 1e-9) return '±0'
  return `${d > 0 ? '+' : '−'}${trimNum(Math.abs(d))}時間`
}

/** 睡眠：週の時間 → 「1日7時間」 */
export function sleepPerNight(hWeek: number): string {
  const perNight = hWeek / 7
  const h = Math.floor(perNight + 1e-9)
  const m = Math.round((perNight - h) * 60)
  if (m === 0) return `1日${h}時間`
  if (m === 60) return `1日${h + 1}時間`
  return `1日${h}時間${m}分`
}

export function trimNum(v: number, digits = 1): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits
  return Number.isInteger(r) ? String(r) : r.toFixed(digits)
}

/** 満足度ポイント → 「+0.12点」 */
export function points(v: number, digits = 2): string {
  const s = v.toFixed(digits)
  return (v > 0 ? '+' : v < 0 ? '' : '±') + s.replace('-', '−') + '点'
}

export function percent(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`
}
