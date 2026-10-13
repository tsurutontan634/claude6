// サンプルのプロフィール（初期値・お試し用・テスト用）
// 平均的な30歳・会社員・一人暮らしを想定（総務省「社会生活基本調査」などの平均的な時間配分に近い値）

import type { Profile } from './types'

export function sampleProfile(): Profile {
  return {
    version: 1,
    age: 30,
    sex: 'other',
    lifeSatisfaction: 6,
    hasPartner: false,
    partnerIncome: 0,
    partnerPlanAge: null,
    children: [],
    jobs: [
      {
        id: 'job-current',
        name: '今の仕事',
        annualIncome: 4_500_000,
        weeklyHours: 45,
        workDays: 5,
        commuteMinutesOneWay: 40,
        remoteDaysPerWeek: 0,
        enjoyment: 3,
        hoursFlexible: false,
        overtimePaid: true,
      },
    ],
    currentJobId: 'job-current',
    savings: 3_000_000,
    monthlySaving: 40_000,
    necessities: 140_000,
    currentHours: {
      sleep: 52,
      friends: 4,
      family: 3,
      hobby: 8,
      rest: 20,
      exercise: 1.5,
      learning: 1.5,
    },
    housework: 7,
    personalCare: 19,
    otherDuties: 0,
    daycare: true,
    caregiving: null,
    spendShare: { experience: 45, goods: 40, social: 10, timeBuy: 5 },
    careShare: 0.5,
    liking: { sleep: 3, friends: 3, family: 3, hobby: 3, rest: 3, exercise: 3, learning: 3 },
    retireAge: 65,
    pensionAge: 65,
  }
}
