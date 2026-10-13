import { useApp } from '../App'
import { DRAWS_FOR_PLAN, WeekPlanner } from '../../engine/session'
import { personalityType } from '../../engine/insights'
import { useDeferred } from '../charts'
import { Loading, Meter, Stamp, deltaText, lsText } from '../common'

export function HomePage() {
  const { session, saved, rev, go } = useApp()
  const n = saved.answers.length
  const res = useDeferred(() => {
    const wp = new WeekPlanner(saved.profile, session.draws(DRAWS_FOR_PLAN))
    const gain = wp.optimalNow().outcome.utility - wp.currentUtility()
    return { gain, type: personalityType(session.posterior), confidence: session.confidence() }
  }, [rev, saved.profile])

  return (
    <>
      <section className="section" aria-labelledby="h-title">
        <h2 id="h-title" style={{ fontSize: 'var(--fs-xl)' }}>
          ずっと働くのも、ずっと遊ぶのも違う。あなたにとっての「ちょうどいい配分」を計算します。
        </h2>
        <p className="lead">
          経済学では、幸せへの貢献度を「効用」と呼びます。友人と過ごす時間も、趣味も、お金も、増やすほど1単位あたりの嬉しさは減っていきます（限界効用の逓減）。このアプリは、研究データから作った「平均的な人の効用関数」から出発し、あなたが「AとBどちらが幸せ？」に答えるたびに、あなた専用の効用関数へと更新していきます。
        </p>
      </section>

      <section className="grid-3" aria-label="使い方">
        <div className="sheet section" style={{ gap: 8 }}>
          <span className="chip">手順 1</span>
          <h3>今の生活を書き込む</h3>
          <p className="note">年齢、仕事、収入、家族、1週間の時間の使い方。いまはサンプル（30歳・会社員）が入っています。</p>
          <button type="button" className="btn ghost small" onClick={() => go('profile')}>
            プロフィールを編集
          </button>
        </div>
        <div className="sheet section" style={{ gap: 8 }}>
          <span className="chip">手順 2</span>
          <h3>1対1の質問に答える</h3>
          <p className="note">何問でも。答えるほど推定が絞り込まれ、次の質問も「あなたについて一番わかること」を自動で選びます。</p>
          <button type="button" className="btn small" onClick={() => go('question')}>
            質問に答える
          </button>
        </div>
        <div className="sheet section" style={{ gap: 8 }}>
          <span className="chip">手順 3</span>
          <h3>配分の提案を見る</h3>
          <p className="note">最適な1週間、労働時間、お金の使い道、年ごとの人生計画。前提条件を変えて比べられます。</p>
          <div className="row">
            <button type="button" className="btn ghost small" onClick={() => go('week')}>
              最適な1週間
            </button>
            <button type="button" className="btn ghost small" onClick={() => go('life')}>
              人生計画
            </button>
          </div>
        </div>
      </section>

      <section className="sheet section" aria-labelledby="now-title">
        <h3 id="now-title">いまの推定</h3>
        {!res ? (
          <Loading />
        ) : (
          <div className="kpis">
            <Stamp small="配分を見直すと" big={deltaText(res.gain)} />
            <div className="kpi">
              <span className="label">今の満足度 → 見直した場合</span>
              <span className="value">
                {lsText(saved.profile.lifeSatisfaction)} → {lsText(saved.profile.lifeSatisfaction + res.gain)}
              </span>
              <span className="sub">時間とお金の使い方だけを入れ替えた場合</span>
            </div>
            <div className="kpi" style={{ minWidth: 180 }}>
              <span className="label">推定の確かさ（{n}問）</span>
              <Meter value={res.confidence} label="推定の確かさ" />
              <span className="sub">{n < 20 ? 'まだ「平均的な人」に近い推定です' : n < 80 ? 'あなたの傾向が見えてきました' : 'かなり絞り込まれています'}</span>
            </div>
            <div className="kpi">
              <span className="label">あなたのタイプ</span>
              <span className="value" style={{ fontSize: 'var(--fs-lg)' }}>
                {res.type ? res.type.name : '判定中'}
              </span>
              <span className="sub">{res.type ? '' : `あと${Math.max(0, 12 - n)}問で判定`}</span>
            </div>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="idea-title">
        <h3 id="idea-title">しくみ（くわしくは「根拠と注意」）</h3>
        <div className="grid-2">
          <div className="sheet tight section" style={{ gap: 6 }}>
            <strong>研究データ × あなたの回答</strong>
            <p className="note">
              年収と満足度の関係（内閣府の調査、Killingsworth 2021 など）、睡眠や運動の最適量、通勤のつらさ、子育て期の時間などの研究から「事前の推定」を作り、あなたの回答でベイズ更新します。回答が少ないうちは平均的な人に近く、回答が増えるほどあなたらしくなります。
            </p>
          </div>
          <div className="sheet tight section" style={{ gap: 6 }}>
            <strong>限界効用をそろえる</strong>
            <p className="note">
              最適な配分では、どの活動に回しても「あと1時間の価値」が同じになります。働く時間・お金の使い道・毎年の貯蓄も同じ考え方で、時間の制約（週168時間）とお金の制約（手取り・年金・教育費）の中で最大化します。
            </p>
          </div>
        </div>
        <p className="note">参考・エンターテインメントとしてお使いください。推定には不確かさがあり、表示している数字は「平均的な傾向とあなたの回答から見た目安」です。</p>
      </section>
    </>
  )
}
