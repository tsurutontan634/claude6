import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../App'
import type { ActivityKey, ChildPlan, JobOption, Profile } from '../../engine/types'
import { ACTIVITY_KEYS } from '../../engine/types'
import { ACTIVITIES, SPENDS } from '../../engine/model'
import { SPEND_KEYS } from '../../engine/types'
import { commuteAtHours, currentLife, householdAt } from '../../engine/household'
import { takeHome } from '../../engine/tax'
import { sampleProfile } from '../../engine/sample'
import { ACT_COLOR, ACT_DARK_TEXT, NumberField, RangeField, Seg, manYen } from '../common'
import { WeekBars } from '../charts'
import { sleepPerNight, trimNum } from '../../engine/format'

const LIKING = [
  { value: 1, label: '苦手' },
  { value: 2, label: 'やや苦手' },
  { value: 3, label: 'ふつう' },
  { value: 4, label: '好き' },
  { value: 5, label: '大好き' },
]

export function ProfilePage() {
  const { saved, setProfile, toast, go } = useApp()
  const [d, setD] = useState<Profile>(saved.profile)
  useEffect(() => setD(saved.profile), [saved.profile])
  const dirty = JSON.stringify(d) !== JSON.stringify(saved.profile)
  const set = (patch: Partial<Profile>) => setD((x) => ({ ...x, ...patch }))
  const job = d.jobs.find((j) => j.id === d.currentJobId) ?? d.jobs[0]
  const setJob = (id: string, patch: Partial<JobOption>) => set({ jobs: d.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })

  const life = useMemo(() => currentLife(d), [d])
  const net = takeHome(job.annualIncome, d.age).net
  const hh = householdAt(d, d.age)

  const save = async () => {
    await setProfile(d)
    toast('プロフィールを保存して推定し直しました')
  }

  return (
    <>
      <section className="section" aria-labelledby="p-title">
        <div className="section-head">
          <h2 id="p-title">プロフィール</h2>
          <div className="row">
            <button type="button" className="btn ghost small" onClick={() => setD(sampleProfile())}>
              サンプルの値に戻す
            </button>
            <button type="button" className="btn" onClick={() => void save()} disabled={!dirty}>
              保存して再計算
            </button>
          </div>
        </div>
        <p className="lead">
          結果は「この条件のまま、時間とお金の配分をどう変えると幸せか」を計算します。正確でなくても大丈夫です。入力した値はこの端末のブラウザにだけ保存されます。
        </p>
      </section>

      <section className="sheet section" aria-labelledby="p-basic">
        <h3 id="p-basic">基本</h3>
        <div className="form-grid">
          <NumberField id="p-age" label="年齢" value={d.age} min={18} max={85} unit="歳" onChange={(v) => set({ age: Math.round(Math.min(85, Math.max(18, v))) })} />
          <Seg
            label="性別（生存率と賃金カーブに使用）"
            value={d.sex}
            options={[
              { value: 'female', label: '女性' },
              { value: 'male', label: '男性' },
              { value: 'other', label: '答えない' },
            ]}
            onChange={(v) => set({ sex: v })}
          />
          <RangeField
            id="p-ls"
            label="今の人生満足度"
            value={d.lifeSatisfaction}
            min={0}
            max={10}
            step={0.5}
            onChange={(v) => set({ lifeSatisfaction: v })}
            format={(v) => `${v}点`}
            hint="全体として、今の生活にどのくらい満足していますか（日本の平均は約5.8点）"
          />
        </div>
      </section>

      <section className="sheet section" aria-labelledby="p-family">
        <h3 id="p-family">家族</h3>
        <div className="form-grid">
          <Seg
            label="パートナー（配偶者・同居の恋人）"
            value={d.hasPartner ? 'yes' : d.partnerPlanAge !== null ? 'plan' : 'no'}
            options={[
              { value: 'no', label: 'いない' },
              { value: 'yes', label: 'いる' },
              { value: 'plan', label: 'これから' },
            ]}
            onChange={(v) => set({ hasPartner: v === 'yes', partnerPlanAge: v === 'plan' ? Math.max(d.age + 1, d.partnerPlanAge ?? d.age + 2) : null })}
          />
          {d.partnerPlanAge !== null && !d.hasPartner && (
            <NumberField id="p-pplan" label="一緒に暮らし始める年齢（予定）" value={d.partnerPlanAge} unit="歳" onChange={(v) => set({ partnerPlanAge: Math.max(d.age + 1, Math.round(v)) })} />
          )}
          {(d.hasPartner || d.partnerPlanAge !== null) && (
            <>
              <NumberField
                id="p-pinc"
                label="パートナーの額面年収"
                value={Math.round(d.partnerIncome / 10_000)}
                unit="万円"
                step={10}
                onChange={(v) => set({ partnerIncome: Math.max(0, v) * 10_000 })}
                hint="専業の場合は0"
              />
              <RangeField
                id="p-share"
                label="育児・家事のうち自分が担う割合"
                value={Math.round(d.careShare * 100)}
                min={0}
                max={100}
                step={5}
                onChange={(v) => set({ careShare: v / 100 })}
                format={(v) => `${v}%`}
                hint="日本の6歳未満の子がいる夫婦では、夫が約2割・妻が約8割（2021年）"
              />
            </>
          )}
          <Seg
            label="保育所・学童の利用（子どもがいる場合）"
            value={d.daycare}
            options={[
              { value: true, label: '使う' },
              { value: false, label: '使わない' },
            ]}
            onChange={(v) => set({ daycare: v })}
          />
        </div>
        <ChildrenEditor p={d} onChange={(children) => set({ children })} />
        <div className="form-grid">
          <Seg
            label="親の介護の見込み"
            value={d.caregiving ? 'yes' : 'no'}
            options={[
              { value: 'no', label: '考えない' },
              { value: 'yes', label: '考える' },
            ]}
            onChange={(v) => set({ caregiving: v === 'yes' ? { startAge: Math.max(d.age, 55), years: 5, hoursPerWeek: 10 } : null })}
          />
          {d.caregiving && (
            <>
              <NumberField id="p-cg-start" label="介護が始まる年齢" value={d.caregiving.startAge} unit="歳" onChange={(v) => set({ caregiving: { ...d.caregiving!, startAge: Math.round(v) } })} />
              <NumberField id="p-cg-years" label="期間" value={d.caregiving.years} unit="年" hint="平均は約5年" onChange={(v) => set({ caregiving: { ...d.caregiving!, years: Math.max(0, Math.round(v)) } })} />
              <NumberField
                id="p-cg-hours"
                label="自分が担う時間"
                value={d.caregiving.hoursPerWeek}
                unit="時間/週"
                hint="軽い介護で週7時間、重い同居介護で週45時間ほど"
                onChange={(v) => set({ caregiving: { ...d.caregiving!, hoursPerWeek: Math.max(0, v) } })}
              />
            </>
          )}
        </div>
      </section>

      <section className="sheet section" aria-labelledby="p-job">
        <h3 id="p-job">仕事</h3>
        <JobFields job={job} onChange={(patch) => setJob(job.id, patch)} idPrefix="cur" />
        <p className="note">
          手取り（本人）は年{manYen(net, 0)}・月{manYen(net / 12)}の概算（2026年度の社会保険料率、令和7年度改正後の所得税・住民税。扶養控除などは含まない）。通勤は週{trimNum(commuteAtHours(job, job.weeklyHours))}時間。
        </p>
        <details>
          <summary>転職先などの候補を比べる（{d.jobs.length - 1}件）</summary>
          <div className="section">
            {d.jobs
              .filter((j) => j.id !== d.currentJobId)
              .map((j) => (
                <div key={j.id} className="sheet tight section" style={{ background: 'var(--surface-2)' }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="field" style={{ flex: '1 1 200px' }}>
                      <label htmlFor={`job-name-${j.id}`}>名前</label>
                      <input id={`job-name-${j.id}`} type="text" value={j.name} onChange={(e) => setJob(j.id, { name: e.target.value })} />
                    </div>
                    <button type="button" className="btn ghost small" onClick={() => set({ jobs: d.jobs.filter((x) => x.id !== j.id) })}>
                      削除
                    </button>
                  </div>
                  <JobFields job={j} onChange={(patch) => setJob(j.id, patch)} idPrefix={j.id} />
                </div>
              ))}
            <div>
              <button
                type="button"
                className="btn ghost small"
                onClick={() =>
                  set({
                    jobs: [...d.jobs, { ...job, id: `job-${Date.now().toString(36)}`, name: `候補${d.jobs.length}`, annualIncome: Math.round((job.annualIncome * 1.2) / 100_000) * 100_000 }],
                  })
                }
              >
                候補を追加
              </button>
            </div>
          </div>
        </details>
      </section>

      <section className="sheet section" aria-labelledby="p-money">
        <h3 id="p-money">お金</h3>
        <div className="form-grid">
          <NumberField id="p-sav" label="金融資産（預金・投資）" value={Math.round(d.savings / 10_000)} unit="万円" step={10} onChange={(v) => set({ savings: Math.max(0, v) * 10_000 })} />
          <NumberField id="p-msav" label="毎月の貯蓄・積立" value={d.monthlySaving / 10_000} unit="万円/月" step={0.5} onChange={(v) => set({ monthlySaving: Math.max(0, v) * 10_000 })} />
          <NumberField
            id="p-nec"
            label="必需的な支出（世帯）"
            value={d.necessities / 10_000}
            unit="万円/月"
            step={0.5}
            onChange={(v) => set({ necessities: Math.max(0, v) * 10_000 })}
            hint="家賃・食費・光熱費・通信・保険・日用品など。一人暮らしで約15万円が目安"
          />
          <NumberField id="p-retire" label="引退したい年齢" value={d.retireAge} unit="歳" onChange={(v) => set({ retireAge: Math.round(Math.max(d.age + 1, v)) })} />
          <NumberField id="p-pension" label="年金を受け取り始める年齢" value={d.pensionAge} unit="歳" min={60} max={75} onChange={(v) => set({ pensionAge: Math.round(Math.min(75, Math.max(60, v))) })} hint="65歳が標準。遅らせると1か月0.7%増える" />
        </div>
        <p className="note">
          世帯の手取りは月{manYen(life.netMonthly)}、そこから貯蓄と教育費を除いた消費は月{manYen(life.consumption)}、自由に使えるお金は月{manYen(life.discretionary)}です。
          {life.discretionary <= 0 && <strong className="down"> 必需的支出と貯蓄が手取りを上回っています。</strong>}
        </p>
        <div className="form-grid">
          {SPEND_KEYS.map((k) => (
            <RangeField
              key={k}
              id={`p-spend-${k}`}
              label={`${SPENDS[k].label}の割合`}
              value={d.spendShare[k]}
              min={0}
              max={100}
              step={5}
              onChange={(v) => set({ spendShare: { ...d.spendShare, [k]: v } })}
              format={(v) => {
                const tot = SPEND_KEYS.reduce((s, x) => s + d.spendShare[x], 0) || 1
                return `${Math.round((v / tot) * 100)}%（月${manYen((life.discretionary * v) / tot)}）`
              }}
              hint={SPENDS[k].example}
            />
          ))}
        </div>
      </section>

      <section className="sheet section" aria-labelledby="p-time">
        <h3 id="p-time">今の1週間の時間の使い方</h3>
        <p className="note">ふだんの1週間をざっくり。合計が168時間（24時間×7日）に近くなるよう調整してください。</p>
        <WeekBars
          rows={[
            {
              who: '今',
              segments: [
                { key: 'work', label: '仕事', hours: job.weeklyHours, color: 'var(--s-work)' },
                { key: 'commute', label: '通勤', hours: life.commuteHours, color: 'var(--s-commute)' },
                { key: 'chores', label: '家事・身の回り・育児', hours: d.housework + d.personalCare + hh.childcareMine + d.otherDuties, color: 'var(--s-chores)' },
                ...ACTIVITY_KEYS.map((k) => ({ key: k, label: ACTIVITIES[k].short, hours: d.currentHours[k], color: ACT_COLOR[k], darkText: ACT_DARK_TEXT[k] })),
              ],
            },
          ]}
        />
        <p className={life.unaccounted < -0.5 ? 'callout' : 'note'}>
          合計 {trimNum(168 - life.unaccounted)} 時間
          {Math.abs(life.unaccounted) < 0.5
            ? '（ぴったりです）'
            : life.unaccounted > 0
              ? `（あと${trimNum(life.unaccounted)}時間は「その他」として固定で扱います）`
              : `（${trimNum(-life.unaccounted)}時間多すぎます。どれかを減らしてください）`}
          。育児の時間は子どもの年齢と分担から自動で計算しています（今は週{trimNum(hh.childcareMine)}時間）。
        </p>
        <div className="table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th>活動</th>
                <th>今の時間（週）</th>
                <th>好き度</th>
              </tr>
            </thead>
            <tbody>
              {ACTIVITY_KEYS.map((k) => (
                <tr key={k}>
                  <td>
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <span className="swatch" style={{ background: ACT_COLOR[k] }} />
                      <label htmlFor={`p-h-${k}`}>{ACTIVITIES[k].label}</label>
                    </span>
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <div className="field">
                      <div className="with-unit">
                        <input
                          id={`p-h-${k}`}
                          type="number"
                          step={0.5}
                          min={0}
                          value={d.currentHours[k]}
                          onChange={(e) => set({ currentHours: { ...d.currentHours, [k]: Math.max(0, parseFloat(e.target.value) || 0) } })}
                        />
                        <span>時間</span>
                      </div>
                      {k === 'sleep' && <span className="hint">{sleepPerNight(d.currentHours.sleep)}</span>}
                    </div>
                  </td>
                  <td>
                    <LikingSeg k={k} value={d.liking[k]} onChange={(v) => set({ liking: { ...d.liking, [k]: v } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-grid">
          <NumberField id="p-hw" label="家事（買い物を含む）" value={d.housework} unit="時間/週" step={0.5} onChange={(v) => set({ housework: Math.max(0, v) })} />
          <NumberField id="p-pc" label="食事・入浴・身支度" value={d.personalCare} unit="時間/週" step={0.5} onChange={(v) => set({ personalCare: Math.max(0, v) })} hint="平均は週19〜21時間" />
          <NumberField id="p-od" label="その他の決まった用事" value={d.otherDuties} unit="時間/週" step={0.5} onChange={(v) => set({ otherDuties: Math.max(0, v) })} hint="通院・地域活動など" />
        </div>
        <p className="note">好き度は推定の出発点を少しずらすだけで、質問への回答のほうが優先されます。</p>
      </section>

      <div className="row">
        <button type="button" className="btn" onClick={() => void save()} disabled={!dirty}>
          保存して再計算
        </button>
        {!dirty && (
          <button type="button" className="btn ghost" onClick={() => go('question')}>
            質問に答える
          </button>
        )}
      </div>
    </>
  )
}

function LikingSeg({ k, value, onChange }: { k: ActivityKey; value: number; onChange: (v: number) => void }) {
  return (
    <div className="seg" role="group" aria-label={`${ACTIVITIES[k].label}の好き度`}>
      {LIKING.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} title={o.label}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function JobFields({ job, onChange, idPrefix }: { job: JobOption; onChange: (p: Partial<JobOption>) => void; idPrefix: string }) {
  return (
    <div className="form-grid">
      <NumberField id={`${idPrefix}-inc`} label="額面年収（賞与込み）" value={Math.round(job.annualIncome / 10_000)} unit="万円" step={10} onChange={(v) => onChange({ annualIncome: Math.max(0, v) * 10_000 })} />
      <NumberField id={`${idPrefix}-hours`} label="実際の労働時間（残業込み）" value={job.weeklyHours} unit="時間/週" step={1} onChange={(v) => onChange({ weeklyHours: Math.max(0, Math.min(100, v)) })} hint="フルタイムの平均は週40時間前後" />
      <NumberField id={`${idPrefix}-days`} label="出勤日数" value={job.workDays} unit="日/週" min={0} max={7} onChange={(v) => onChange({ workDays: Math.round(Math.max(0, Math.min(7, v))) })} />
      <NumberField id={`${idPrefix}-remote`} label="うち在宅勤務" value={job.remoteDaysPerWeek} unit="日/週" min={0} max={7} onChange={(v) => onChange({ remoteDaysPerWeek: Math.round(Math.max(0, Math.min(job.workDays, v))) })} />
      <NumberField id={`${idPrefix}-commute`} label="通勤（片道）" value={job.commuteMinutesOneWay} unit="分" step={5} onChange={(v) => onChange({ commuteMinutesOneWay: Math.max(0, v) })} hint="全国平均は往復約80分" />
      <Seg
        label="仕事そのものの好き度"
        value={job.enjoyment}
        options={LIKING}
        onChange={(v) => onChange({ enjoyment: v })}
      />
      <Seg
        label="労働時間を自分で調整できるか"
        value={job.hoursFlexible}
        options={[
          { value: true, label: 'できる' },
          { value: false, label: 'できない' },
        ]}
        onChange={(v) => onChange({ hoursFlexible: v })}
      />
      <Seg
        label="残業代"
        value={job.overtimePaid}
        options={[
          { value: true, label: '出る' },
          { value: false, label: '出ない（固定）' },
        ]}
        onChange={(v) => onChange({ overtimePaid: v })}
      />
    </div>
  )
}

function ChildrenEditor({ p, onChange }: { p: Profile; onChange: (c: ChildPlan[]) => void }) {
  const update = (i: number, patch: Partial<ChildPlan>) => onChange(p.children.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  return (
    <div className="section" style={{ gap: 8 }}>
      <span className="field">
        <span className="label">子ども（今いる子・これから予定する子）</span>
      </span>
      {p.children.map((c, i) => {
        const existing = c.parentAgeAtBirth <= p.age
        return (
          <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
            <Seg
              label={`${i + 1}人目`}
              value={existing ? 'now' : 'plan'}
              options={[
                { value: 'now', label: '今いる' },
                { value: 'plan', label: '予定' },
              ]}
              onChange={(v) => update(i, { parentAgeAtBirth: v === 'now' ? p.age - 3 : p.age + 2 })}
            />
            {existing ? (
              <NumberField id={`ch-age-${i}`} label="子どもの年齢" value={p.age - c.parentAgeAtBirth} unit="歳" onChange={(v) => update(i, { parentAgeAtBirth: p.age - Math.max(0, Math.round(v)) })} />
            ) : (
              <NumberField id={`ch-plan-${i}`} label="生まれるときの自分の年齢" value={c.parentAgeAtBirth} unit="歳" onChange={(v) => update(i, { parentAgeAtBirth: Math.max(p.age + 1, Math.round(v)) })} />
            )}
            <Seg
              label="進学の方針"
              value={c.schooling}
              options={[
                { value: 'public', label: '国公立' },
                { value: 'mixed', label: '高校まで公立・私大' },
                { value: 'private', label: '小学校から私立' },
              ]}
              onChange={(v) => update(i, { schooling: v })}
            />
            <button type="button" className="btn ghost small" onClick={() => onChange(p.children.filter((_, j) => j !== i))}>
              削除
            </button>
          </div>
        )
      })}
      <div>
        <button type="button" className="btn ghost small" onClick={() => onChange([...p.children, { parentAgeAtBirth: p.age + 2, schooling: 'mixed' }])}>
          子どもを追加
        </button>
      </div>
    </div>
  )
}
