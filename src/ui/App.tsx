import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Profile, Question, Response } from '../engine/types'
import { Session } from '../engine/session'
import type { LifeAssumptions, LifePolicy } from '../engine/lifeplan'
import { exportJSON, freshSaved, loadPosterior, loadSaved, persist, savePosterior, signature, type Saved } from './store'
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
  /** 推定の作り直しなどで操作を受け付けない間 true */
  busy: boolean
  /** プロフィール画面の、まだ保存していない編集 */
  draft: Profile | null
  setDraft: (p: Profile | null) => void
  go: (t: Tab) => void
  answer: (q: Question, r: Response) => void
  undo: () => Promise<boolean>
  setProfile: (p: Profile) => Promise<boolean>
  setAssumptions: (a: LifeAssumptions) => void
  setCustomPolicy: (p: LifePolicy | null) => void
  replaceAll: (s: Saved) => Promise<boolean>
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
  const [busy, setBusyState] = useState<{ label: string; frac: number } | null>(null)
  const busyRef = useRef(false)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const savedRef = useRef(saved)
  savedRef.current = saved

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 2800)
  }, [])

  const commit = useCallback((next: Saved, cachePosterior = true) => {
    setSaved(next)
    persist(next)
    if (cachePosterior) savePosterior(signature(next), sessionRef.current!.posterior.serialize())
  }, [])

  /**
   * 時間のかかる処理を、操作を止めた状態で実行する。
   * 失敗したら推定を保存済みの状態に戻し、false を返す（成功の知らせは呼び出し側が true のときだけ出す）。
   * 終わったら、押したボタンにキーボードの焦点を戻す。
   */
  const runBusy = useCallback(
    async (label: string, fn: (progress: (f: number) => void) => Promise<void>): Promise<boolean> => {
      if (busyRef.current) return false
      const focused = document.activeElement as HTMLElement | null
      busyRef.current = true
      setBusyState({ label, frac: 0 })
      let ok = true
      try {
        await fn((f) => setBusyState((b) => (b ? { ...b, frac: f } : b)))
      } catch (e) {
        ok = false
        console.error(e)
        toast('処理に失敗しました。入力を見直すか、データ管理から書き出してやり直してください')
        try {
          const s = savedRef.current
          sessionRef.current!.profile = s.profile
          await sessionRef.current!.loadAnswersAsync(s.answers)
          setRev((r) => r + 1)
        } catch (e2) {
          console.error(e2)
        }
      } finally {
        busyRef.current = false
        setBusyState(null)
        window.setTimeout(() => {
          if (focused && focused.isConnected) focused.focus()
        }, 0)
      }
      return ok
    },
    [toast],
  )

  // 起動時：保存してある回答から事後分布を復元する
  useEffect(() => {
    const s = savedRef.current
    if (s.answers.length === 0) return
    const cached = loadPosterior(signature(s))
    if (cached && session.restore(s.answers, cached)) {
      setRev((r) => r + 1)
      return
    }
    void runBusy(`これまでの回答（${s.answers.length}問）から推定を復元しています`, async (progress) => {
      await session.loadAnswersAsync(s.answers, progress)
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
      if (busyRef.current) return
      session.answer(q, r)
      // 回答の正本はセッション側（画面の状態が古くても取りこぼさない）
      commit({ ...savedRef.current, answers: session.answers.slice() })
      setRev((x) => x + 1)
    },
    [commit, session],
  )

  const undo = useCallback(
    () =>
      runBusy('直前の回答を取り消しています', async (progress) => {
        if (session.answers.length === 0) return
        await session.undoAsync(progress)
        commit({ ...savedRef.current, answers: session.answers.slice() })
        setRev((x) => x + 1)
      }),
    [commit, runBusy, session],
  )

  const setProfile = useCallback(
    (p: Profile) =>
      runBusy('プロフィールを反映して推定し直しています', async (progress) => {
        await session.setProfileAsync(p, progress)
        commit({ ...savedRef.current, profile: p, isSample: false })
        setDraft(null)
        setRev((x) => x + 1)
      }),
    [commit, runBusy, session],
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
    (s: Saved) =>
      runBusy('データを読み込んで推定しています', async (progress) => {
        session.profile = s.profile
        await session.loadAnswersAsync(s.answers, progress)
        commit(s)
        setDraft(null)
        setRev((x) => x + 1)
      }),
    [commit, runBusy, session],
  )

  const value = useMemo<AppState>(
    () => ({
      saved,
      session,
      rev,
      busy: busy !== null,
      draft,
      setDraft,
      go,
      answer,
      undo,
      setProfile,
      setAssumptions,
      setCustomPolicy,
      replaceAll,
      toast,
    }),
    [saved, session, rev, busy, draft, go, answer, undo, setProfile, setAssumptions, setCustomPolicy, replaceAll, toast],
  )

  return (
    <Ctx.Provider value={value}>
      <div className="app">
        <div className="shell" inert={busy !== null ? true : undefined}>
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
                {t.id === 'profile' && draft && JSON.stringify(draft) !== JSON.stringify(saved.profile) && <span className="count">未保存</span>}
              </button>
            ))}
          </nav>
          <main className="main">
            <ErrorBoundary key={tab} saved={saved}>
              {tab === 'home' && <HomePage />}
              {tab === 'profile' && <ProfilePage />}
              {tab === 'question' && <QuestionPage />}
              {tab === 'week' && <WeekPage />}
              {tab === 'money' && <MoneyPage />}
              {tab === 'life' && <LifePage />}
              {tab === 'about' && <AboutPage />}
              {tab === 'data' && <DataPage />}
            </ErrorBoundary>
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

/** 画面の描画で想定外のエラーが起きたとき、データを書き出せるようにする */
class ErrorBoundary extends Component<{ saved: Saved; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="sheet section">
        <h2>表示中にエラーが起きました</h2>
        <p className="note">入力した値の組み合わせで計算できなかった可能性があります。下のデータを保管してから、プロフィールを見直すか「データ管理」でやり直してください。</p>
        <textarea readOnly rows={6} value={exportJSON(this.props.saved)} onFocus={(e) => e.currentTarget.select()} />
        <div className="row">
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            もう一度表示する
          </button>
        </div>
      </div>
    )
  }
}
