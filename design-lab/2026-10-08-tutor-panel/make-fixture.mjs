// Renders a fixture session with the panel's own renderer and writes fixture.js (v0.4: exchanges).
import { build } from '../../panel/node_modules/esbuild/lib/main.js'
import { writeFileSync } from 'node:fs'

const out = await build({
  entryPoints: ['../../panel/src/render.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  absWorkingDir: process.cwd(),
  nodePaths: ['../../panel/node_modules'],
})
const url = 'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
const { messageHtml, tutorHtml, userHtml } = await import(url)
const o = { target: 'Latin', native: 'Cyrillic' }

// Earlier exchange: the person wrote English with mistakes.
const older = {
  id: 'u0',
  ts: '2026-10-09T09:40:00Z',
  title: 'How many tokens does it use when I write in English?',
  blocks: [
    {
      id: 'u0', role: 'user', state: 'done', tutor: 'correction',
      html: tutorHtml('correction', 'How ~~much~~ **many** tokens ~~it use~~ **does it use** when I write in ~~english~~ **English**?\nTokens считаются, поэтому many; в вопросе нужен does; названия языков с заглавной.'),
    },
    {
      id: 'a0', role: 'assistant', state: 'done',
      html: messageHtml('About as many as the reply is long, once in and once out. ||| Примерно столько, сколько длится ответ: один раз на вход и один на выход.\nThe main model does not pay anything extra. ||| Основная модель ничего лишнего не тратит.', o),
    },
  ],
}

// Latest exchange: the person wrote Russian; Claude answered in Russian.
const reply = [
  'You can clear the panel from the History sheet. ||| Очистить панель можно из шторки «История».',
  'It deletes only this session, and Claude keeps the conversation as it is. ||| Удаляется только эта сессия, а разговор в Claude остаётся как есть.',
  '',
  'To check the files, run: ||| Чтобы проверить файлы, выполни:',
  '```powershell',
  'Get-ChildItem $HOME\\.claude\\language-tutor\\sessions',
  '```',
].join('\n')

const latest = {
  id: 'u1',
  ts: '2026-10-09T10:02:00Z',
  title: 'How do I clear the panel?',
  blocks: [
    {
      id: 'u1', role: 'user', state: 'done', tutor: 'translation',
      html: messageHtml("How do I clear the panel? ||| Как очистить панель?\nLet's think about the UX. ||| Давай подумаем про UX.\nI suggest showing only the latest exchange, with a history for this session. ||| Я предлагаю показывать только последнее общение и сделать историю в рамках сессии.", o),
    },
    { id: 'a1', role: 'assistant', state: 'done', html: messageHtml(reply, o) },
    {
      id: 'a2', role: 'assistant', state: 'untranslated',
      html: messageHtml('Готово: панель показывает только последнее общение, а история живёт в шторке.', o),
    },
  ],
}

const translatedA2 = messageHtml('Done: the panel shows only the latest exchange, and the history lives in the sheet. ||| Готово: панель показывает только последнее общение, а история живёт в шторке.', o)

const settings = { enabled: true, level: 'B1', target: 'English', native: 'Russian', tutorModel: 'haiku', autoRead: false }
const usage = { input: 6200, output: 3100, calls: 9 }
writeFileSync('fixture.js', 'window.FIXTURE = ' + JSON.stringify({ exchanges: [older, latest], settings, usage, translatedA2 }, null, 2) + ';\n')
console.log('fixture.js written: 2 exchanges')
