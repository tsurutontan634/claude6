import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../App'
import { DRAWS_FOR_PLAN, WeekPlanner } from '../../engine/session'
import { LifeSimulator, defaultStages, lifeEvents, presetPolicies, type LifeAssumptions, type LifePolicy, type LifeResult } from '../../engine/lifeplan'
import { currentJob, householdAt } from '../../engine/household'
import { LineChart, useDeferred } from '../charts'
import { Loading, NumberField, RangeField, Seg, deltaText, lsText, manYen } from '../common'
import { trimNum } from '../../engine/format'

const PLAN_COLOR: Record<string, string> = {
  current: 'var(--s-sleep)',
  'current-opt': 'var(--s-family)',
  hustle: 'var(--s-friends)',
  custom: 'var(--s-hobby)',
  fire: 'var(--s-rest)',
  relaxed: 'var(--s-exercise)',
  best: 'var(--s-learning)',
}

const MAX_PLOTTED = 4

export function LifePage() {
  const { session, saved, rev, setAssumptions, setCustomPolicy } = useApp()
  const p = saved.profile
  const A = saved.assumptions
  // スライダーは手元で動かし、止まってから保存・再計算する
  const [aLocal, setALocal] = useState<LifeAssumptions>(A)
  useEffect(() => setALocal(A), [A])
  useEffect(() => {
    if (JSON.stringify(aLocal) === JSON.stringify(A)) return
    const t = setTimeout(() => setAssumptions(aLocal), 300)
    return () => clearTimeout(t)
  }, [aLocal, A, setAssumptions])
  const [selected, setSelected] = useState<string[]>(['current', 'current-opt'])
  const [best, setBest] = useState<LifeResult | null>(null)
  const [searching, setSearching] = useState<number | null>(null)
  const [detail, setDetail] = useState<string>('current-opt')

  const custom: LifePolicy = useMemo(() => {
    const job = currentJob(p)
    const stored = saved.customPolicy && saved.customPolicy.stages[0]?.from === p.age ? saved.customPolicy : null
    const retireAge = Math.max(p.retireAge, p.age + 1)
    return (
      stored ?? {
        id: 'custom',
        name: '自分で作るプラン',
        description: '労働時間・引退年齢・貯蓄の方針を自分で決める',
        stages: defaultStages(p.age, job.weeklyHours, retireAge),
        retireAge,
        jobId: job.id,
        saving: 'optimal',
      }
    )
  }, [saved.customPolicy, p])

  const { value: base, pending } = useDeferred(() => {
    const thetas = session.draws(DRAWS_FOR_PLAN)
    const sim = new LifeSimulator(p, thetas, A)
    const presets = presetPolicies(p)
    const results = presets.map((pol) => sim.simulate(pol))
    const wp = new WeekPlanner(p, thetas)
    const uRef = wp.currentUtility() + lifeEvents(p, presets[0], p.age, householdAt(p, p.age))
    return { sim, results, uRef }
  }, [rev, p, A])

  const customResult = useMemo(() => (base ? base.sim.simulate(custom) : null), [base, custom])

  // 前提や回答が変わったら、探索済みの最適プランは古くなる
  const baseRef = useRef(base)
  baseRef.current = base
  useEffect(() => {
    setBest(null)
    setSelected((s) => s.filter((id) => id !== 'best'))
  }, [base])

  const runSearch = async () => {
    if (!base) return
    const token = base
    setSearching(0)
    const startPolicy: LifePolicy = {
      ...base.results[1].policy,
      id: 'best',
      name: 'おすすめ（最適化）',
      description: '年代ごとの労働時間と引退年齢を、生涯の満足度が最大になるよう探索したプラン',
    }
    const r = await base.sim.optimizeAsync(startPolicy, { onProgress: (f) => setSearching(f) })
    setSearching(null)
    // 探索中に前提や回答が変わっていたら、その結果は使わない
    if (baseRef.current !== token) return
    setBest(r)
    setSelected((s) => (s.includes('best') ? s : [...s.slice(0, MAX_PLOTTED - 1), 'best']))
    setDetail('best')
  }

  const setA = (patch: Partial<LifeAssumptions>) => setALocal((a) => ({ ...a, ...patch }))

  if (!base || !customResult)
    return (
      <>
        <Loading label="人生計画を年ごとにシミュレーションしています…" />
        <AssumptionsForm A={aLocal} setA={setA} disabled={false} />
      </>
    )
  const { results, uRef } = base
  const all: LifeResult[] = [...results, customResult, ...(best ? [{ ...best, policy: { ...best.policy, id: 'best', name: 'おすすめ（最適化）' } }] : [])]
  const byId = new Map(all.map((r) => [r.policy.id, r]))
  const shown = selected.filter((id) => byId.has(id)).slice(0, MAX_PLOTTED)
  const toLs = (u: number) => p.lifeSatisfaction + (u - uRef)
  const detailRes = byId.get(detail) ?? results[1]
  const toggle = (id: string) => {
    const cur = shown
    setSelected(cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PLOTTED ? [...cur.slice(1), id] : [...cur, id])
  }

  return (
    <>
      <section className="section" aria-labelledby="l-title">
        <div className="section-head">
          <h2 id="l-title">人生計画のシミュレーション</h2>
          <span className="note">
            {p.age}歳から100歳まで、1年ごとに収入・年金・教育費・家族の時間を計算し、毎年いくら使うかを最適化{pending && '（更新中…）'}
          </span>
        </div>
        <div className="sheet section">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>比べるプラン（最大{MAX_PLOTTED}つ）</h3>
            <button type="button" className="btn small" onClick={() => void runSearch()} disabled={searching !== null}>
              {searching !== null ? `探索中… ${Math.round(searching * 100)}%` : best ? 'もう一度探す' : 'おすすめのプランを探す'}
            </button>
          </div>
          <div className="row">
            {all.map((r) => (
              <label key={r.policy.id} className="chip" style={{ cursor: 'pointer', gap: 6 }}>
                <input type="checkbox" checked={shown.includes(r.policy.id)} onChange={() => toggle(r.policy.id)} />
                <span className="swatch" style={{ background: PLAN_COLOR[r.policy.id] ?? 'var(--ink-2)' }} />
                {r.policy.name}
              </label>
            ))}
          </div>
          {!best && searching === null && <p className="note">「おすすめのプランを探す」で、年代ごとの労働時間（週20〜55時間）と引退年齢（70歳まで）を変えた数十通りを比べ、生涯の満足度が最も高いものを探します（数秒かかります）。</p>}
          <LineChart
            ariaLabel="年齢ごとの満足度の推定"
            series={shown.map((id) => {
              const r = byId.get(id)!
              return { id, name: r.policy.name, color: PLAN_COLOR[id] ?? 'var(--ink-2)', points: r.years.filter((y) => y.age <= 95).map((y) => ({ x: y.age, y: toLs(y.utility) })) }
            })}
            xFormat={(v) => `${v}歳`}
            yFormat={(v) => v.toFixed(1)}
            yLabel="満足度（点）"
            tipTitle={(x) => `${x}歳`}
            tipValue={(_s, y) => `${y.toFixed(2)}点`}
          />
          <p className="note">
            その年の「1週間」を最適に過ごした場合の満足度の推定です。結婚・出産の一時的な上昇と慣れ、育児の時間、引退後の自由時間、貯金の安心感を含みます。健康の衰えや病気、離婚・死別などの出来事は含みません。
          </p>
        </div>
        <div className="sheet section">
          <h3>資産の推移（今の物価で）</h3>
          <LineChart
            ariaLabel="年齢ごとの金融資産"
            series={shown.map((id) => {
              const r = byId.get(id)!
              return { id, name: r.policy.name, color: PLAN_COLOR[id] ?? 'var(--ink-2)', points: r.years.filter((y) => y.age <= 95).map((y) => ({ x: y.age, y: y.assets / 10_000 })) }
            })}
            xFormat={(v) => `${v}歳`}
            yFormat={(v) => (Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}億` : `${Math.round(v)}万`)}
            tipTitle={(x) => `${x}歳の年初`}
            tipValue={(_s, y) => manYen(y * 10_000, 0)}
            height={220}
          />
        </div>
        <div className="sheet table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th>プラン</th>
                <th className="num">生涯の平均満足度</th>
                <th className="num">今の貯蓄（月）</th>
                <th className="num">引退時の資産</th>
                <th className="num">引退</th>
                <th className="num">資金不足の年</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.policy.id}>
                  <td>
                    <button type="button" className="linkish" onClick={() => setDetail(r.policy.id)}>
                      {r.policy.name}
                    </button>
                    <div className="note">{r.policy.description}</div>
                  </td>
                  <td className="num">
                    <strong>{lsText(toLs(r.score))}</strong>
                    <div className="note">{deltaText(r.score - results[0].score)}</div>
                  </td>
                  <td className="num">{manYen(r.years[0].saving / 12)}</td>
                  <td className="num">{manYen(r.assetsAtRetire, 0)}</td>
                  <td className="num">{r.policy.retireAge}歳</td>
                  <td className="num">{r.shortfallYears > 0 ? <span className="down">{r.shortfallYears}年</span> : 'なし'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note" style={{ paddingTop: 8 }}>
            生涯の平均満足度は、年ごとの満足度を生存確率と時間の割引で重み付けした平均です。差は「今のまま」との比較。
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="c-title">
        <h2 id="c-title">自分でプランを作る</h2>
        <CustomEditor policy={custom} onChange={setCustomPolicy} />
      </section>

      <AssumptionsForm A={aLocal} setA={setA} disabled={searching !== null} />

      <section className="section" aria-labelledby="d-title">
        <div className="section-head">
          <h2 id="d-title">年ごとの明細：{detailRes.policy.name}</h2>
          <span className="note">表の行が多いので5年ごとに表示</span>
        </div>
        <div className="sheet table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th className="num">年齢</th>
                <th className="num">労働</th>
                <th className="num">自由時間</th>
                <th className="num">世帯の手取り</th>
                <th className="num">教育費</th>
                <th className="num">消費（月）</th>
                <th className="num">貯蓄（年）</th>
                <th className="num">資産</th>
                <th className="num">満足度</th>
              </tr>
            </thead>
            <tbody>
              {detailRes.years
                .filter((y, i) => i === 0 || y.age % 5 === 0)
                .filter((y) => y.age <= 95)
                .map((y) => (
                  <tr key={y.age}>
                    <td className="num">{y.age}歳</td>
                    <td className="num">{y.workHours > 0 ? `${trimNum(y.workHours)}h` : '引退'}</td>
                    <td className="num">{trimNum(y.freeHours)}h</td>
                    <td className="num">{manYen(y.income, 0)}</td>
                    <td className="num">{y.education > 0 ? manYen(y.education, 0) : '—'}</td>
                    <td className="num">{manYen(y.consumption)}</td>
                    <td className={'num ' + (y.saving < 0 ? 'down' : '')}>{manYen(y.saving, 0)}</td>
                    <td className="num">{manYen(y.assets, 0)}</td>
                    <td className="num">{toLs(y.utility).toFixed(1)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function CustomEditor({ policy, onChange }: { policy: LifePolicy; onChange: (p: LifePolicy) => void }) {
  const { saved } = useApp()
  const p = saved.profile
  const set = (patch: Partial<LifePolicy>) => onChange({ ...policy, ...patch })
  return (
    <div className="sheet section">
      <div className="form-grid">
        {policy.stages.map((st, i) => {
          // 引退後に始まる区切りは使われないので出さない
          if (st.from >= policy.retireAge) return null
          const until = Math.min(policy.stages[i + 1]?.from ?? Infinity, policy.retireAge) - 1
          return (
            <RangeField
              key={st.from}
              id={`c-stage-${i}`}
              label={until > st.from ? `${st.from}〜${until}歳の労働時間` : `${st.from}歳の労働時間`}
              value={st.hours}
              min={10}
              max={65}
              step={5}
              onChange={(v) => set({ stages: policy.stages.map((s, j) => (j === i ? { ...s, hours: v } : s)) })}
              format={(v) => `週${v}時間`}
            />
          )
        })}
        <RangeField
          id="c-retire"
          label="引退する年齢"
          value={policy.retireAge}
          min={p.age + 1}
          max={Math.max(80, p.age + 2)}
          step={1}
          onChange={(v) => set({ retireAge: v })}
          format={(v) => `${v}歳`}
        />
        {p.jobs.length > 1 && (
          <div className="field">
            <label htmlFor="c-job">仕事</label>
            <select id="c-job" value={policy.jobId} onChange={(e) => set({ jobId: e.target.value })}>
              {p.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Seg
          label="毎年の消費と貯蓄"
          value={policy.saving}
          options={[
            { value: 'optimal', label: '最適化する' },
            { value: 'current', label: '今の貯蓄率のまま' },
          ]}
          onChange={(v) => set({ saving: v })}
        />
      </div>
    </div>
  )
}

function AssumptionsForm({ A, setA, disabled }: { A: LifeAssumptions; setA: (p: Partial<LifeAssumptions>) => void; disabled: boolean }) {
  return (
    <section className="section" aria-labelledby="a-title">
      <h2 id="a-title">前提条件</h2>
      <fieldset className="sheet form-grid" disabled={disabled}>
        <RangeField id="a-ret" label="運用利回り（物価上昇を除いた実質）" value={A.realReturn * 100} min={-1} max={5} step={0.5} onChange={(v) => setA({ realReturn: v / 100 })} format={(v) => `${v.toFixed(1)}%`} hint="預金中心なら0%前後、株式中心の分散投資なら2〜4%が目安" />
        <RangeField id="a-wage" label="賃金の上昇（年齢による昇給とは別）" value={A.realWageGrowth * 100} min={0} max={2} step={0.25} onChange={(v) => setA({ realWageGrowth: v / 100 })} format={(v) => `${v.toFixed(2)}%/年`} hint="財政検証の想定は0.5〜1.5%" />
        <RangeField id="a-steep" label="年功カーブの急さ" value={A.careerSteepness} min={0} max={1.5} step={0.1} onChange={(v) => setA({ careerSteepness: v })} format={(v) => (Math.abs(v - 1) < 1e-9 ? '統計どおり' : `${v.toFixed(1)}倍`)} hint="0なら年齢で給料が変わらない" />
        <RangeField id="a-pen" label="将来の年金の水準" value={A.pensionFactor * 100} min={60} max={100} step={5} onChange={(v) => setA({ pensionFactor: v / 100 })} format={(v) => `今の${v}%`} hint="財政検証の悲観〜楽観で70〜95%程度" />
        <RangeField id="a-disc" label="将来の幸せをどれだけ割り引くか" value={A.discount * 100} min={0} max={3} step={0.5} onChange={(v) => setA({ discount: v / 100 })} format={(v) => `${v.toFixed(1)}%/年`} hint="0%なら今の幸せも将来の幸せも同じ重さ" />
        <NumberField
          id="a-bonus"
          label="退職金（手取り）"
          value={A.retirementBonus / 10_000}
          unit="万円"
          step={100}
          min={0}
          max={10_000}
          onChange={(v) => setA({ retirementBonus: Math.max(0, v) * 10_000 })}
          hint="大企業の勤続が長い大卒で平均約1,900万円、転職が多ければ0"
        />
      </fieldset>
    </section>
  )
}
