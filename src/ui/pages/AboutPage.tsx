import { useMemo } from 'react'
import { useApp } from '../App'
import { paramSummaries } from '../../engine/insights'
import { SOURCES, SOURCE_MAP } from '../../engine/sources'
import { Meter } from '../common'

function fmt(v: number, unit: string): string {
  const a = Math.abs(v)
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toFixed(4)
  return unit ? `${s}` : s
}

export function AboutPage() {
  const { session, rev } = useApp()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const params = useMemo(() => paramSummaries(session.posterior), [rev, session])

  return (
    <>
      <section className="section" aria-labelledby="ab-title">
        <h2 id="ab-title">しくみと根拠</h2>
        <div className="sheet section">
          <h3>1. 効用関数（1週間がずっとこうだったら、満足度が何点変わるか）</h3>
          <div className="formula">
            {`U = Σ 活動 a   w_a·S_a·(1 − e^(−h_a/S_a)) − 疲労_a·h_a      … 時間の使い方（逓減する）
  + β·((C/√n ÷ C₀)^(1−η) − 1)/(1−η)                       … 消費（η=1 なら対数）
  + Σ 使い道 k  A_k·(1 − e^(−x_k/X_k))                     … 体験・モノ・人のための上乗せ
  + 安心_max·(1 − e^(−貯金月数/M))                          … 貯金の安心感
  + 楽しさ·H − c·max(0, H−45)² + 所属感(H)                  … 仕事そのもの
  − 通勤のつらさ·通勤時間 − 家事の負担 − ひとり時間の取りすぎ`}
          </div>
          <p className="note">
            単位は「0〜10点の人生満足度」。w は最初の1時間の価値、S は頭打ちの目安（その時間で追加1時間の価値が最初の約37%まで下がる）。C は世帯の月の消費（家事代行などの「時間を買う」支出は除く）、n は世帯人数、C₀ は日本の等価消費の中央値（月17.5万円）。
          </p>
        </div>
        <div className="grid-2">
          <div className="sheet section">
            <h3>2. 研究データから「事前の推定」を作る</h3>
            <p className="note">
              自由時間1時間の価値 λ を「お金の価値 × 時給」から約0.015点と見積もり、DRM（その時間がどれだけ楽しいか）と用量反応の研究（睡眠7〜9時間、運動 週2〜6時間、自由時間 1日2〜5時間など）から、各活動の最適量が研究の範囲に入るよう w と S を決めています。お金の傾き β と頭打ち η は、国内の収入と満足度の関係（0.3〜0.5点/対数単位）と幸福度データからの η の推定（1.0〜1.26）に基づきます。
            </p>
          </div>
          <div className="sheet section">
            <h3>3. 回答でベイズ更新する</h3>
            <p className="note">
              「どちらが幸せか」の5段階の回答は、効用の差 ΔU とゆらぎ τ の順序ロジットモデルで確率に直します（押し間違いを4%見込む）。2,000個の「あり得るあなた」（粒子）の重みを回答ごとに更新し、偏ったら作り直す逐次モンテカルロ法で、事後分布を近似しています。
            </p>
          </div>
          <div className="sheet section">
            <h3>4. 次の質問の選び方</h3>
            <p className="note">
              10種類の質問のひな形から候補を約90問作り、「粒子の間で答えの予想が一番割れている」＝答えを聞くと一番多くを学べる質問（期待情報利得が最大）を選びます。同じ種類が続かないよう調整し、ときどき答えが明らかな確認問題を入れて回答のゆらぎを測ります。
            </p>
          </div>
          <div className="sheet section">
            <h3>5. 最適化とシミュレーション</h3>
            <p className="note">
              1週間の配分は「あと15分の価値が一番高い活動に足していく」方法で、限界効用がそろう点を求めます（効用が凹なので最適）。人生計画は、年ごとの手取り（税・社会保険・年金・児童手当・教育費）を計算し、毎年の消費と貯蓄を動的計画法で最適化。労働時間と引退年齢は複数案を比べて探索します。
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="pr-title">
        <h2 id="pr-title">パラメータ：研究からの出発点と、あなたの推定</h2>
        <div className="sheet table-wrap">
          <table className="wide">
            <thead>
              <tr>
                <th>パラメータ</th>
                <th className="num">研究からの出発点</th>
                <th className="num">あなたの推定</th>
                <th>回答でわかった度合い</th>
                <th>根拠</th>
              </tr>
            </thead>
            <tbody>
              {params.map((s) => (
                <tr key={s.key}>
                  <td style={{ minWidth: 200 }}>
                    <strong>{s.label}</strong>
                    <div className="note">
                      {s.description}
                      {s.unit && `（${s.unit}）`}
                    </div>
                  </td>
                  <td className="num">
                    {fmt(s.prior[1], s.unit)}
                    <div className="note">
                      {fmt(s.prior[0], s.unit)}〜{fmt(s.prior[2], s.unit)}
                    </div>
                  </td>
                  <td className="num">
                    <strong>{fmt(s.post[1], s.unit)}</strong>
                    <div className="note">
                      {fmt(s.post[0], s.unit)}〜{fmt(s.post[2], s.unit)}
                    </div>
                  </td>
                  <td style={{ minWidth: 110 }}>
                    <Meter value={s.learned} label={`${s.label}の分かった度合い`} />
                    <span className="note">{Math.round(s.learned * 100)}%</span>
                  </td>
                  <td className="note" style={{ minWidth: 160 }}>
                    {s.sources.map((id) => SOURCE_MAP[id]?.topic.split('（')[0] ?? id).join('／')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note" style={{ paddingTop: 8 }}>
            範囲は80%区間。「分かった度合い」は、研究からの出発点に比べて推定の幅がどれだけ狭まったか。プロフィールの好き度は出発点を少しずらしています。
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="cv-title">
        <h2 id="cv-title">注意してほしいこと</h2>
        <div className="sheet">
          <ul style={{ margin: 0, paddingLeft: '1.2em', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              想像の中の選択は、実際の満足度とずれることがあります。人はお金や目立つ条件を過大に評価しがちです（フォーカシング・イリュージョン）。このアプリは研究データを出発点にして、そのずれを和らげています。
            </li>
            <li>研究の多くは「平均的な傾向」や相関で、因果関係とは限りません。欧米のデータを日本向けに読み替えた値も含みます。</li>
            <li>
              調査時に原典のPDFを直接確認できず、検索結果の要約や記憶に基づいている数値があります（家計調査・子育ての時間・ライフイベントの効果など）。docs/MODEL.md に一覧があります。
            </li>
            <li>健康の衰え・病気・離婚・死別・失業・相場の変動などの不確かな出来事は、人生計画に含めていません（長時間労働の死亡リスクは少しだけ含みます）。</li>
            <li>税・社会保険は会社員の概算です（扶養控除・iDeCo・住宅ローン控除などは含まない）。自営業や公務員の制度とは異なります。</li>
            <li>結果は参考・エンターテインメント用です。大きな決断は、専門家への相談や身近な人との話し合いもあわせて。</li>
          </ul>
        </div>
      </section>

      <section className="section" aria-labelledby="src-title">
        <h2 id="src-title">出典</h2>
        <div className="sheet">
          <ol style={{ margin: 0, paddingLeft: '1.4em', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--fs-sm)' }}>
            {SOURCES.map((s) => (
              <li key={s.id}>
                <strong>{s.topic}</strong>
                <div className="note">{s.citation}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  )
}
