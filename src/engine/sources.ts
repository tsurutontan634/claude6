// 出典一覧（事前分布・データ表の根拠）
// 注意：一部の値は調査時に原典のPDFを直接確認できず、検索結果の要約や記憶に基づく（docs/MODEL.md に明記）

export interface Source {
  id: string
  /** 何の根拠か（日本語の短い説明） */
  topic: string
  citation: string
  url?: string
}

export const SOURCES: Source[] = [
  // お金と幸福
  {
    id: 'income-slope',
    topic: '収入と人生満足度の関係（国内の傾き：対数収入1単位あたり0.3〜0.5点）',
    citation:
      'Stevenson, B. & Wolfers, J. (2013). Subjective Well-Being and Income: Is There Any Evidence of Satiation? American Economic Review P&P 103(3); Sacks, Stevenson & Wolfers (2012) NBER WP 16441',
  },
  {
    id: 'kahneman-deaton',
    topic: '人生の評価は収入とともに上がり続け、日々の感情は年収7.5万ドル付近で頭打ち',
    citation: 'Kahneman, D. & Deaton, A. (2010). High income improves evaluation of life but not emotional well-being. PNAS 107(38)',
  },
  {
    id: 'killingsworth',
    topic: '経験された幸福も7.5万ドルを超えて対数収入とともに上昇',
    citation: 'Killingsworth, M. A. (2021). Experienced well-being rises with income, even above $75,000 per year. PNAS 118(4)',
  },
  {
    id: 'kkm-2023',
    topic: '頭打ちは最も不幸な約2割の人にだけ見られる（敵対的共同研究）',
    citation: 'Killingsworth, M. A., Kahneman, D. & Mellers, B. (2023). Income and emotional well-being: A conflict resolved. PNAS 120(10)',
  },
  {
    id: 'cao-satisfaction',
    topic: '日本：世帯年収別の総合主観満足度（2,000〜3,000万円で頂点）',
    citation: '内閣府「満足度・生活の質に関する調査」第1次報告書（2019）図表5、同 報告書2025',
  },
  {
    id: 'layard-eta',
    topic: '限界効用の逓減の強さ η ≈ 1.26（幸福度データから推定）',
    citation: 'Layard, R., Mayraz, G. & Nickell, S. (2008). The marginal utility of income. Journal of Public Economics 92(8-9)',
  },
  {
    id: 'gandelman-eta',
    topic: '幸福度データから推定した η は多くの国で 1（対数効用）に近い',
    citation: 'Gandelman, N. & Hernández-Murillo, R. (2015). Risk Aversion at the Country Level. Federal Reserve Bank of St. Louis Review 97(1)',
  },
  {
    id: 'ruberton',
    topic: '手元の貯金（流動資産）は収入とは別に人生満足度を高める',
    citation: 'Ruberton, P. M., Gladstone, J. & Lyubomirsky, S. (2016). How your bank balance buys happiness. Emotion 16(5)',
  },
  {
    id: 'vanguard-emergency',
    topic: '緊急資金は1か月分で効果の大半、3〜6か月分で上積みが小さくなる',
    citation: 'Vanguard Research (2025). The relationship between emergency savings, financial well-being, and financial stress',
  },
  {
    id: 'experiential',
    topic: '体験への支出はモノより満足が大きい（メタ分析 d≈0.3〜0.45）',
    citation:
      'Van Boven, L. & Gilovich, T. (2003). To do or to have? JPSP 85(6); Weingarten, E. & Goodman, J. K. (2021). Re-examining the Experiential Advantage in Consumption. Journal of Consumer Research 47(6)',
  },
  {
    id: 'prosocial',
    topic: '人のためにお金を使うと幸福度が上がる（効果は再現研究でやや小さい）',
    citation:
      'Dunn, E. W., Aknin, L. B. & Norton, M. I. (2008). Spending money on others promotes happiness. Science 319; Aknin et al. (2020). JPSP 119',
  },
  {
    id: 'buying-time',
    topic: 'お金で時間を買うと満足度が上がる（ただし集団によって不安定）',
    citation:
      'Whillans, A. V. et al. (2017). Buying time promotes happiness. PNAS 114(32); Lok, I. & Dunn, E. W. (2022). PLoS ONE 17(6)',
  },
  // 時間の使い方
  {
    id: 'time-use-jp',
    topic: '日本人の生活時間（睡眠・仕事・通勤・家事・育児・余暇）',
    citation: '総務省統計局「令和3年社会生活基本調査」',
  },
  {
    id: 'drm',
    topic: '活動ごとの楽しさ（一日再構成法 DRM）：交際・休息が高く、仕事・通勤が低い',
    citation:
      'Kahneman, D., Krueger, A. B., Schkade, D. A., Schwarz, N. & Stone, A. A. (2004). A Survey Method for Characterizing Daily Life Experience. Science 306',
  },
  {
    id: 'sharif-time',
    topic: '自由時間は1日2時間ほどで効果が頭打ち、5時間を超えると（一人で非生産的な場合）低下',
    citation:
      'Sharif, M. A., Mogilner, C. & Hershfield, H. E. (2021). Having too little or too much time is linked to lower subjective well-being. JPSP 121(4)',
  },
  {
    id: 'sleep-guideline',
    topic: '睡眠は成人で7〜9時間が推奨、6時間未満は明らかに有害',
    citation: '厚生労働省「健康づくりのための睡眠ガイド2023」; Hirshkowitz, M. et al. (2015). Sleep Health 1(1)（米国睡眠財団）',
  },
  {
    id: 'chekroud-exercise',
    topic: '運動は1回45分・週3〜5回が最もメンタルヘルスに良く、やりすぎは逆効果',
    citation:
      'Chekroud, S. R. et al. (2018). Association between physical exercise and mental health in 1.2 million individuals. Lancet Psychiatry 5(9); Pearce, M. et al. (2022). JAMA Psychiatry 79(6)',
  },
  {
    id: 'helliwell-huang',
    topic: '友人の数が倍になることは、収入が5割増えるのに近い幸福効果',
    citation: 'Helliwell, J. F. & Huang, H. (2013). Comparing the Happiness Effects of Real and On-Line Friends. PLoS ONE 8(9)',
  },
  {
    id: 'hall-friendship',
    topic: '親しい友人になるには約200時間を一緒に過ごす必要がある',
    citation: 'Hall, J. A. (2019). How many hours does it take to make a friend? Journal of Social and Personal Relationships 36(4)',
  },
  {
    id: 'harvard-study',
    topic: '良い人間関係が長期的な健康と幸福を最もよく予測する',
    citation: 'Waldinger, R. & Schulz, M. (2023). The Good Life: Lessons from the World’s Longest Scientific Study of Happiness（ハーバード成人発達研究）',
  },
  {
    id: 'social-media',
    topic: 'SNSを1日30分程度に減らすと孤独感・抑うつが減る',
    citation: 'Hunt, M. G. et al. (2018). No More FOMO. Journal of Social and Clinical Psychology 37(10); Allcott, H. et al. (2020). American Economic Review 110(3)',
  },
  // 仕事
  {
    id: 'work-hours',
    topic: '長時間労働とメンタルヘルス（日本では週50時間超で悪化）',
    citation:
      'Kuroda, S. & Yamamoto, I. (2016). Workers’ mental health, long work hours, and workplace management. RIETI DP 16-E-046; Dinh, H. et al. (2017). Social Science & Medicine 189',
  },
  {
    id: 'who-long-hours',
    topic: '週55時間以上の労働で脳卒中・虚血性心疾患のリスクが上昇',
    citation:
      'Kivimäki, M. et al. (2015). Long working hours and risk of coronary heart disease and stroke. Lancet 386; Pega, F. et al. (2021). Environment International 154（WHO/ILO）',
  },
  {
    id: 'kamerade-employment',
    topic: '仕事がもたらす所属感・役割は週8時間程度でほぼ得られる',
    citation: 'Kamerāde, D. et al. (2019). A shorter working week for everyone. Social Science & Medicine 241',
  },
  {
    id: 'unemployment',
    topic: '失業は収入減とは別に満足度を下げる（−0.3〜−0.65点）、自発的な引退はほぼ中立',
    citation:
      'Winkelmann, L. & Winkelmann, R. (1998). Economica 65; Lucas, R. E. et al. (2004). Psychological Science 15(1); Bonsang, E. & Klein, T. J. (2012). Journal of Economic Behavior & Organization 83(3)',
  },
  {
    id: 'stutzer-frey',
    topic: '通勤が長い人は、その分の収入で補われていない（通勤のパラドックス）',
    citation: 'Stutzer, A. & Frey, B. S. (2008). Stress that Doesn’t Pay: The Commuting Paradox. Scandinavian Journal of Economics 110(2)',
  },
  {
    id: 'clark-commute',
    topic: '通勤が1日20分長いことは、仕事の満足度では収入19%減に相当',
    citation: 'Clark, B. et al. (2020). How commuting affects subjective wellbeing. Transportation 47',
  },
  {
    id: 'jp-wage',
    topic: '日本の年齢別賃金（賞与込みの年収）',
    citation: '厚生労働省「令和7年賃金構造基本統計調査」',
  },
  // 家族
  {
    id: 'lucas-marriage',
    topic: '結婚による満足度の上昇は約2年で元に戻る（長期的な上乗せは小さい）',
    citation:
      'Lucas, R. E., Clark, A. E., Georgellis, Y. & Diener, E. (2003). Reexamining adaptation and the set point model of happiness. JPSP 84(3); Grover, S. & Helliwell, J. F. (2019). Journal of Happiness Studies 20',
  },
  {
    id: 'parenthood',
    topic: '子どもと幸福：出産前後に上がり、幼い子の時期はやや下がり、長期的にはほぼ中立',
    citation:
      'Myrskylä, M. & Margolis, R. (2014). Happiness: Before and After the Kids. Demography 51(5); Nelson, S. K., Kushlev, K. & Lyubomirsky, S. (2014). Psychological Bulletin 140(3); Deaton, A. & Stone, A. A. (2014). PNAS 111(4)',
  },
  {
    id: 'education-cost',
    topic: '子どもの教育費（幼稚園〜高校、大学）',
    citation: '文部科学省「令和5年度 子供の学習費調査」; 日本政策金融公庫「令和3年度 教育費負担の実態調査結果」',
  },
  {
    id: 'child-allowance',
    topic: '児童手当（2024年10月以降の制度）',
    citation: 'こども家庭庁「児童手当制度のご案内」',
  },
  {
    id: 'caregiving',
    topic: '介護は満足度を下げ、慣れにくい（平均期間は約5年）',
    citation: 'Pinquart, M. & Sörensen, S. (2003). Psychology and Aging 18(2); 生命保険文化センター「生命保険に関する全国実態調査」（2021）',
  },
  // お金の制度
  {
    id: 'tax',
    topic: '所得税・住民税・社会保険料（手取りの計算）',
    citation: '国税庁 タックスアンサー No.1410・No.1199・No.2260; 全国健康保険協会; 日本年金機構; こども家庭庁',
  },
  {
    id: 'pension',
    topic: '公的年金（老齢基礎年金・報酬比例部分・繰上げ/繰下げ）と将来の給付水準',
    citation: '日本年金機構; 厚生労働省「令和6年財政検証結果」',
  },
  {
    id: 'returns',
    topic: '運用利回り・賃金上昇率の前提',
    citation: 'GPIF 基本ポートフォリオ; 厚生労働省「令和6年財政検証」の経済前提',
  },
  {
    id: 'life-table',
    topic: '生存率（平均寿命 男81.09年・女87.13年）',
    citation: '厚生労働省「令和6年簡易生命表」',
  },
  {
    id: 'household-spending',
    topic: '世帯の消費支出・高齢世帯の家計',
    citation: '総務省統計局「家計調査 2024年平均」; 厚生労働省「国民生活基礎調査」',
  },
  // 方法
  {
    id: 'benjamin-sp',
    topic: '「どちらが幸せか」という仮想的な選択の質問から、幸福の要素の重みを推定する方法',
    citation:
      'Benjamin, D. J., Heffetz, O., Kimball, M. S. & Szembrot, N. (2014). Beyond Happiness and Satisfaction: Toward Well-Being Indices Based on Stated Preference. American Economic Review 104(9)',
  },
  {
    id: 'bayes-design',
    topic: '回答から最も多くを学べる質問を選ぶ（ベイズ最適実験計画・期待情報利得）',
    citation: 'Chaloner, K. & Verdinelli, I. (1995). Bayesian Experimental Design: A Review. Statistical Science 10(3)',
  },
  {
    id: 'smc',
    topic: '粒子による逐次ベイズ推定（リサンプリングとMCMC移動）',
    citation: 'Chopin, N. (2002). A sequential particle filter method for static models. Biometrika 89(3)',
  },
  {
    id: 'focusing-illusion',
    topic: '想像の中では目立つ要素（お金など）を過大評価しがち（フォーカシング・イリュージョン）',
    citation: 'Schkade, D. A. & Kahneman, D. (1998). Does Living in California Make People Happy? Psychological Science 9(5); Gilbert, D. T. & Wilson, T. D. (2000)',
  },
]

export const SOURCE_MAP: Record<string, Source> = Object.fromEntries(SOURCES.map((s) => [s.id, s]))
