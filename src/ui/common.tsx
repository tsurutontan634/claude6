// 画面共通の部品と色の対応

import { useEffect, useId, useState, type ReactNode } from 'react'
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

/**
 * 数値の入力欄。入力中は文字のまま持ち、数として読めるときだけ反映する。
 * 範囲（min/max）への丸めは、欄を離れたときに行う（1文字ずつ補正されて打てなくなるのを防ぐ）。
 */
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
  /** 小数を許すか（既定は許す） */
  integer?: boolean
}) {
  const [text, setText] = useState(fmtNum(props.value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(fmtNum(props.value))
  }, [props.value, focused])
  const clamp = (v: number) => {
    let x = props.integer ? Math.round(v) : v
    if (props.min !== undefined) x = Math.max(props.min, x)
    if (props.max !== undefined) x = Math.min(props.max, x)
    return x
  }
  const out = (() => {
    const v = parseFloat(text)
    if (!Number.isFinite(v)) return null
    if (props.min !== undefined && v < props.min) return `${props.min}${props.unit ?? ''}以上で入力してください`
    if (props.max !== undefined && v > props.max) return `${props.max}${props.unit ?? ''}以下で入力してください`
    return null
  })()
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="with-unit">
        <input
          id={props.id}
          type="number"
          inputMode="decimal"
          value={text}
          step={props.step ?? 1}
          min={props.min}
          max={props.max}
          aria-invalid={out ? true : undefined}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value)
            const v = parseFloat(e.target.value)
            if (Number.isFinite(v)) props.onChange(v)
          }}
          onBlur={() => {
            setFocused(false)
            const v = parseFloat(text)
            const next = clamp(Number.isFinite(v) ? v : props.value)
            setText(fmtNum(next))
            if (next !== props.value) props.onChange(next)
          }}
        />
        {props.unit && <span>{props.unit}</span>}
      </div>
      {out ? <span className="hint down">{out}</span> : props.hint && <span className="hint">{props.hint}</span>}
    </div>
  )
}

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return ''
  return String(Math.round(v * 1000) / 1000)
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
