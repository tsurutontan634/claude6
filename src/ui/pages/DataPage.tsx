import { useState } from 'react'
import { useApp } from '../App'
import { exportJSON, freshSaved, inEmbeddedFrame, validateSaved } from '../store'
import { RESPONSE_LABELS } from '../../engine/choice'
import { TEMPLATE_LABELS } from '../../engine/questions'

export function DataPage() {
  const { saved, replaceAll, toast } = useApp()
  const [json, setJson] = useState('')
  const [pasted, setPasted] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<null | 'answers' | 'all' | 'import'>(null)
  const embedded = inEmbeddedFrame()

  const makeExport = () => setJson(exportJSON(saved))

  const copy = async () => {
    const text = json || exportJSON(saved)
    if (!json) setJson(text)
    try {
      await navigator.clipboard.writeText(text)
      toast('コピーしました。メモアプリなどに貼り付けて保存してください')
    } catch {
      const el = document.getElementById('export-text') as HTMLTextAreaElement | null
      el?.select()
      toast('自動でコピーできませんでした。選択された文字をコピーしてください')
    }
  }

  const download = () => {
    const blob = new Blob([json || exportJSON(saved)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shiawase-haibun-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const parsed = (() => {
    if (!pasted.trim()) return null
    try {
      return validateSaved(JSON.parse(pasted))
    } catch {
      return null
    }
  })()

  const doImport = async () => {
    if (!parsed) return
    await replaceAll(parsed)
    setPasted('')
    setConfirm(null)
    toast(`読み込みました（回答 ${parsed.answers.length}問）`)
  }

  return (
    <>
      <section className="section" aria-labelledby="dt-title">
        <h2 id="dt-title">データ管理</h2>
        <p className="lead">
          プロフィールと回答はこのブラウザの中にだけ保存され、外部には送られません。ブラウザのデータを消すと失われるので、ときどき書き出して保管してください。別の端末で続きをするときも、書き出したデータを読み込めば続きから使えます。
        </p>
      </section>

      <section className="sheet section" aria-labelledby="ex-title">
        <h3 id="ex-title">書き出す</h3>
        <div className="row">
          <button type="button" className="btn" onClick={() => void copy()}>
            JSONをコピー
          </button>
          {!embedded && (
            <button type="button" className="btn ghost" onClick={download}>
              ファイルに保存
            </button>
          )}
          <button type="button" className="btn ghost small" onClick={makeExport}>
            中身を表示
          </button>
        </div>
        {json && <textarea id="export-text" readOnly value={json} rows={8} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />}
        <p className="note">回答 {saved.answers.length}問・プロフィール・人生計画の前提が含まれます。</p>
      </section>

      <section className="sheet section" aria-labelledby="im-title">
        <h3 id="im-title">読み込む</h3>
        <div className="field">
          <label htmlFor="import-file">書き出したファイルを選ぶ</label>
          <input
            id="import-file"
            type="file"
            accept="application/json,.json,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const r = new FileReader()
              r.onload = () => {
                setPasted(String(r.result ?? ''))
                setError(null)
              }
              r.onerror = () => setError('ファイルを読めませんでした')
              r.readAsText(f)
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="import-text">または、コピーしたJSONを貼り付ける</label>
          <textarea id="import-text" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{"format":"shiawase-haibun", ...}' />
        </div>
        {pasted.trim() && !parsed && <p className="callout">しあわせ配分帳のデータとして読めませんでした。書き出した文字列の全体を貼り付けてください。</p>}
        {error && <p className="callout">{error}</p>}
        {parsed &&
          (confirm === 'import' ? (
            <div className="row">
              <span>今のデータ（回答 {saved.answers.length}問）を、読み込むデータ（回答 {parsed.answers.length}問）で置き換えます。</span>
              <button type="button" className="btn" onClick={() => void doImport()}>
                置き換える
              </button>
              <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>
                やめる
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="btn" onClick={() => setConfirm('import')}>
                読み込む（回答 {parsed.answers.length}問）
              </button>
            </div>
          ))}
      </section>

      <section className="sheet section" aria-labelledby="rs-title">
        <h3 id="rs-title">やり直す</h3>
        {confirm === 'answers' || confirm === 'all' ? (
          <div className="row">
            <span>{confirm === 'answers' ? `回答 ${saved.answers.length}問をすべて消します。プロフィールは残ります。` : 'プロフィールも回答もすべて消して、サンプルの状態に戻します。'}</span>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const next = confirm === 'answers' ? { ...saved, answers: [] } : freshSaved()
                setConfirm(null)
                await replaceAll(next)
                toast(confirm === 'answers' ? '回答を消しました' : 'はじめの状態に戻しました')
              }}
            >
              消す
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>
              やめる
            </button>
          </div>
        ) : (
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setConfirm('answers')} disabled={saved.answers.length === 0}>
              回答だけ消す
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirm('all')}>
              すべて消す
            </button>
          </div>
        )}
      </section>

      {saved.answers.length > 0 && (
        <section className="sheet section" aria-labelledby="hist-title">
          <h3 id="hist-title">回答の履歴（新しい順・最大30件）</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>種類</th>
                  <th>A</th>
                  <th>B</th>
                  <th>回答</th>
                </tr>
              </thead>
              <tbody>
                {saved.answers
                  .map((a, i) => ({ a, i }))
                  .slice(-30)
                  .reverse()
                  .map(({ a, i }) => (
                    <tr key={i}>
                      <td className="num">{i + 1}</td>
                      <td>{TEMPLATE_LABELS[a.question.template]}</td>
                      <td className="note">{a.question.textA.join('／')}</td>
                      <td className="note">{a.question.textB.join('／')}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{RESPONSE_LABELS[a.response]}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
