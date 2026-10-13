// 端末内（ブラウザの localStorage）への保存と、JSON での書き出し・読み込み。
// 回答は外部に送らない。保存できない環境（プライベートウィンドウなど）でも動くよう、失敗は握りつぶす。

import type { Answer, Profile } from '../engine/types'
import { ACTIVITY_KEYS } from '../engine/types'
import { DEFAULT_ASSUMPTIONS, type LifeAssumptions, type LifePolicy } from '../engine/lifeplan'
import { sampleProfile } from '../engine/sample'
import { hashSeed } from '../engine/rng'
import { PARAM_DEFS } from '../engine/model'
import { PRIORS } from '../engine/priors'
import { CUTS, LAPSE, LIKELIHOOD_TEMPER } from '../engine/choice'
import { SPEND_KEYS, type WeekState } from '../engine/types'
import { TEMPLATE_LABELS } from '../engine/questions'

/** モデル（事前分布・回答モデル）の指紋。校正を変えたら保存済みの粒子は使わない */
const MODEL_FP = hashSeed(JSON.stringify([PARAM_DEFS.map((d) => [d.mu, d.sd]), CUTS, LAPSE, LIKELIHOOD_TEMPER, PRIORS]))

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
  return `${MODEL_FP}-${hashSeed(JSON.stringify(s.profile))}-${s.answers.length}-${last ? last.question.id + last.response : ''}`
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
  // 数値の項目は有限の数でなければサンプルの値に戻す
  const numKeys = ['lifeSatisfaction', 'partnerIncome', 'savings', 'monthlySaving', 'necessities', 'housework', 'personalCare', 'otherDuties', 'careShare'] as const
  for (const k of numKeys) if (typeof p[k] !== 'number' || !Number.isFinite(p[k])) (p as unknown as Record<string, number>)[k] = base[k] as number
  p.careShare = Math.min(1, Math.max(0, p.careShare))
  p.lifeSatisfaction = Math.min(10, Math.max(0, p.lifeSatisfaction))
  for (const k of ACTIVITY_KEYS) {
    if (!Number.isFinite(p.currentHours[k]) || p.currentHours[k] < 0) p.currentHours[k] = base.currentHours[k]
    if (!Number.isFinite(p.liking[k])) p.liking[k] = 3
    p.liking[k] = Math.min(5, Math.max(1, Math.round(p.liking[k])))
  }
  for (const k of SPEND_KEYS) if (!Number.isFinite(p.spendShare[k]) || p.spendShare[k] < 0) p.spendShare[k] = base.spendShare[k]
  p.sex = p.sex === 'male' || p.sex === 'female' ? p.sex : 'other'
  p.hasPartner = !!p.hasPartner
  p.daycare = p.daycare !== false
  const bj = base.jobs[0]
  p.jobs = p.jobs
    .filter((j) => j && typeof j === 'object' && typeof j.id === 'string')
    .map((j) => ({
      id: j.id,
      name: typeof j.name === 'string' ? j.name : '仕事',
      annualIncome: finiteOr(j.annualIncome, bj.annualIncome, 0),
      weeklyHours: finiteOr(j.weeklyHours, bj.weeklyHours, 0, 100),
      workDays: Math.round(finiteOr(j.workDays, bj.workDays, 0, 7)),
      commuteMinutesOneWay: finiteOr(j.commuteMinutesOneWay, bj.commuteMinutesOneWay, 0, 300),
      remoteDaysPerWeek: Math.round(finiteOr(j.remoteDaysPerWeek, 0, 0, 7)),
      enjoyment: Math.round(finiteOr(j.enjoyment, 3, 1, 5)),
      hoursFlexible: !!j.hoursFlexible,
      overtimePaid: j.overtimePaid !== false,
    }))
  if (p.jobs.length === 0) p.jobs = base.jobs
  if (!p.jobs.some((j) => j.id === p.currentJobId)) p.currentJobId = p.jobs[0].id
  p.children = (Array.isArray(p.children) ? p.children : [])
    .filter((c) => c && typeof c === 'object' && Number.isFinite(c.parentAgeAtBirth))
    .map((c) => ({ parentAgeAtBirth: Math.round(c.parentAgeAtBirth), schooling: c.schooling === 'public' || c.schooling === 'private' ? c.schooling : 'mixed' }))
  const cg = p.caregiving
  p.caregiving =
    cg && typeof cg === 'object' && Number.isFinite(cg.startAge) && Number.isFinite(cg.years) && Number.isFinite(cg.hoursPerWeek)
      ? { startAge: Math.round(cg.startAge), years: Math.max(0, Math.round(cg.years)), hoursPerWeek: Math.max(0, cg.hoursPerWeek) }
      : null
  // 年齢に対して古くなった値を直す
  p.age = clampNum(p.age, 18, 85, base.age)
  p.retireAge = clampNum(p.retireAge, p.age + 1, Math.max(85, p.age + 1), Math.max(65, p.age + 1))
  p.pensionAge = clampNum(p.pensionAge, 60, 75, 65)
  if (p.partnerPlanAge !== null && (typeof p.partnerPlanAge !== 'number' || p.partnerPlanAge <= p.age)) {
    p.hasPartner = p.hasPartner || typeof p.partnerPlanAge === 'number'
    p.partnerPlanAge = null
  }
  p.pensionNow = Number.isFinite(p.pensionNow) ? Math.max(0, p.pensionNow) : 0
  p.otherIncome = Number.isFinite(p.otherIncome) ? Math.max(0, p.otherIncome) : 0
  if (p.caregiving) p.caregiving.startAge = Math.min(100, Math.max(p.age, p.caregiving.startAge))
  // 古い形式の回答には家事時間がないので補う
  for (const a of o.answers) {
    if (a?.question?.a && typeof a.question.a.houseworkHours !== 'number') a.question.a.houseworkHours = p.housework
    if (a?.question?.b && typeof a.question.b.houseworkHours !== 'number') a.question.b.houseworkHours = p.housework
  }
  const answers = o.answers.filter(
    (a) =>
      a &&
      a.question &&
      validState(a.question.a) &&
      validState(a.question.b) &&
      Array.isArray(a.question.textA) &&
      Array.isArray(a.question.textB) &&
      a.question.template in TEMPLATE_LABELS &&
      Number.isInteger(a.response) &&
      a.response >= 0 &&
      a.response <= 4,
  )
  const cp = o.customPolicy
  const customPolicy =
    cp && Array.isArray(cp.stages) && cp.stages.every((st) => Number.isFinite(st?.from) && Number.isFinite(st?.hours)) && Number.isFinite(cp.retireAge) ? cp : null
  return {
    format: 'shiawase-haibun',
    version: 1,
    profile: p,
    isSample: o.isSample ?? false,
    answers,
    assumptions: validAssumptions(o.assumptions),
    customPolicy,
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

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback
}

