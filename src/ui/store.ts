// 端末内（ブラウザの localStorage）への保存と、JSON での書き出し・読み込み。
// 回答は外部に送らない。保存できない環境（プライベートウィンドウなど）でも動くよう、失敗は握りつぶす。

import type { Answer, Profile } from '../engine/types'
import { ACTIVITY_KEYS } from '../engine/types'
import { DEFAULT_ASSUMPTIONS, type LifeAssumptions, type LifePolicy } from '../engine/lifeplan'
import { sampleProfile } from '../engine/sample'
import { hashSeed } from '../engine/rng'

const KEY = 'shiawase-haibun:v1'
const POST_KEY = 'shiawase-haibun:posterior:v1'

export interface Saved {
  format: 'shiawase-haibun'
  version: 1
  profile: Profile
  /** サンプルのプロフィールのままか（編集したら false） */
  isSample: boolean
  answers: Answer[]
  assumptions: LifeAssumptions
  customPolicy: LifePolicy | null
  savedAt: number
}

export function freshSaved(): Saved {
  return {
    format: 'shiawase-haibun',
    version: 1,
    profile: sampleProfile(),
    isSample: true,
    answers: [],
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    customPolicy: null,
    savedAt: Date.now(),
  }
}

export function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return validateSaved(JSON.parse(raw))
  } catch {
    return null
  }
}

export function persist(s: Saved): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export function clearSaved(): void {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(POST_KEY)
  } catch {
    /* 保存領域が使えない環境では何もしない */
  }
}

/** プロフィールと回答の組み合わせの指紋（粒子キャッシュが使えるかの判定） */
export function signature(s: Saved): string {
  const last = s.answers[s.answers.length - 1]
  return `${hashSeed(JSON.stringify(s.profile))}-${s.answers.length}-${last ? last.question.id + last.response : ''}`
}

interface PosteriorCache {
  sig: string
  z: string
  logw: string
  scale: number
  resampleCount: number
}

function f32ToB64(arr: number[]): string {
  const f = new Float32Array(arr)
  const bytes = new Uint8Array(f.buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function b64ToF32(b64: string): number[] {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return Array.from(new Float32Array(bytes.buffer))
}

export function savePosterior(sig: string, data: { z: number[]; logw: number[]; scale: number; resampleCount: number }): void {
  try {
    const c: PosteriorCache = { sig, z: f32ToB64(data.z), logw: f32ToB64(data.logw), scale: data.scale, resampleCount: data.resampleCount }
    localStorage.setItem(POST_KEY, JSON.stringify(c))
  } catch {
    /* 容量不足などは無視（次回は回答から作り直す） */
  }
}

export function loadPosterior(sig: string): { z: number[]; logw: number[]; scale: number; resampleCount: number } | null {
  try {
    const raw = localStorage.getItem(POST_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as PosteriorCache
    if (c.sig !== sig) return null
    return { z: b64ToF32(c.z), logw: b64ToF32(c.logw), scale: c.scale, resampleCount: c.resampleCount }
  } catch {
    return null
  }
}

export function exportJSON(s: Saved): string {
  return JSON.stringify({ ...s, savedAt: Date.now() }, null, 1)
}

/** 読み込んだ JSON を検証して、足りない項目はサンプルの値で補う */
export function validateSaved(obj: unknown): Saved | null {
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Partial<Saved>
  if (o.format !== 'shiawase-haibun' || !o.profile || !Array.isArray(o.answers)) return null
  const base = sampleProfile()
  const p = { ...base, ...o.profile } as Profile
  p.currentHours = { ...base.currentHours, ...(o.profile.currentHours ?? {}) }
  p.liking = { ...base.liking, ...(o.profile.liking ?? {}) }
  p.spendShare = { ...base.spendShare, ...(o.profile.spendShare ?? {}) }
  if (!Array.isArray(p.jobs) || p.jobs.length === 0) p.jobs = base.jobs
  if (!p.jobs.some((j) => j.id === p.currentJobId)) p.currentJobId = p.jobs[0].id
  for (const k of ACTIVITY_KEYS) if (typeof p.currentHours[k] !== 'number') p.currentHours[k] = base.currentHours[k]
  const answers = o.answers.filter(
    (a) => a && a.question && a.question.a && a.question.b && typeof a.response === 'number' && a.response >= 0 && a.response <= 4,
  )
  // 古い形式の回答には家事時間がないので補う
  for (const a of answers) {
    if (typeof a.question.a.houseworkHours !== 'number') a.question.a.houseworkHours = p.housework
    if (typeof a.question.b.houseworkHours !== 'number') a.question.b.houseworkHours = p.housework
  }
  return {
    format: 'shiawase-haibun',
    version: 1,
    profile: p,
    isSample: o.isSample ?? false,
    answers,
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...(o.assumptions ?? {}) },
    customPolicy: o.customPolicy ?? null,
    savedAt: o.savedAt ?? Date.now(),
  }
}

/** claude.ai の公開ページなど、ダウンロードが使えない埋め込み表示の中か */
export function inEmbeddedFrame(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
