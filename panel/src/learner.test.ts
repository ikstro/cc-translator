import { describe, expect, test } from 'vitest'

import { learningState, learnsHere, parseLearner } from './learner'
import { dayOf, parseLedger, summarize, type Ledger } from './usage'

describe('the learning window', () => {
  const learner = parseLearner(JSON.stringify({ folders: ['E:\\Work\\Shop'], ts: 1 }))

  test('the window with the learner project learns, case and slashes aside', () => {
    expect(learnsHere(learner, ['e:/work/shop/'])).toBe(true)
    expect(learnsHere(learner, ['E:\\Work\\Other'])).toBe(false)
    expect(learnsHere(learner, [])).toBe(false)
  })

  test('/tutor on from a subfolder belongs to the window that contains it', () => {
    const sub = parseLearner(JSON.stringify({ folders: ['E:/Work/Shop/panel'] }))
    expect(learnsHere(sub, ['E:/Work/Shop'])).toBe(true)
    expect(learnsHere(learner, ['E:/Work/Shop/panel'])).toBe(false)
  })

  test('other windows know where learning is; off means nowhere', () => {
    expect(learningState(true, learner, ['E:/Work/Shop'])).toEqual({ where: 'here' })
    expect(learningState(true, learner, ['E:/Work/Other'])).toEqual({ where: 'elsewhere', project: 'Shop' })
    expect(learningState(false, learner, ['E:/Work/Shop'])).toEqual({ where: 'nowhere' })
    expect(learningState(true, undefined, ['E:/Work/Shop'])).toEqual({ where: 'nowhere' })
  })

  test('a broken file names no learner', () => {
    expect(parseLearner('{')).toBeUndefined()
    expect(parseLearner(JSON.stringify({ folders: [] }))).toBeUndefined()
  })
})

describe('token totals', () => {
  const now = new Date(2026, 9, 12, 15).getTime()
  const day = (back: number) => dayOf(new Date(2026, 9, 12 - back, 12).getTime())
  const ledgers: Ledger[] = [
    { project: 'E:\\Work\\Shop', days: { [day(0)]: { input: 900, output: 100, calls: 2 }, [day(3)]: { input: 1000, output: 0, calls: 1 } } },
    { project: 'e:/work/shop', days: { [day(20)]: { input: 500, output: 500, calls: 1 }, [day(40)]: { input: 9999, output: 0, calls: 9 } } },
    { project: 'E:/Work/Wind', days: { [day(6)]: { input: 300, output: 200, calls: 3 }, [day(7)]: { input: 50, output: 0, calls: 1 } } },
  ]

  test('today, 7 days and 30 days, older days left out', () => {
    const s = summarize(ledgers, now)
    expect(s.today).toEqual({ tokens: 1000, calls: 2 })
    expect(s.week).toEqual({ tokens: 2500, calls: 6 })
    expect(s.month).toEqual({ tokens: 3550, calls: 8 })
  })

  test('per project over 30 days, one row per folder, most tokens first', () => {
    const s = summarize(ledgers, now)
    expect(s.projects.map(p => [p.name, p.tokens, p.calls])).toEqual([
      ['Shop', 3000, 4],
      ['Wind', 550, 4],
    ])
  })

  test('a malformed ledger is skipped', () => {
    expect(parseLedger('nope')).toBeUndefined()
    expect(parseLedger(JSON.stringify({ days: {} }))).toBeUndefined()
  })
})
