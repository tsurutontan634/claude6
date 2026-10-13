import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Profile, Question, Response } from '../engine/types'
import { Session } from '../engine/session'
import type { LifeAssumptions, LifePolicy } from '../engine/lifeplan'
import { freshSaved, loadPosterior, loadSaved, persist, savePosterior, signature, type Saved } from './store'
import { HomePage } from './pages/Home'
import { ProfilePage } from './pages/ProfilePage'
import { QuestionPage } from './pages/QuestionPage'
import { WeekPage } from './pages/WeekPage'
import { MoneyPage } from './pages/MoneyPage'
import { LifePage } from './pages/LifePage'
import { AboutPage } from './pages/AboutPage'
import { DataPage } from './pages/DataPage'

export type Tab = 'home' | 'profile' | 'question' | 'week' | 'money' | 'life' | 'about' | 'data'

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'はじめに' },
  { id: 'profile', label: 'プロフィール' },
  { id: 'question', label: '質問に答える' },
  { id: 'week', label: '最適な1週間' },
  { id: 'money', label: 'お金' },
  { id: 'life', label: '人生計画' },
  { id: 'about', label: '根拠と注意' },
  { id: 'data', label: 'データ管理' },
]

interface AppState {
  saved: Saved
  session: Session
  /** 事後分布が変わるたびに増える番号（結果の再計算の合図） */
  rev: number
  go: (t: Tab) => void
  answer: (q: Question, r: Response) => void
  undo: () => Promise<void>
  setProfile: (p: Profile) => Promise<void>
  setAssumptions: (a: LifeAssumptions) => void
  setCustomPolicy: (p: LifePolicy | null) => void
  replaceAll: (s: Saved) => Promise<void>
  toast: (msg: string) => void
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppState がありません')
  return v
}

function initialTab(): Tab {
  try {
    const h = window.location.hash.replace('#', '') as Tab
    if (TABS.some((t) => t.id === h)) return h
  } catch {
    /* 無視 */
  }
  return 'home'
}

