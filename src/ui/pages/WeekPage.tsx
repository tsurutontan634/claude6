import { useApp } from '../App'
import { ACTIVITY_KEYS, type ActivityKey } from '../../engine/types'
import { ACTIVITIES } from '../../engine/model'
import { DRAWS_FOR_PLAN, WeekPlanner, type WeekPlan } from '../../engine/session'
import { currentJob, limitsFor } from '../../engine/household'
import { activityValues, allocationRanges, meanBreakdown } from '../../engine/insights'
import { LineChart, WeekBars, useDeferred, type WeekSegment } from '../charts'
import { ACT_COLOR, ACT_DARK_TEXT, Loading, Stamp, deltaText, lsText, manYen } from '../common'
import { sleepPerNight, trimNum, yen } from '../../engine/format'
import type { UtilityBreakdown } from '../../engine/model'

function segmentsFor(hours: Record<ActivityKey, number>, fixed: { work: number; commute: number; chores: number }): WeekSegment[] {
  return [
    { key: 'work', label: '仕事', hours: fixed.work, color: 'var(--s-work)' },
    { key: 'commute', label: '通勤', hours: fixed.commute, color: 'var(--s-commute)' },
    { key: 'chores', label: '家事・身の回り', hours: fixed.chores, color: 'var(--s-chores)' },
    ...ACTIVITY_KEYS.map((k) => ({ key: k, label: ACTIVITIES[k].short, hours: hours[k], color: ACT_COLOR[k], darkText: ACT_DARK_TEXT[k] })),
  ]
}

