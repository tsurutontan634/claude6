import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Question, Response } from '../../engine/types'
import { useApp } from '../App'
import { ACTIVITIES } from '../../engine/model'
import { TEMPLATE_LABELS } from '../../engine/questions'
import { activityValues, personalityType } from '../../engine/insights'
import { currentLife } from '../../engine/household'
import { ACT_COLOR, Loading, Meter } from '../common'
import { DRAWS_FOR_DESIGN } from '../../engine/session'
import { yen } from '../../engine/format'

/** 左から：Aがかなり良い … Bがかなり良い（回答コードは 4 … 0） */
const BUTTONS: { r: Response; label: string; sub: string }[] = [
  { r: 4, label: 'A', sub: 'かなり良い' },
  { r: 3, label: 'A', sub: 'やや良い' },
  { r: 2, label: '同じ', sub: 'くらい' },
  { r: 1, label: 'B', sub: 'やや良い' },
  { r: 0, label: 'B', sub: 'かなり良い' },
]

const MONEY_TEMPLATES = new Set(['timeVsMoney', 'workTradeoff', 'moneyCurvature', 'security', 'commute'])

interface Current {
  q: Question
  eig: number
  predictive: Float64Array
}

export function QuestionPage() {
  const { session, saved, answer, undo, go, toast, rev } = useApp()
  const [cur, setCur] = useState<Current | null>(null)
  const [thinking, setThinking] = useState(true)
  const salt = useRef(0)
  const n = saved.answers.length

  const load = useCallback(() => {
    setThinking(true)
    window.setTimeout(() => {
      const next = session.nextQuestion(salt.current)
      setCur(next)
      setThinking(false)
    }, 20)
  }, [session])

  useEffect(() => {
    salt.current = 0
    load()
  }, [rev, load])

  const respond = useCallback(
    (r: Response) => {
      if (!cur || thinking) return
      setThinking(true)
      window.setTimeout(() => {
        answer(cur.q, r)
        const m = n + 1
        if (m === 10 || m === 30 || m === 60 || m % 50 === 0) toast(`${m}問に答えました。「最適な1週間」で結果が見られます`)
      }, 10)
    },
    [cur, thinking, answer, n, toast],
  )

  const skip = useCallback(() => {
    if (!cur) return
    session.skip(cur.q)
    salt.current += 1
    load()
  }, [cur, session, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const i = ['1', '2', '3', '4', '5'].indexOf(e.key)
      if (i >= 0) {
        e.preventDefault()
        respond(BUTTONS[i].r)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [respond])

  return (
    <div className="qa">
      <section className="section" aria-labelledby="q-title">
        <div className="q-head">
          <h2 id="q-title">どちらの1週間が、人生の満足度が高くなりそうですか？</h2>
          <div className="row">
            <button type="button" className="btn ghost small" onClick={() => void undo()} disabled={n === 0 || thinking}>
              ひとつ前を取り消す
            </button>
            <button type="button" className="btn ghost small" onClick={skip} disabled={!cur || thinking}>
              答えにくいので飛ばす
            </button>
          </div>
        </div>
        <p className="lead">
          AとBの「いつもの1週間」が、この先ずっと続くとします。始めのうれしさではなく、慣れた後の毎日を想像して選んでください。書かれていないことは今の生活と同じです。迷ったら「同じくらい」で大丈夫です。
        </p>

        {!cur && thinking && <Loading label="次の質問を選んでいます…" />}
        {!cur && !thinking && <p className="note">いまは出せる質問がありません。プロフィールを見直すと質問が増えます。</p>}
        {cur && (
          <div className="section" style={{ opacity: thinking ? 0.55 : 1, transition: 'opacity 120ms' }} aria-busy={thinking}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="chip">
                {n + 1}問目・{TEMPLATE_LABELS[cur.q.template]}
              </span>
            </div>
            {cur.q.context.length > 0 && (
              <div className="q-context">
                {cur.q.context.map((c, i) => (
                  <p key={i}>{c}</p>
                ))}
              </div>
            )}
            <div className="q-cards">
              <OptionCard tag="A" lines={cur.q.textA} />
              <OptionCard tag="B" lines={cur.q.textB} />
            </div>
            <div className="scale" role="group" aria-label="回答">
              {BUTTONS.map((b, i) => (
                <button key={b.r} type="button" className={b.r === 2 ? 'mid' : ''} onClick={() => respond(b.r)} disabled={thinking}>
                  <span>{b.label}</span>
                  <span>{b.sub}</span>
                  <span className="key">キー {i + 1}</span>
                </button>
              ))}
            </div>
            {MONEY_TEMPLATES.has(cur.q.template) && (
              <p className="note">比べる形式だと、お金の差は実際に暮らしたときより大きく感じやすいことが知られています。金額だけでなく、その暮らしを思い浮かべて選んでください。</p>
            )}
            <details>
              <summary>なぜこの質問？</summary>
              <div className="section" style={{ gap: 10 }}>
                <p className="note">{cur.q.purpose}</p>
                <p className="note">
                  これまでの回答からの予想（左から A かなり良い → B かなり良い）。予想が割れている質問ほど、答えたときに多くのことが分かります（期待情報利得{' '}
                  {cur.eig.toFixed(2)}）。
                </p>
                <div className="predict" aria-hidden="true">
                  {BUTTONS.map((b) => (
                    <span key={b.r} style={{ height: `${Math.max(4, cur.predictive[b.r] * 100)}%` }} />
                  ))}
                </div>
              </div>
            </details>
          </div>
        )}
      </section>
      <SidePanel onSeeResults={() => go('week')} />
    </div>
  )
}

function OptionCard({ tag, lines }: { tag: string; lines: string[] }) {
  return (
    <div className="q-card">
      <span className="tag">{tag}</span>
      <ul>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  )
}

function SidePanel({ onSeeResults }: { onSeeResults: () => void }) {
  const { session, saved, rev } = useApp()
  const n = saved.answers.length
  const info = useMemo(() => {
    const thetas = session.draws(DRAWS_FOR_DESIGN)
    const life = currentLife(saved.profile)
    const values = activityValues(thetas, life.state.hours, life.state.consumption, life.state.householdSize)
      .filter((v) => v.key !== 'sleep' || v.points > 0)
      .sort((a, b) => b.points - a.points)
    return { values, confidence: session.confidence(), type: personalityType(session.posterior) }
    // rev が変わったら再計算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, saved.profile, session])

  return (
    <aside className="side" aria-label="いまの推定">
      <div className="sheet tight section" style={{ gap: 8 }}>
        <h3>推定の確かさ</h3>
        <Meter value={info.confidence} label="推定の確かさ" />
        <p className="note">
          {Math.round(info.confidence * 100)}%（{n}問）。まず20〜30問で大まかな傾向、100問を超えると細かい好みまで分かってきます。
        </p>
        <button type="button" className="btn small" onClick={onSeeResults}>
          いまの結果を見る
        </button>
      </div>
      <div className="sheet tight section" style={{ gap: 8 }}>
        <h3>今の生活で「あと週1時間」増やすなら</h3>
        <ol className="rank">
          {info.values.map((v) => (
            <li key={v.key}>
              <span className="swatch" style={{ background: ACT_COLOR[v.key] }} />
              <span>{ACTIVITIES[v.key].short}</span>
              <span className="val">{v.yenPerHour > 0 ? `1時間 ≈ ${yen(Math.round(v.yenPerHour / 100) * 100)}` : 'これ以上は逆効果'}</span>
            </li>
          ))}
        </ol>
        <p className="note">追加の1時間が、お金に換えるといくら分の満足に当たるか（今の収入・時間の使い方での推定）。</p>
      </div>
      <div className="sheet tight section" style={{ gap: 6 }}>
        <h3>あなたのタイプ</h3>
        {info.type ? (
          <>
            <p className="type-name" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
              {info.type.name}
            </p>
            <p className="note">{info.type.description}</p>
          </>
        ) : (
          <p className="note">あと{Math.max(0, 12 - n)}問答えると判定します。</p>
        )}
      </div>
    </aside>
  )
}
