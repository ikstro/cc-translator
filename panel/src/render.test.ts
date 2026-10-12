import { describe, expect, test } from 'vitest'

import { messageHtml, parseFeed, tutorHtml, userHtml } from './render'

describe('messageHtml', () => {
  test('wraps a translated sentence, adds its translation line, keeps list markers outside', () => {
    const html = messageHtml('1. Open the **menu**. ||| Открой меню.\n')
    expect(html).toContain('<ol>')
    expect(html).toContain('<span class="s" tabindex="0">Open the <strong>menu</strong>.</span>')
    expect(html).toContain('<span class="tr"><span class="tr-text">Открой меню.</span><button class="icon-btn play" data-play="sentence"')
  })

  test('an untranslated line is still a sentence, with no translation line', () => {
    const html = messageHtml('Plain line\n')
    expect(html).toContain('<span class="s" tabindex="0">Plain line</span>')
    expect(html).not.toContain('class="tr"')
  })

  test('escapes model prose and translations, leaves fenced code to the renderer', () => {
    const html = messageHtml('Use <b>tags</b>. ||| Тег <i>.\n```html\n<b>x</b> ||| y\n```\n')
    expect(html).toContain('Use &lt;b&gt;tags&lt;/b&gt;.')
    expect(html).toContain('Тег &lt;i&gt;.')
    expect(html).toContain('<code class="language-html">&lt;b&gt;x&lt;/b&gt; ||| y')
  })

  test('an old native-first pair is turned round so English is on the left', () => {
    const o = { target: 'Latin', native: 'Cyrillic' } as const
    const html = messageHtml('- Открой меню. ||| Open the menu.\nRun it. ||| Запусти.\n', o)
    expect(html).toContain('<span class="s" tabindex="0">Open the menu.</span><span class="tr"><span class="tr-text">Открой меню.</span>')
    expect(html).toContain('<span class="s" tabindex="0">Run it.</span><span class="tr"><span class="tr-text">Запусти.</span>')
    expect(html).toContain('<li>')
  })

  test('headings keep their level', () => {
    expect(messageHtml('## Steps ||| Шаги\n')).toMatch(/<h2[^>]*><span class="s" tabindex="0">Steps<\/span><span class="tr">/)
  })
})

describe('tutorHtml', () => {
  test('a correction keeps strikethrough and bold', () => {
    expect(tutorHtml('correction', '~~I has~~ **I have** a question.')).toContain('<del>I has</del> <strong>I have</strong>')
  })

  test('how to say it becomes sentences to hear', () => {
    expect(tutorHtml('howToSay', 'Can we start it from the panel?')).toContain('<span class="s" tabindex="0">Can we start it from the panel?</span>')
  })
})

describe('userHtml', () => {
  test('an IDE note in an older entry is not shown', () => {
    const raw = '<ide_opened_file>The user opened the file README.md in the IDE.</ide_opened_file>\nДавай проверим текст.'
    expect(userHtml(raw)).toBe('<p>Давай проверим текст.</p>')
  })
})

describe('parseFeed', () => {
  test('skips a half-written last line', () => {
    const feed = '{"ts":"1","sessionId":"s","cwd":"c","role":"user","text":"hi"}\n{"ts":"2","sess'
    expect(parseFeed(feed)).toHaveLength(1)
  })
})