export function WeekPage() {
  const { session, saved, rev, go } = useApp()
  const p = saved.profile
  const res = useDeferred(() => {
    const thetas = session.draws(DRAWS_FOR_PLAN)
    const wp = new WeekPlanner(p, thetas)
    const job = currentJob(p)
    const opt = wp.optimalNow()
    const uNow = wp.currentUtility()
    const ranges = allocationRanges(thetas, opt.freeHours + opt.outcome.freedHours, limitsFor(p))
    const curve = wp.hoursCurve(job, 10, 70, 1)
    const bestH = curve.reduce((a, b) => (b.utility > a.utility ? b : a))
    const valuesOpt = activityValues(thetas, opt.outcome.hours, opt.consumption - opt.outcome.spend.timeBuy, opt.state.householdSize)
    const bNow = meanBreakdown(thetas, wp.life.state)
    const bOpt = meanBreakdown(thetas, opt.state)
    const jobs = p.jobs.length > 1 ? wp.compareJobs() : null
    return { wp, job, opt, uNow, ranges, curve, bestH, valuesOpt, bNow, bOpt, jobs }
  }, [rev, p])

  if (!res) return <Loading label="あなたの効用関数で、最適な1週間を計算しています…" />
  const { wp, job, opt, uNow, ranges, curve, bestH, valuesOpt, bNow, bOpt, jobs } = res
  const gain = opt.outcome.utility - uNow
  const life = wp.life
  const choresNow = p.housework + p.personalCare + life.household.childcareMine + p.otherDuties + life.unlisted
  const choresOpt = Math.max(0, p.housework - opt.outcome.freedHours) + p.personalCare + life.household.childcareMine + p.otherDuties + life.unlisted
  const changes = ACTIVITY_KEYS.map((k) => ({ k, d: opt.outcome.hours[k] - p.currentHours[k] }))
    .filter((c) => Math.abs(c.d) >= 1)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 4)

  return (
    <>
      <section className="section" aria-labelledby="w-title">
        <div className="section-head">
          <h2 id="w-title">あなたにとって最適な1週間</h2>
          <span className="note">今の仕事・今の働き方（週{trimNum(job.weeklyHours)}時間）・今の貯蓄額のまま、時間とお金の使い方だけを入れ替えた場合</span>
        </div>
        <div className="sheet">
          <div className="kpis">
            <Stamp small="配分を見直すと" big={deltaText(gain)} />
            <div className="kpi">
              <span className="label">今の満足度（あなたの申告）</span>
              <span className="value">{lsText(p.lifeSatisfaction)}</span>
              <span className="sub">0〜10点</span>
            </div>
            <div className="kpi">
              <span className="label">最適な配分にしたときの推定</span>
              <span className="value">{lsText(p.lifeSatisfaction + gain)}</span>
              <span className="sub">{saved.answers.length < 20 ? 'まだ平均的な人の好みに近い推定です' : `${saved.answers.length}問の回答を反映`}</span>
            </div>
            <div className="kpi">
              <span className="label">自由に配分できる時間</span>
              <span className="value">週{trimNum(opt.freeHours + opt.outcome.freedHours)}時間</span>
              <span className="sub">168時間 − 仕事・通勤・家事・身の回りなど</span>
            </div>
          </div>
        </div>
        {life.unaccounted < -0.5 && (
          <p className="callout">
            プロフィールの時間の合計が168時間を{trimNum(-life.unaccounted)}時間超えています。今の生活の評価が実際より良く出ている可能性があります。プロフィールで時間を見直してください。
          </p>
        )}
        <div className="sheet section">
          <h3>1週間168時間の使い方</h3>
          <WeekBars
            rows={[
              { who: '今', segments: segmentsFor(p.currentHours, { work: job.weeklyHours, commute: life.commuteHours, chores: choresNow }) },
              { who: '最適', segments: segmentsFor(opt.outcome.hours, { work: opt.workHours, commute: opt.commuteHours, chores: choresOpt }) },
            ]}
          />
          <div className="legend">
            {[
              ['仕事', 'var(--s-work)'],
              ['通勤', 'var(--s-commute)'],
              ['家事・身の回り', 'var(--s-chores)'],
              ...ACTIVITY_KEYS.map((k) => [ACTIVITIES[k].short, ACT_COLOR[k]]),
            ].map(([l, c]) => (
              <span key={l}>
                <span className="swatch" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
          {changes.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {changes.map(({ k, d }) => (
                <li key={k}>
                  {ACTIVITIES[k].label}を週{trimNum(Math.abs(d))}時間{d > 0 ? '増やす' : '減らす'}
                  {k === 'sleep' && `（${sleepPerNight(opt.outcome.hours.sleep)}に）`}
                </li>
              ))}
              {opt.outcome.freedHours > 0.5 && <li>家事代行などに月{yen(opt.outcome.spend.timeBuy)}使い、家事を週{trimNum(opt.outcome.freedHours)}時間減らす</li>}
            </ul>
          )}
        </div>
        <div className="sheet table-wrap">
          <table>
            <caption className="note" style={{ textAlign: 'left', paddingBottom: 6 }}>
              「最適」の幅は、推定の不確かさ（あり得るあなたの好みの範囲）で最適な時間がどれくらい動くか。回答が増えると狭くなります。
            </caption>
            <thead>
              <tr>
                <th>活動</th>
                <th className="num">今</th>
                <th className="num">最適</th>
                <th className="num">幅</th>
                <th className="num">変化</th>
                <th className="num">最適時のあと1時間の価値</th>
              </tr>
            </thead>
            <tbody>
              {ACTIVITY_KEYS.map((k) => {
                const d = opt.outcome.hours[k] - p.currentHours[k]
                const v = valuesOpt.find((x) => x.key === k)!
                return (
                  <tr key={k}>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <span className="swatch" style={{ background: ACT_COLOR[k] }} />
                        {ACTIVITIES[k].label}
                      </span>
                    </td>
                    <td className="num">{trimNum(p.currentHours[k])}h</td>
                    <td className="num">
                      <strong>{trimNum(opt.outcome.hours[k])}h</strong>
                    </td>
                    <td className="num">
                      {trimNum(ranges[k][0])}〜{trimNum(ranges[k][1])}h
                    </td>
                    <td className={'num ' + (d > 0.4 ? 'up' : d < -0.4 ? 'down' : '')}>{Math.abs(d) < 0.25 ? '—' : `${d > 0 ? '+' : '−'}${trimNum(Math.abs(d))}h`}</td>
                    <td className="num">{v.yenPerHour > 0 ? yen(Math.round(v.yenPerHour / 100) * 100) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" aria-labelledby="h-title">
        <div className="section-head">
          <h2 id="h-title">働く時間を変えられたら？</h2>
          <span className="note">時給は同じ・貯蓄額も同じと仮定。{!job.hoursFlexible && '今の仕事は時間を調整できない設定なので、あくまで仮定の話です。'}</span>
        </div>
        <div className="sheet section">
          <p>
            あなたにとって満足度が最も高い労働時間は<strong>週{bestH.hours}時間</strong>
            （今は週{trimNum(job.weeklyHours)}時間、差は{deltaText(bestH.utility - opt.outcome.utility)}）。
            {Math.abs(bestH.hours - job.weeklyHours) <= 3 ? '今の働き方は、あなたにとってほぼちょうど良い長さです。' : bestH.hours < job.weeklyHours ? '収入が減っても、時間を取るほうが満足度は上がる推定です。' : '時間を少し削っても、収入を増やすほうが満足度は上がる推定です。'}
          </p>
          <LineChart
            ariaLabel="週の労働時間ごとの満足度の推定"
            series={[
              {
                id: 'u',
                name: '満足度の変化',
                color: 'var(--s-sleep)',
                points: curve.map((c) => ({ x: c.hours, y: p.lifeSatisfaction + (c.utility - uNow) })),
              },
            ]}
            markers={[
              { x: job.weeklyHours, y: p.lifeSatisfaction + (opt.outcome.utility - uNow), label: '今', color: 'var(--ink)' },
              { x: bestH.hours, y: p.lifeSatisfaction + (bestH.utility - uNow), label: '最適', color: 'var(--accent)' },
            ]}
            xFormat={(v) => `${v}h`}
            yFormat={(v) => v.toFixed(1)}
            yLabel="満足度（点）"
            tipTitle={(x) => `週${x}時間働く`}
            tipValue={(_s, y) => `${y.toFixed(2)}点`}
          />
          <p className="note">
            週{curve[0].hours}時間：世帯の手取り月{manYen(curve[0].netMonthly)}／週40時間：月{manYen(curve.find((c) => c.hours === 40)?.netMonthly ?? 0)}／週60時間：月
            {manYen(curve.find((c) => c.hours === 60)?.netMonthly ?? 0)}。週45時間を超えると長時間労働のつらさが2乗で効いてきます。
          </p>
        </div>
        {jobs && (
          <div className="sheet table-wrap">
            <table>
              <thead>
                <tr>
                  <th>仕事の候補</th>
                  <th className="num">年収</th>
                  <th className="num">今の条件で</th>
                  <th className="num">時間も最適化</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(({ job: j, fixed, best }) => (
                  <tr key={j.id}>
                    <td>
                      {j.name}
                      {j.id === p.currentJobId && <span className="chip" style={{ marginLeft: 6 }}>今の仕事</span>}
                    </td>
                    <td className="num">{manYen(j.annualIncome, 0)}</td>
                    <td className="num">{deltaText(fixed.outcome.utility - opt.outcome.utility)}</td>
                    <td className="num">
                      {deltaText(best.outcome.utility - opt.outcome.utility)}（週{trimNum(best.workHours)}h）
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="b-title">
        <h2 id="b-title">満足度の内訳</h2>
        <Breakdown now={bNow} opt={bOpt} />
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => go('money')}>
            お金の使い道を見る
          </button>
          <button type="button" className="btn ghost" onClick={() => go('life')}>
            人生計画を見る
          </button>
        </div>
      </section>
    </>
  )
}

function Breakdown({ now, opt }: { now: UtilityBreakdown; opt: UtilityBreakdown }) {
  const rows: { label: string; a: number; b: number; color?: string }[] = [
    ...ACTIVITY_KEYS.map((k) => ({ label: ACTIVITIES[k].label, a: now.activities[k], b: opt.activities[k], color: ACT_COLOR[k] })),
    { label: '消費（使えるお金の多さ）', a: now.money, b: opt.money },
    { label: 'お金の使い道の上乗せ', a: now.spendMix, b: opt.spendMix },
    { label: '貯金の安心感', a: now.security, b: opt.security },
    { label: '仕事そのもの', a: now.work, b: opt.work },
    { label: '通勤のつらさ', a: now.commute, b: opt.commute },
    { label: '家事・ひとり時間の取りすぎ', a: now.other, b: opt.other },
  ]
  return (
    <div className="sheet table-wrap">
      <table>
        <caption className="note" style={{ textAlign: 'left', paddingBottom: 6 }}>
          各項目が満足度に何点ぶん効いているか（その活動が週0時間の状態、消費が基準水準の状態などを0点とした推定）。
        </caption>
        <thead>
          <tr>
            <th>項目</th>
            <th className="num">今</th>
            <th className="num">最適</th>
            <th className="num">差</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>
                <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  {r.color ? <span className="swatch" style={{ background: r.color }} /> : <span className="swatch" style={{ background: 'transparent' }} />}
                  {r.label}
                </span>
              </td>
              <td className="num">{r.a.toFixed(2)}</td>
              <td className="num">{r.b.toFixed(2)}</td>
              <td className={'num ' + (r.b - r.a > 0.005 ? 'up' : r.b - r.a < -0.005 ? 'down' : '')}>{deltaText(r.b - r.a)}</td>
            </tr>
          ))}
          <tr>
            <td>
              <strong>合計</strong>
            </td>
            <td className="num">{now.total.toFixed(2)}</td>
            <td className="num">{opt.total.toFixed(2)}</td>
            <td className="num">
              <strong>{deltaText(opt.total - now.total)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export type { WeekPlan }
