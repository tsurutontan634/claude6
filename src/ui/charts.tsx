// SVG のグラフ部品（ライブラリなし）
// 線は2px、点は半径4以上で地の色の輪、格子線は1pxの淡い実線、凡例は2系列以上のときだけ。

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [w, setW] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth || 640)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(Math.max(200, Math.round(e.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// ---------------------------------------------------------------------------
// 目盛り
// ---------------------------------------------------------------------------

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min]
  const span = max - min
  const step0 = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Math.round(v / step) * step)
  return out
}

// ---------------------------------------------------------------------------
// ツールチップ
// ---------------------------------------------------------------------------

export interface TipRow {
  color?: string
  label: string
  value: string
}

export interface TipState {
  x: number
  y: number
  title: string
  rows: TipRow[]
}

export function Tooltip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null
  const left = Math.min(Math.max(0, tip.x + 12), Math.max(0, width - 220))
  return (
    <div className="tooltip" style={{ left, top: Math.max(0, tip.y - 10) }} role="status">
      <div className="t-title">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div className="t-row" key={i}>
          <span>
            {r.color && <span className="swatch" style={{ background: r.color }} />}
            {r.label}
          </span>
          <strong>{r.value}</strong>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 折れ線グラフ（十字線とツールチップつき）
// ---------------------------------------------------------------------------

export interface Series {
  id: string
  name: string
  color: string
  points: { x: number; y: number }[]
  /** 不確かさの帯（同じ x に対する下限・上限） */
  band?: { x: number; lo: number; hi: number }[]
  /** 線を引かず点だけ描く（参照データなど） */
  dotsOnly?: boolean
  /** 線の太さを細くする（参考線） */
  thin?: boolean
}

export interface Marker {
  x: number
  y: number
  label: string
  color?: string
}

export interface LineChartProps {
  series: Series[]
  height?: number
  xLog?: boolean
  xDomain?: [number, number]
  yDomain?: [number, number]
  xFormat: (v: number) => string
  yFormat: (v: number) => string
  xTicks?: number[]
  tipTitle: (x: number) => string
  tipValue?: (s: Series, y: number) => string
  markers?: Marker[]
  ariaLabel: string
  yLabel?: string
  footer?: ReactNode
}

function interpY(pts: { x: number; y: number }[], x: number): number | null {
  if (pts.length === 0) return null
  if (x < pts[0].x || x > pts[pts.length - 1].x) return null
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x >= x) {
      const a = pts[i - 1]
      const b = pts[i]
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
      return a.y + (b.y - a.y) * t
    }
  }
  return pts[pts.length - 1].y
}

