// Renders the session shown in the README screenshots and writes fixture-readme.js
// (open harness.html?fixture=readme; &mode=document shows the plan tab).
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

// The person wrote English with mistakes.
const corrected = {
  id: 'u1',
  ts: '2026-10-21T09:05:00Z',
  title: 'Can you explain me why the build take so long?',
  blocks: [
    {
      id: 'u1', role: 'user', state: 'done', tutor: 'correction',
      html: tutorHtml('correction', 'Can you ~~explain me~~ **explain to me** why the build ~~take~~ **takes** so long?\nПосле explain нужен to; the build — это «оно», поэтому takes.'),
    },
    {
      id: 'a1', role: 'assistant', state: 'done',
      html: messageHtml('Most of the time goes to type checking, not to bundling. ||| Большая часть времени уходит на проверку типов, а не на сборку.\nesbuild alone finishes in under a second. ||| Сам esbuild справляется меньше чем за секунду.', o),
    },
  ],
}

// The person wrote English without mistakes.
const correct = {
  id: 'u2',
  ts: '2026-10-21T09:18:00Z',
  title: "Great, let's look at the failing test next.",
  blocks: [
    { id: 'u2', role: 'user', state: 'done', tutor: 'correct', html: userHtml("Great, let's look at the failing test next.") },
    {
      id: 'a2', role: 'assistant', state: 'done',
      html: messageHtml('Sure. Which test fails for you? ||| Конечно. Какой тест у тебя падает?', o),
    },
  ],
}

// The plan Claude presented in plan mode (in Russian; the English side comes first).
const plan = {
  id: 'p1',
  ts: '2026-10-21T09:30:00Z',
  title: 'Fix the path check on Windows',
  kind: 'plan',
  blocks: [
    {
      id: 'p1', role: 'assistant', state: 'done',
      html: messageHtml([
        '# Fix the path check on Windows ||| Исправить проверку путей в Windows',
        '## Context ||| Контекст',
        'The check compares paths as they come, so a path with backslashes never matches. ||| Проверка сравнивает пути как есть, поэтому путь с обратными слэшами никогда не совпадает.',
        '## Steps ||| Шаги',
        '1. Turn every backslash into a slash before comparing. ||| Перед сравнением заменять все обратные слэши на прямые.',
        '2. Compare drive letters without case. ||| Сравнивать буквы дисков без учёта регистра.',
        '3. Add tests for both kinds of path. ||| Добавить тесты для обоих видов путей.',
        '## Check ||| Проверка',
        'Run the tests in the panel folder; all of them should pass. ||| Запусти тесты в папке панели; все должны пройти.',
      ].join('\n'), o),
    },
  ],
}

// Latest exchange: the person wrote Russian; Claude answered in Russian.
const reply = [
  'The test builds the path with forward slashes, but Windows gives back backslashes. ||| Тест собирает путь с прямыми слэшами, а Windows возвращает обратные.',
  'So the two strings never match, even when they point to the same file. ||| Поэтому строки не совпадают, даже когда указывают на один и тот же файл.',
  '',
  'I changed the check so it turns every backslash into a slash first. ||| Я поменял проверку: сначала она заменяет все обратные слэши на прямые.',
  'Run the tests again: ||| Запусти тесты ещё раз:',
  '```powershell',
  'npm test',
  '```',
  'All 74 tests pass now. ||| Теперь проходят все 74 теста.',
].join('\n')

const latest = {
  id: 'u3',
  ts: '2026-10-21T09:41:00Z',
  title: 'Why does the test fail only on Windows?',
  blocks: [
    {
      id: 'u3', role: 'user', state: 'done', tutor: 'translation',
      html: messageHtml('Why does the test fail only on Windows? ||| Почему тест падает только на Windows?\nPlease look at the paths in feed.ts. ||| Посмотри, пожалуйста, пути в feed.ts.', o),
    },
    { id: 'a3', role: 'assistant', state: 'done', html: messageHtml(reply, o) },
  ],
}

const settings = { enabled: true, level: 'B1', target: 'English', native: 'Russian', tutorModel: 'haiku', autoRead: false }
const usage = { input: 5400, output: 2900, calls: 7 }
writeFileSync('fixture-readme.js', 'window.FIXTURE = ' + JSON.stringify({ exchanges: [corrected, correct, plan, latest], settings, usage }, null, 2) + ';\n')
console.log('fixture-readme.js written: 4 exchanges')