/** 回答に保存された週の状態がすべて有限の数か */
function validState(s: WeekState | undefined): boolean {
  if (!s || typeof s !== 'object' || !s.hours || !s.spend) return false
  const nums = [s.workHours, s.commuteHours, s.consumption, s.householdSize, s.assetsMonths, s.jobJoyShift, s.houseworkHours]
  return (
    nums.every((x) => typeof x === 'number' && Number.isFinite(x)) &&
    ACTIVITY_KEYS.every((k) => Number.isFinite(s.hours[k])) &&
    SPEND_KEYS.every((k) => Number.isFinite(s.spend[k])) &&
    s.consumption > 0 &&
    s.householdSize >= 1
  )
}

function finiteOr(v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

function validAssumptions(a: unknown): Saved['assumptions'] {
  const d = DEFAULT_ASSUMPTIONS
  const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
  return {
    realReturn: finiteOr(o.realReturn, d.realReturn, -0.05, 0.1),
    realWageGrowth: finiteOr(o.realWageGrowth, d.realWageGrowth, -0.05, 0.05),
    discount: finiteOr(o.discount, d.discount, 0, 0.1),
    pensionFactor: finiteOr(o.pensionFactor, d.pensionFactor, 0, 1.5),
    maxAge: Math.round(finiteOr(o.maxAge, d.maxAge, 80, 110)),
    retirementBonus: finiteOr(o.retirementBonus, d.retirementBonus, 0),
    careerSteepness: finiteOr(o.careerSteepness, d.careerSteepness, 0, 2),
  }
}
