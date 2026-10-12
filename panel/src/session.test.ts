import { describe, expect, test } from 'vitest'

import type { FeedEntry } from './render'
import { groupExchanges, indexResults, stateOf, titleOf } from './session'

const e = (over: Partial<FeedEntry>): FeedEntry => ({ ts: '2026-10-09T10:00:00Z', sessionId: 's', cwd: 'c', role: 'user', ...over })

describe('exchanges', () => {
  test('a prompt and the replies until the next prompt make one exchange', () => {
    const entries = [
      e({ id: 'r0', role: 'assistant', text: 'Before any prompt.' }),
      e({ id: 'u1', role: 'user', text: 'Как очистить панель?' }),
      e({ id: 'a1', role: 'assistant', text: 'Checking.' }),
      e({ id: 't1', role: 'tutor', ref: 'u1', kind: 'translation', text: 'How do I clear the panel? ||| Как очистить панель?' }),
      e({ id: 'a2', role: 'assistant', text: 'Done.' }),
      e({ id: 'u2', role: 'user', text: 'Thanks' }),
    ]
    const x = groupExchanges(entries)
    expect(x.map(g => [g.id, g.user?.id, g.replies.map(r => r.id)])).toEqual([
      ['r0', undefined, ['r0']],
      ['u1', 'u1', ['a1', 'a2']],
      ['u2', 'u2', []],
    ])
  })

  test('a plan is an exchange of its own; the replies after it still belong to the prompt', () => {
    const entries = [
      e({ id: 'u1', role: 'user', text: 'Сделай план' }),
      e({ id: 'a1', role: 'assistant', text: 'Reading the code.' }),
      e({ id: 'p1', role: 'assistant', origin: 'plan', text: '# Plan\n\nAdd the hook.' }),
      e({ id: 'a2', role: 'assistant', text: 'Plan approved, starting.' }),
    ]
    const x = groupExchanges(entries)
    expect(x.map(g => [g.id, g.kind, g.replies.map(r => r.id)])).toEqual([
      ['u1', undefined, ['a1', 'a2']],
      ['p1', 'plan', ['p1']],
    ])
  })

  test('results, states and usage are indexed by the entry they belong to', () => {
    const now = Date.parse('2026-10-09T10:01:00Z')
    const entries = [
      e({ id: 'p1', role: 'paired', ref: 'a1', text: 'x ||| y' }),
      e({ id: 's2', role: 'status', ref: 'a2', state: 'translating' }),
      e({ id: 's3', role: 'status', ref: 'a3', state: 'failed', note: 'the tutor did not answer' }),
      e({ id: 'g1', role: 'usage', ref: 'a1', input: 700, output: 300 }),
      e({ id: 'g2', role: 'usage', ref: 'a2', input: 100, output: 50 }),
    ]
    const r = indexResults(entries)
    expect(stateOf('a1', r, now)).toEqual({ state: 'done' })
    expect(stateOf('a2', r, now)).toEqual({ state: 'translating' })
    expect(stateOf('a2', r, now + 10 * 60 * 1000)).toEqual({ state: 'untranslated' })
    expect(stateOf('a3', r, now)).toEqual({ state: 'failed', note: 'the tutor did not answer' })
    expect(stateOf('a4', r, now)).toEqual({ state: 'untranslated' })
    expect(r.usage).toEqual({ input: 800, output: 350, calls: 2 })
  })

  test('history titles are the first sentence without markdown', () => {
    expect(titleOf('How do I **clear** the panel? ||| Как очистить панель?\nNext line')).toBe('How do I clear the panel?')
    expect(titleOf('```bash\nls\n```\n- First point')).toBe('First point')
    expect(titleOf('x'.repeat(120))).toHaveLength(90)
  })
})
