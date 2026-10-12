import { describe, expect, test } from 'claude-code/testing'

import { assemblePaired, batches, parseNumbered, parseTranslateReply, sentencesOf, splitUnits } from './sentences'

describe('sentences', () => {
  test('splits paragraph lines into sentences, keeps list items whole', async () => {
    const units = splitUnits('Open the menu. Pick the disk.\n\n1. Run it as admin. Then wait.\n```\nx. y.\n```\n')
    expect(sentencesOf(units)).toEqual(['Open the menu.', 'Pick the disk.', 'Run it as admin. Then wait.'])
    expect(units[0]).toEqual({ kind: 'unit', prefix: '', body: 'Open the menu.' })
    expect(units[3]).toEqual({ kind: 'unit', prefix: '1. ', body: 'Run it as admin. Then wait.' })
    expect(units[4]).toEqual({ kind: 'raw', text: '```' })
  })

  test('does not split after e.g. or inside code-only lines', async () => {
    const units = splitUnits('Use a tool, e.g. Victoria. It works.')
    expect(sentencesOf(units)).toEqual(['Use a tool, e.g. Victoria.', 'It works.'])
  })

  test('reads numbered translations back and assembles paired lines', async () => {
    const units = splitUnits('Open the menu. Pick the disk.\n- Done.')
    const translations = parseNumbered('1. Открой меню.\n2. Выбери диск.\n3. Готово.', 3)
    expect(translations).toEqual(['Открой меню.', 'Выбери диск.', 'Готово.'])
    expect(assemblePaired(units, translations)).toBe('Open the menu. ||| Открой меню.\nPick the disk. ||| Выбери диск.\n- Done. ||| Готово.')
  })

  test('a reply in the native language is flipped: the learned language goes on the left', async () => {
    const units = splitUnits('Открой меню. Выбери диск.\n- Готово.')
    const { lang, translations } = parseTranslateReply('LANG: native\n1. Open the menu.\n2. Pick the disk.\n3. Done.', 3)
    expect(lang).toBe('native')
    expect(assemblePaired(units, translations, lang === 'native')).toBe(
      'Open the menu. ||| Открой меню.\nPick the disk. ||| Выбери диск.\n- Done. ||| Готово.',
    )
  })

  test('a reply without a LANG line is read as written in the learned language', async () => {
    expect(parseTranslateReply('1. Открой меню.', 1)).toEqual({ lang: 'target', translations: ['Открой меню.'] })
    expect(parseTranslateReply('LANG: target\n1. Открой меню.', 1).lang).toBe('target')
  })

  test('a missing translation leaves the sentence untranslated', async () => {
    const units = splitUnits('One. Two.')
    expect(assemblePaired(units, parseNumbered('2. Два.', 2))).toBe('One.\nTwo. ||| Два.')
  })

  test('table rows pass through untouched', async () => {
    const units = splitUnits('| Part | Folder |\n| --- | --- |\n| Plugin. Reads. | `plugin/` |\nThe table above. It has rows.')
    expect(sentencesOf(units)).toEqual(['The table above.', 'It has rows.'])
    expect(units[2]).toEqual({ kind: 'raw', text: '| Plugin. Reads. | `plugin/` |' })
  })

  test('sentences are batched in order, a long one on its own', async () => {
    const s = ['aaaa', 'bbbb', 'cc', 'ddddddddddddd', 'e']
    expect(batches(s, 8)).toEqual([['aaaa', 'bbbb'], ['cc'], ['ddddddddddddd'], ['e']])
    expect(batches(s, 100)).toEqual([s])
    expect(batches([], 100)).toEqual([])
  })
})
