import { useApp } from '../App'
import { DRAWS_FOR_PLAN, WeekPlanner } from '../../engine/session'
import { CAO_INCOME_BANDS, activityValues, moneyCurve, moneyMarginal } from '../../engine/insights'
import { grossAtHours, currentJob, partnerAt } from '../../engine/household'
import { LineChart, PairBars, useDeferred } from '../charts'
import { Loading, deltaText, manYen } from '../common'
import { yen } from '../../engine/format'
import { N_PARAMS, P_SECM, P_SECMAX, SPENDS } from '../../engine/model'
import { SPEND_KEYS } from '../../engine/types'

const SPEND_COLOR = {
  experience: 'var(--s-sleep)',
  goods: 'var(--s-friends)',
  social: 'var(--s-family)',
  timeBuy: 'var(--s-learning)',
} as const

export function MoneyPage() {
  const { session, saved, rev, go } = useApp()
  const p = saved.profile
  const res = useDeferred(() => {
    const thetas = session.draws(DRAWS_FOR_PLAN)
    const wp = new WeekPlanner(p, thetas)
    const job = currentJob(p)
    const opt = wp.optimalNow()
    const life = wp.life
    const householdGross = grossAtHours(job, job.weeklyHours) + (partnerAt(p, p.age) ? p.partnerIncome : 0)
    const curve = moneyCurve(p, thetas, householdGross, life.consumption)
    const mu = moneyMarginal(thetas, life.consumption - life.state.spend.timeBuy, life.state.householdSize)
    const values = activityValues(thetas, p.currentHours, life.consumption - life.state.spend.timeBuy, life.state.householdSize)
    const freeValue = Math.max(...values.map((v) => v.yenPerHour))
    // 安心感のカーブ（月数 → 点）
    const k = thetas.length / N_PARAMS
    const sec = Array.from({ length: 49 }, (_, i) => {
      const m = i * 0.5
      let s = 0
      for (let j = 0; j < k; j++) s += thetas[j * N_PARAMS + P_SECMAX] * (1 - Math.exp(-m / thetas[j * N_PARAMS + P_SECM]))
      return { x: m, y: s / k }
    })
    // 年収が 2倍 / 半分 になったら
    const at = (f: number) => {
      const target = (householdGross * f) / 10_000
      const pt = curve.reduce((a, b) => (Math.abs(Math.log(b.income / target)) < Math.abs(Math.log(a.income / target)) ? b : a))
      return pt.ls - p.lifeSatisfaction
    }
    return { opt, life, householdGross, curve, mu, freeValue, sec, double: at(2), half: at(0.5), wp }
  }, [rev, p])

  if (!res) return <Loading label="お金と満足度の関係を計算しています…" />
  const { opt, life, householdGross, curve, mu, freeValue, sec, double, half } = res
  const assetsMonths = life.state.assetsMonths
  const discretionary = Math.max(0, life.consumption - life.necessities)
  const secNow = sec.reduce((a, b) => (Math.abs(b.x - Math.min(24, assetsMonths)) < Math.abs(a.x - Math.min(24, assetsMonths)) ? b : a))

  return (
    <>
      <section className="section" aria-labelledby="m-title">
        <div className="section-head">
          <h2 id="m-title">お金はどこまで幸せを増やすか</h2>
          <span className="note">世帯の額面年収 {manYen(householdGross, 0)}・世帯の月の消費 {manYen(life.consumption)}（貯蓄・教育費を除く）</span>
        </div>
        <div className="sheet">
          <div className="kpis">
            <div className="kpi">
              <span className="label">年収が今の2倍になったら</span>
              <span className="value">{deltaText(double)}</span>
              <span className="sub">同じ貯蓄率で使うと仮定</span>
            </div>
            <div className="kpi">
              <span className="label">年収が今の半分になったら</span>
              <span className="value">{deltaText(half)}</span>
              <span className="sub">減るときの方が大きく効く</span>
            </div>
            <div className="kpi">
              <span className="label">月1万円の価値</span>
              <span className="value">{deltaText(mu * 10_000, 3)}</span>
              <span className="sub">消費が月1万円増えたとき</span>
            </div>
            <div className="kpi">
              <span className="label">あなたの自由時間1時間の価値</span>
              <span className="value">約{yen(Math.round(freeValue / 100) * 100)}</span>
              <span className="sub">いま一番効く活動に使った場合</span>
            </div>
          </div>
        </div>
        <div className="sheet section">
          <h3>年収と満足度：あなたの推定と、日本全体の平均</h3>
          <LineChart
            ariaLabel="世帯年収と人生満足度の関係"
            xLog
            series={[
              {
                id: 'me',
                name: 'あなたの推定（中央値と80%の幅）',
                color: 'var(--s-sleep)',
                points: curve.map((c) => ({ x: c.income, y: c.ls })),
                band: curve.map((c) => ({ x: c.income, lo: c.lo, hi: c.hi })),
              },
              {
                id: 'cao',
                name: '日本の世帯年収別の平均（内閣府 2019）',
                color: 'var(--s-friends)',
                dotsOnly: true,
                points: CAO_INCOME_BANDS.map((b) => ({ x: b.mid, y: b.ls })),
              },
            ]}
            markers={[{ x: householdGross / 10_000, y: p.lifeSatisfaction, label: '今', color: 'var(--ink)' }]}
            xTicks={[100, 200, 400, 700, 1000, 2000, 4000, 8000]}
            xFormat={(v) => (v >= 1000 ? `${v / 1000}千万` : `${v}万`)}
            yFormat={(v) => v.toFixed(1)}
            yLabel="満足度（点）"
            tipTitle={(x) => `世帯年収 約${Math.round(x)}万円`}
            tipValue={(_s, y) => `${y.toFixed(2)}点`}
          />
          <p className="note">
            日本の平均は内閣府「満足度・生活の質に関する調査」（2019）の世帯年収帯ごとの平均値で、年収帯の中央に点を置いています。2,000〜3,000万円で頂点になり、それ以上ではわずかに下がります（高年収帯は回答者が少なく不確か）。あなたの線は、今の年収と今の満足度を基準に、推定した「お金の頭打ちの強さ」で描いています。年齢・健康・家族など他の条件は今のままとした場合の、お金だけの効果です。
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="s-title">
        <div className="section-head">
          <h2 id="s-title">自由に使えるお金の使い道</h2>
          <span className="note">月 {manYen(Math.max(0, life.consumption - life.necessities))}（消費 − 家賃・食費などの必需的支出）</span>
        </div>
        <div className="sheet section">
          <PairBars
            aLabel="今"
            bLabel="おすすめ"
            format={(v) => manYen(v)}
            rows={[
              ...SPEND_KEYS.map((key) => ({
                key,
                label: SPENDS[key].label,
                color: SPEND_COLOR[key],
                a: life.state.spend[key],
                b: opt.outcome.spend[key],
              })),
              {
                key: 'other',
                label: 'その他',
                color: 'var(--s-chores)',
                a: Math.max(0, discretionary - SPEND_KEYS.reduce((t, k) => t + life.state.spend[k], 0)),
                b: Math.max(0, discretionary - SPEND_KEYS.reduce((t, k) => t + opt.outcome.spend[k], 0)),
              },
            ]}
          />
          <ul style={{ margin: 0, paddingLeft: '1.2em' }} className="note">
            {SPEND_KEYS.map((key) => (
              <li key={key}>
                {SPENDS[key].label}：{SPENDS[key].example}
              </li>
            ))}
            <li>その他：ふだんの買い物や外食など、特に分けずに使うお金（上乗せ効果はないが、消費としての満足はある）</li>
          </ul>
          <p className="note">
            体験・人のための支出は「同じ金額のふつうの消費」より満足を生みやすいという研究に基づく上乗せを、あなたの回答で調整しています。上乗せは少額ほど大きく、ある程度を超えると「その他（ふつうの消費）」と変わらなくなるので、そこから先はどう使っても同じとみなしています。「時間を買う」は家事代行1時間 {yen(3000)} として、浮いた時間の価値と比べて決めています。おすすめの使い方での上乗せ効果は合計 {deltaText(opt.outcome.spendUtility)} の推定です。
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="sec-title">
        <div className="section-head">
          <h2 id="sec-title">貯金の安心感</h2>
          <span className="note">今の貯金は生活費の約{assetsMonths.toFixed(1)}か月分</span>
        </div>
        <div className="sheet section">
          <LineChart
            ariaLabel="貯金の月数と安心感"
            series={[{ id: 'sec', name: '安心感', color: 'var(--s-family)', points: sec }]}
            markers={[{ x: Math.min(24, assetsMonths), y: secNow.y, label: '今', color: 'var(--ink)' }]}
            xFormat={(v) => `${v}か月`}
            yFormat={(v) => v.toFixed(2)}
            yLabel="安心感（点）"
            tipTitle={(x) => `生活費の${x}か月分`}
            tipValue={(_s, y) => `${y.toFixed(2)}点`}
            height={220}
          />
          <p className="note">
            手元の貯金は、収入とは別に満足度を上げます（Ruberton ほか 2016）。効果は最初の数か月分が大きく、生活費の半年〜1年分を超えると上積みは小さくなります。将来のための貯蓄額は「人生計画」で、老後まで含めて最適化しています。
          </p>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => go('life')}>
              人生計画で貯蓄額を見る
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
