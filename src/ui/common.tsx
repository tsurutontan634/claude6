// 画面共通の部品と色の対応

import { useId, type ReactNode } from 'react'
import type { ActivityKey } from '../engine/types'

export const ACT_COLOR: Record<ActivityKey, string> = {
  sleep: 'var(--s-sleep)',
  friends: 'var(--s-friends)',
  family: 'var(--s-family)',
  hobby: 'var(--s-hobby)',
  rest: 'var(--s-rest)',
  exercise: 'var(--s-exercise)',
  learning: 'var(--s-learning)',
}

/** 塗りの上の文字色（明るい塗りには濃い文字） */
export const ACT_DARK_TEXT: Record<ActivityKey, boolean> = {
  sleep: false,
  friends: true,
  family: true,
  hobby: true,
  rest: true,
  exercise: false,
  learning: false,
}

export function NumberField(props: {
  id: string
  label: string
  value: number
  onChange: (v: number) => void
  unit?: string
  step?: number
  min?: number
  max?: number
  hint?: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="with-unit">
        <input
          id={props.id}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(props.value) ? props.value : ''}
          step={props.step ?? 1}
          min={props.min}
          max={props.max}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            props.onChange(Number.isFinite(v) ? v : 0)
          }}
        />
        {props.unit && <span>{props.unit}</span>}
      </div>
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  )
}

export function Seg<T extends string | number | boolean>(props: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: ReactNode
}) {
  const id = useId()
  return (
    <div className="field">
      <span className="label" id={id}>
        {props.label}
      </span>
      <div className="seg" role="group" aria-labelledby={id}>
        {props.options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === props.value} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  )
}

export function RangeField(props: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
  hint?: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>
        {props.label}：<strong>{props.format(props.value)}</strong>
      </label>
      <input id={props.id} type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(parseFloat(e.target.value))} />
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  )
}

export function Stamp({ big, small }: { big: string; small: string }) {
  return (
    <div className="stamp" aria-label={`${small} ${big}`}>
      <div>
        <div className="small">{small}</div>
        <div className="big">{big}</div>
      </div>
    </div>
  )
}

export function Meter({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function Loading({ label = '計算しています…' }: { label?: string }) {
  return <div className="loading">{label}</div>
}

/** 満足度（0〜10点）を表示用に丸める */
export function lsText(v: number): string {
  return `${Math.max(0, Math.min(10, v)).toFixed(1)}点`
}

export function deltaText(v: number, digits = 2): string {
  const s = Math.abs(v).toFixed(digits)
  if (Math.abs(v) < 0.5 * Math.pow(10, -digits)) return `±${(0).toFixed(digits)}点`
  return `${v > 0 ? '+' : '−'}${s}点`
}

export function manYen(v: number, digits = 1): string {
  const m = v / 10_000
  return `${m.toFixed(Math.abs(m) >= 100 ? 0 : digits)}万円`
}