export function App() {
  const [saved, setSaved] = useState<Saved>(() => loadSaved() ?? freshSaved())
  const sessionRef = useRef<Session | null>(null)
  if (!sessionRef.current) sessionRef.current = new Session(saved.profile)
  const session = sessionRef.current
  const [rev, setRev] = useState(0)
  const [tab, setTab] = useState<Tab>(initialTab)
  const [busy, setBusy] = useState<{ label: string; frac: number } | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const savedRef = useRef(saved)
  savedRef.current = saved

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 2600)
  }, [])

  const commit = useCallback((next: Saved, cachePosterior = true) => {
    setSaved(next)
    persist(next)
    if (cachePosterior) savePosterior(signature(next), sessionRef.current!.posterior.serialize())
  }, [])

  // 起動時：保存してある回答から事後分布を復元する
  useEffect(() => {
    const s = savedRef.current
    if (s.answers.length === 0) return
    const cached = loadPosterior(signature(s))
    if (cached && session.restore(s.answers, cached)) {
      setRev((r) => r + 1)
      return
    }
    setBusy({ label: `これまでの回答（${s.answers.length}問）から推定を復元しています`, frac: 0 })
    session
      .loadAnswersAsync(s.answers, (f) => setBusy((b) => (b ? { ...b, frac: f } : b)))
      .then(() => {
        setBusy(null)
        setRev((r) => r + 1)
        savePosterior(signature(s), session.posterior.serialize())
      })
    // 起動時に一度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 共有リンクの #week などで直接そのページを開けるようにする
  useEffect(() => {
    const onHash = () => setTab(initialTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = useCallback((t: Tab) => {
    setTab(t)
    try {
      history.replaceState(null, '', `#${t}`)
    } catch {
      /* 埋め込み表示などで履歴が使えない場合は無視 */
    }
    window.scrollTo({ top: 0 })
  }, [])

  const answer = useCallback(
    (q: Question, r: Response) => {
      const a = session.answer(q, r)
      const next = { ...savedRef.current, answers: [...savedRef.current.answers, a] }
      commit(next)
      setRev((x) => x + 1)
    },
    [commit, session],
  )

  const undo = useCallback(async () => {
    const s = savedRef.current
    if (s.answers.length === 0) return
    const answers = s.answers.slice(0, -1)
    setBusy({ label: '直前の回答を取り消しています', frac: 0 })
    await session.loadAnswersAsync(answers, (f) => setBusy((b) => (b ? { ...b, frac: f } : b)))
    setBusy(null)
    commit({ ...s, answers })
    setRev((x) => x + 1)
  }, [commit, session])

  const setProfile = useCallback(
    async (p: Profile) => {
      const s = savedRef.current
      setBusy({ label: 'プロフィールを反映して推定し直しています', frac: 0 })
      await session.setProfileAsync(p, (f) => setBusy((b) => (b ? { ...b, frac: f } : b)))
      setBusy(null)
      commit({ ...s, profile: p, isSample: false })
      setRev((x) => x + 1)
    },
    [commit, session],
  )

  const setAssumptions = useCallback(
    (a: LifeAssumptions) => {
      commit({ ...savedRef.current, assumptions: a }, false)
    },
    [commit],
  )

  const setCustomPolicy = useCallback(
    (p: LifePolicy | null) => {
      commit({ ...savedRef.current, customPolicy: p }, false)
    },
    [commit],
  )

  const replaceAll = useCallback(
    async (s: Saved) => {
      session.profile = s.profile
      setBusy({ label: 'データを読み込んで推定しています', frac: 0 })
      await session.loadAnswersAsync(s.answers, (f) => setBusy((b) => (b ? { ...b, frac: f } : b)))
      setBusy(null)
      commit(s)
      setRev((x) => x + 1)
    },
    [commit, session],
  )

  const value = useMemo<AppState>(
    () => ({ saved, session, rev, go, answer, undo, setProfile, setAssumptions, setCustomPolicy, replaceAll, toast }),
    [saved, session, rev, go, answer, undo, setProfile, setAssumptions, setCustomPolicy, replaceAll, toast],
  )

  return (
    <Ctx.Provider value={value}>
      <div className="app">
        <div className="shell">
          <header className="masthead">
            <div className="name">
              <h1>しあわせ配分帳</h1>
              <span className="tagline">あなたの効用関数を推定して、時間とお金と人生の配分を考える</span>
            </div>
            <div className="status">
              {saved.isSample && <span className="chip sample">サンプルのプロフィール（30歳・会社員）</span>}
              <span className="chip">回答 {saved.answers.length}問</span>
            </div>
          </header>
          <nav className="index" aria-label="ページ">
            {TABS.map((t) => (
              <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
                <span>{t.label}</span>
                {t.id === 'question' && <span className="count">{saved.answers.length}</span>}
              </button>
            ))}
          </nav>
          <main className="main">
            {tab === 'home' && <HomePage />}
            {tab === 'profile' && <ProfilePage />}
            {tab === 'question' && <QuestionPage />}
            {tab === 'week' && <WeekPage />}
            {tab === 'money' && <MoneyPage />}
            {tab === 'life' && <LifePage />}
            {tab === 'about' && <AboutPage />}
            {tab === 'data' && <DataPage />}
          </main>
          <footer className="footer">
            参考・エンターテインメント用の試算です。研究データの平均像とあなたの回答から計算した推定で、医療・金融・キャリアの専門的な助言の代わりにはなりません。回答はこの端末のブラウザ内にだけ保存されます。
          </footer>
        </div>
        {busy && (
          <div className="overlay" role="alert" aria-busy="true">
            <div className="sheet" style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="loading">{busy.label}</div>
              <div className="meter">
                <span style={{ width: `${Math.round(busy.frac * 100)}%` }} />
              </div>
            </div>
          </div>
        )}
        {toastMsg && (
          <div className="toast" role="status">
            {toastMsg}
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}