export function LineChart(props: LineChartProps) {
  const { series, height = 260, xLog = false, markers = [] } = props
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)
  const [hx, setHx] = useState<number | null>(null)
  const lineSeries = series.filter((s) => !s.dotsOnly && s.points.length > 0)
  // 線の終端に名前を直接書く（2〜4系列で、幅に余裕があるとき）
  const labelW = Math.max(0, ...lineSeries.map((s) => s.name.length)) * 11 + 10
  const wantEnd = lineSeries.length >= 2 && lineSeries.length <= 4 && width >= 520
  const pad = { l: 46, r: wantEnd ? 18 + labelW : 18, t: 14, b: 30 }
  const iw = Math.max(50, width - pad.l - pad.r)
  const ih = height - pad.t - pad.b

  const all = series.flatMap((s) => s.points).filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y) && (!xLog || pt.x > 0))
  const xs = all.map((p) => p.x)
  const ok = (pt: { x: number; y: number }) => Number.isFinite(pt.x) && Number.isFinite(pt.y) && (!xLog || pt.x > 0)
  const ys = [
    ...all.map((p) => p.y),
    ...series.flatMap((s) => (s.band ?? []).flatMap((b) => [b.lo, b.hi])).filter(Number.isFinite),
    ...markers.filter(ok).map((m) => m.y),
  ]
  const xMin = props.xDomain?.[0] ?? Math.min(...xs)
  const xMax = props.xDomain?.[1] ?? Math.max(...xs)
  let yMin = props.yDomain?.[0] ?? Math.min(...ys)
  let yMax = props.yDomain?.[1] ?? Math.max(...ys)
  if (!props.yDomain) {
    const padY = (yMax - yMin) * 0.08 || 0.1
    yMin -= padY
    yMax += padY
  }
  const yTicks = niceTicks(yMin, yMax, 5)
  if (!props.yDomain) {
    yMin = Math.min(yMin, yTicks[0])
    yMax = Math.max(yMax, yTicks[yTicks.length - 1])
  }
  const fx = (x: number) => {
    if (xLog) return pad.l + ((Math.log(x) - Math.log(xMin)) / (Math.log(xMax) - Math.log(xMin))) * iw
    return pad.l + ((x - xMin) / (xMax - xMin || 1)) * iw
  }
  const fy = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin || 1)) * ih
  const invX = (px: number) => {
    const t = Math.min(1, Math.max(0, (px - pad.l) / iw))
    return xLog ? Math.exp(Math.log(xMin) + t * (Math.log(xMax) - Math.log(xMin))) : xMin + t * (xMax - xMin)
  }
  const xTicks = props.xTicks ?? niceTicks(xMin, xMax, Math.max(3, Math.floor(iw / 90)))

  // 終端ラベルは重ならないときだけ（重なるなら凡例とツールチップに任せる）
  const ends = lineSeries.map((s) => ({ s, y: fy(s.points[s.points.length - 1].y) })).sort((a, b) => a.y - b.y)
  const endLabels = wantEnd && ends.every((e, i) => i === 0 || e.y - ends[i - 1].y >= 13)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
    const scale = width / rect.width
    const px = (e.clientX - rect.left) * scale
    let x = invX(px)
    // 最も近いデータ点の x に吸着
    let best = x
    let bd = Infinity
    for (const p of lineSeries[0]?.points ?? series[0]?.points ?? []) {
      const d = Math.abs(fx(p.x) - px)
      if (d < bd) {
        bd = d
        best = p.x
      }
    }
    x = best
    const rows: TipRow[] = []
    for (const s of series) {
      let y: number | null
      if (s.dotsOnly) {
        const near = s.points.find((p) => Math.abs(fx(p.x) - fx(x)) < 14)
        y = near ? near.y : null
      } else y = interpY(s.points, x)
      if (y !== null) rows.push({ color: s.color, label: s.name, value: props.tipValue ? props.tipValue(s, y) : props.yFormat(y) })
    }
    setHx(x)
    setTip({ x: fx(x), y: (e.clientY - rect.top) * scale, title: props.tipTitle(x), rows })
  }

  if (all.length === 0)
    return (
      <div className="chart" ref={ref}>
        <p className="note">表示するデータがありません（比べるプランを選んでください）。</p>
      </div>
    )

  return (
    <div className="chart" ref={ref}>
      {series.length >= 2 && (
        <div className="legend" aria-hidden="true">
          {series.map((s) => (
            <span key={s.id}>
              {s.dotsOnly ? <span className="swatch" style={{ background: s.color, borderRadius: '50%' }} /> : <span className="line-key" style={{ background: s.color }} />}
              {s.name}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={props.ariaLabel}>
        <g className="grid">
          {yTicks.map((t) => (
            <line key={t} x1={pad.l} x2={pad.l + iw} y1={fy(t)} y2={fy(t)} />
          ))}
        </g>
        <g className="axis">
          {yTicks.map((t) => (
            <text key={t} x={pad.l - 6} y={fy(t) + 4} textAnchor="end">
              {props.yFormat(t)}
            </text>
          ))}
          {xTicks
            .filter((t) => t >= xMin - 1e-9 && t <= xMax + 1e-9)
            .map((t) => (
              <text key={t} x={fx(t)} y={height - 8} textAnchor="middle">
                {props.xFormat(t)}
              </text>
            ))}
          {props.yLabel && (
            <text x={pad.l} y={10} textAnchor="start">
              {props.yLabel}
            </text>
          )}
        </g>
        <line className="baseline" x1={pad.l} x2={pad.l + iw} y1={pad.t + ih} y2={pad.t + ih} />
        {series.map((s) =>
          s.band ? (
            <path
              key={s.id + '-band'}
              d={
                s.band.map((b, i) => `${i ? 'L' : 'M'}${fx(b.x)},${fy(b.hi)}`).join('') +
                [...s.band].reverse().map((b) => `L${fx(b.x)},${fy(b.lo)}`).join('') +
                'Z'
              }
              fill={s.color}
              opacity={0.12}
            />
          ) : null,
        )}
        {series.map((s) =>
          s.dotsOnly ? (
            <g key={s.id}>
              {s.points.filter(ok).map((p, i) => (
                <circle key={i} cx={fx(p.x)} cy={fy(p.y)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          ) : (
            <path
              key={s.id}
              d={s.points.filter(ok).map((p, i) => `${i ? 'L' : 'M'}${fx(p.x)},${fy(p.y)}`).join('')}
              fill="none"
              stroke={s.color}
              strokeWidth={s.thin ? 1.5 : 2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ),
        )}
        {endLabels &&
          ends.map(({ s, y }) => (
            <text key={s.id + '-end'} x={pad.l + iw + 6} y={y + 4} textAnchor="start" className="label-strong">
              {s.name}
            </text>
          ))}
        {markers.filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && (!xLog || m.x > 0)).map((m, i) => (
          <g key={i}>
            <circle cx={fx(m.x)} cy={fy(m.y)} r={5} fill={m.color ?? 'var(--ink)'} stroke="var(--surface)" strokeWidth={2} />
            <text x={fx(m.x)} y={fy(m.y) - 10} textAnchor="middle" className="label-strong">
              {m.label}
            </text>
          </g>
        ))}
        {hx !== null && <line x1={fx(hx)} x2={fx(hx)} y1={pad.t} y2={pad.t + ih} stroke="var(--rule-strong)" strokeWidth={1} />}
        <rect
          x={pad.l}
          y={pad.t}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={(e) => {
            // タッチでは指を離した後もツールチップを残す（次にタップした位置で更新）
            if (e.pointerType === 'touch') return
            setTip(null)
            setHx(null)
          }}
        />
      </svg>
      <Tooltip tip={tip} width={width} />
      {props.footer}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1週間（168時間）の帯
// ---------------------------------------------------------------------------

export interface WeekSegment {
  key: string
  label: string
  hours: number
  color: string
  /** 塗りの上の文字色（テーマごとに読みやすい色のトークン） */
  textColor: string
}

export function WeekBars({ rows }: { rows: { who: string; segments: WeekSegment[] }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState | null>(null)
  const barW = Math.max(100, width - 58)
  return (
    <div className="chart" ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row) => {
        const total = row.segments.reduce((s, x) => s + Math.max(0, x.hours), 0) || 1
        return (
          <div className="weekbar" key={row.who}>
            <div className="who">{row.who}</div>
            <div className="bar" role="img" aria-label={`${row.who}の1週間：` + row.segments.map((s) => `${s.label}${s.hours.toFixed(1)}時間`).join('、')}>
              {row.segments
                .filter((s) => s.hours > 0.01)
                .map((s) => {
                  const px = (s.hours / total) * barW
                  const text = `${s.label} ${Math.round(s.hours)}`
                  const fits = px > text.length * 11 + 8
                  return (
                    <div
                      key={s.key}
                      className="seg-h"
                      style={{ flex: `${s.hours} 1 0`, background: s.color, color: s.textColor }}
                      onPointerMove={(e) => {
                        const rect = (ref.current as HTMLDivElement).getBoundingClientRect()
                        setTip({
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top,
                          title: `${row.who}：${s.label}`,
                          rows: [
                            { label: '週', value: `${s.hours.toFixed(1)}時間` },
                            { label: '1日あたり', value: `${(s.hours / 7).toFixed(1)}時間` },
                          ],
                        })
                      }}
                      onPointerLeave={() => setTip(null)}
                    >
                      {fits ? text : ''}
                    </div>
                  )
                })}
            </div>
          </div>
        )
      })}
      <Tooltip tip={tip} width={width} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 横棒の比較（今 vs おすすめ など）
// ---------------------------------------------------------------------------

export interface PairBarRow {
  key: string
  label: string
  color: string
  a: number
  b: number
}

export function PairBars({ rows, aLabel, bLabel, format }: { rows: PairBarRow[]; aLabel: string; bLabel: string; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="legend">
        <span>
          <span className="swatch" style={{ background: 'var(--rule-strong)' }} />
          {aLabel}
        </span>
        <span>
          <span className="swatch" style={{ background: 'var(--ink-2)' }} />
          {bLabel}（色つき）
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(84px, 120px) minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="swatch" style={{ background: r.color }} />
            {r.label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <BarLine value={r.a} max={max} color="var(--rule-strong)" text={format(r.a)} />
            <BarLine value={r.b} max={max} color={r.color} text={format(r.b)} />
          </div>
        </div>
      ))}
    </div>
  )
}

function BarLine({ value, max, color, text }: { value: number; max: number; color: string; text: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div style={{ flex: '1 1 auto', minWidth: 0, height: 12 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '0 4px 4px 0', minWidth: value > 0 ? 2 : 0 }} />
      </div>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' }}>
        {text}
      </span>
    </div>
  )
}

/**
 * 計算が重い値を、画面を描いてから求める。
 * 入力が変わって計算し直している間も前の結果を返し（pending=true）、画面が消えたりスクロールが飛んだりしないようにする。
 * 短い間に続けて変わったとき（スライダーを動かしている間など）は最後の1回だけ計算する。
 */
export function useDeferred<T>(compute: () => T, deps: unknown[], delay = 60): { value: T | null; pending: boolean } {
  const [state, setState] = useState<{ value: T | null; pending: boolean }>({ value: null, pending: true })
  const fn = useRef(compute)
  fn.current = compute
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = useMemo(() => ({}), deps)
  useEffect(() => {
    let alive = true
    setState((s) => (s.pending ? s : { ...s, pending: true }))
    const t = setTimeout(() => {
      if (!alive) return
      setState({ value: fn.current(), pending: false })
    }, delay)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [key, delay])
  return state
}
