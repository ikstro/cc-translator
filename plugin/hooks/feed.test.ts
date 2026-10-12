import { describe, expect, test } from 'claude-code/testing'

import { addUsage, dayOf, isHumanPrompt, isPlanPath, panelCoverage, parseLedger, parseRequests, parseTextRequests, parseTutorReply, sessionPathFor, stripMachineBlocks } from './feed'
import { isThirdLanguage, mostlyCopies, mostlyInScript, scriptForLanguage, scriptOf, sideOf, userRoute } from './script'

describe('panel coverage', () => {
  const now = 1_000_000
  test('an open panel covers its folder and subfolders, case and slashes aside', async () => {
    const beats = [{ folders: ['E:\\Work\\My-Project'], visible: true, ts: now - 1000 }]
    expect(panelCoverage(beats, 'e:/work/my-project/panel', now)).toEqual({ open: true, visible: true })
    expect(panelCoverage(beats, 'E:/Work/Other', now)).toEqual({ open: false, visible: false })
  })

  test('a hidden panel records but does not translate; a stale beat counts for nothing', async () => {
    expect(panelCoverage([{ folders: ['C:/p'], visible: false, ts: now }], 'C:/p', now)).toEqual({ open: true, visible: false })
    expect(panelCoverage([{ folders: ['C:/p'], visible: true, ts: now - 120_000 }], 'C:/p', now)).toEqual({ open: false, visible: false })
    expect(panelCoverage([{ folders: 'C:/p', ts: now }], 'C:/p', now).open).toBe(false)
  })

  test('a panel on screen in a window that is not learning does not translate', async () => {
    const shown = { folders: ['C:/p'], visible: true, ts: now }
    expect(panelCoverage([{ ...shown, learning: false }], 'C:/p', now)).toEqual({ open: true, visible: false })
    expect(panelCoverage([{ ...shown, learning: true }], 'C:/p', now)).toEqual({ open: true, visible: true })
    // A panel from before learning windows existed.
    expect(panelCoverage([shown], 'C:/p', now)).toEqual({ open: true, visible: true })
  })
})

describe('usage ledger', () => {
  test('adds calls per local day and survives a malformed file', async () => {
    let ledger = parseLedger('not json', 'C:/p')
    expect(ledger).toEqual({ project: 'C:/p', days: {} })
    ledger = addUsage(ledger, '2026-10-12', 300, 50)
    ledger = addUsage(ledger, '2026-10-12', 200, 20)
    ledger = addUsage(ledger, '2026-10-13', 10, 1)
    expect(ledger.days['2026-10-12']).toEqual({ input: 500, output: 70, calls: 2 })
    const back = parseLedger(JSON.stringify({ ...ledger, days: { ...ledger.days, junk: { input: 1 } } }), 'C:/other')
    expect(back.project).toBe('C:/p')
    expect(Object.keys(back.days)).toEqual(['2026-10-12', '2026-10-13'])
    expect(dayOf(new Date(2026, 0, 5, 23, 30).getTime())).toBe('2026-01-05')
  })
})

describe('prompts', () => {
  test('only what the person typed counts', async () => {
    expect(isHumanPrompt('composer', 'Как очистить панель?')).toBe(true)
    expect(isHumanPrompt('sdk', 'Fix the build')).toBe(true)
    expect(isHumanPrompt('task-notification', 'done')).toBe(false)
    expect(isHumanPrompt('scheduled-trigger', 'check')).toBe(false)
    expect(isHumanPrompt('unclassified', '<task-notification>\n<task-id>x</task-id>')).toBe(false)
  })

  test('requests keep only well-formed taps', async () => {
    expect(parseRequests('{"requests":[{"ref":"a","ts":5},{"ref":7},{"ts":1}]}')).toEqual([{ ref: 'a', ts: 5 }])
    expect(parseRequests('not json')).toEqual([])
  })

  test('picked texts keep a safe id and a bounded text', async () => {
    const texts = parseTextRequests('{"texts":[{"id":"a b/..c","text":" Hello. ","ts":5},{"id":"x","text":"  ","ts":1},{"id":"y","text":"t"}]}')
    expect(texts).toEqual([{ id: 'abc', text: ' Hello. ', ts: 5 }])
    expect(parseTextRequests('{"requests":[]}')).toEqual([])
    expect(parseTextRequests('{"texts":[{"id":"z","text":"' + 'x'.repeat(50_000) + '","ts":1}]}')[0]?.text).toHaveLength(40_000)
  })

  test('the tutor reply names its kind', async () => {
    expect(parseTutorReply('KIND: translation\n1. How do I clear the panel?')).toEqual({ kind: 'translation', body: '1. How do I clear the panel?' })
    expect(parseTutorReply('KIND: correction\n✓')).toEqual({ kind: 'correction', body: '✓' })
    expect(parseTutorReply('KIND: howToSay\n1. Hi.').kind).toBe('translation')
  })

  test('session ids cannot leave the sessions folder', async () => {
    expect(sessionPathFor('C:\\Users\\me', '../../evil')).toBe('C:/Users/me/.claude/language-tutor/sessions/evil.jsonl')
  })
})

describe('plans', () => {
  test('a plan is a markdown file right under ~/.claude/plans, whatever the slashes and case', async () => {
    const home = 'C:\\Users\\me'
    expect(isPlanPath('C:\\Users\\me\\.claude\\plans\\quirky-kazoo.md', home)).toBe(true)
    expect(isPlanPath('c:/users/ME/.claude/plans/quirky-kazoo.md', home)).toBe(true)
    expect(isPlanPath('C:/Users/me/.claude/plans/sub/notes.md', home)).toBe(false)
    expect(isPlanPath('C:/Users/me/.claude/plans/notes.txt', home)).toBe(false)
    expect(isPlanPath('C:/Users/me/project/plans/x.md', home)).toBe(false)
    expect(isPlanPath(undefined, home)).toBe(false)
    expect(isPlanPath('C:/Users/me/.claude/plans/x.md', undefined)).toBe(false)
  })
})

describe('the person\'s own words', () => {
  test('IDE and engine notes are stripped from a prompt', async () => {
    const raw =
      '<ide_opened_file>The user opened the file e:\\work\\my-project\\README.md in the IDE. This may or may not be related to the current task.</ide_opened_file>\nДавай проверим как будет отображаться кириллический текст.'
    expect(stripMachineBlocks(raw)).toBe('Давай проверим как будет отображаться кириллический текст.')
    expect(stripMachineBlocks('<ide_selection>const x = 1</ide_selection>\n\n\n\nFix it')).toBe('Fix it')
    expect(stripMachineBlocks('<system-reminder>be brief</system-reminder>')).toBe('')
    expect(stripMachineBlocks('Use a <div> here')).toBe('Use a <div> here')
  })

  test('Russian goes to English; English and German go to the tutor', async () => {
    expect(userRoute('Давай проверим как будет отображаться текст.', 'English', 'Russian')).toBe('to-target')
    expect(userRoute('I wants to see how the tutor work', 'English', 'Russian')).toBe('tutor-decides')
    expect(userRoute('Ich möchte sehen, wie es funktioniert', 'English', 'Russian')).toBe('tutor-decides')
    expect(userRoute('Хочу перевірити, як це працює', 'English', 'Ukrainian')).toBe('to-target')
  })
})

describe('language pairs', () => {
  // [learned, native, a message in the native language, a message in the learned one, what the script tells]
  const pairs: [string, string, string, string, 'by script' | 'by the tutor'][] = [
    ['Polish', 'Russian', 'Проверь, пожалуйста, этот файл.', 'Sprawdź proszę ten plik.', 'by script'],
    ['English', 'Russian', 'Проверь, пожалуйста, этот файл.', 'Please check this file.', 'by script'],
    ['Japanese', 'Russian', 'Проверь, пожалуйста, этот файл.', 'このファイルを確認してください。', 'by script'],
    ['English', 'Arabic', 'من فضلك تحقق من هذا الملف.', 'Please check this file.', 'by script'],
    ['Greek', 'English', 'Please check this file.', 'Παρακαλώ ελέγξτε αυτό το αρχείο.', 'by script'],
    ['Chinese', 'Japanese', 'このファイルを確認してください。', '请检查这个文件。', 'by script'],
    ['German', 'English', 'Please check this file.', 'Bitte prüfe diese Datei.', 'by the tutor'],
    ['Spanish', 'Polish', 'Sprawdź proszę ten plik.', 'Por favor, revisa este archivo.', 'by the tutor'],
  ]

  for (const [target, native, inNative, inTarget, how] of pairs) {
    test(`${target} for a ${native} speaker: ${how}`, async () => {
      if (how === 'by script') {
        expect(userRoute(inNative, target, native)).toBe('to-target')
        expect(userRoute(inTarget, target, native)).toBe('tutor-decides')
        expect(sideOf(inNative, target, native)).toBe('native')
        expect(sideOf(inTarget, target, native)).toBe('target')
      } else {
        // Same script: the tutor model names the language itself.
        expect(userRoute(inNative, target, native)).toBe('tutor-decides')
        expect(sideOf(inNative, target, native)).toBeUndefined()
        expect(sideOf(inTarget, target, native)).toBeUndefined()
      }
    })
  }
})

describe('third language', () => {
  const english = 'I checked the config. There are two problems with this file, and you should fix them.'
  test('English is a third language when neither side is English', async () => {
    expect(isThirdLanguage(english, 'Polish', 'Russian')).toBe(true)
    expect(isThirdLanguage(english, 'German', 'Spanish')).toBe(true)
    expect(isThirdLanguage(english, 'Japanese', 'Russian')).toBe(true)
    expect(isThirdLanguage(english, 'English', 'Russian')).toBe(false)
    expect(isThirdLanguage(english, 'German', 'English')).toBe(false)
  })

  test('a text in one of the pair is not', async () => {
    expect(isThirdLanguage('Sprawdziłem konfigurację. Są dwa problemy z tym plikiem i trzeba je naprawić.', 'Polish', 'Russian')).toBe(false)
    expect(isThirdLanguage('Я проверил конфиг. Есть две проблемы.', 'Polish', 'Russian')).toBe(false)
    expect(isThirdLanguage('Ich habe die Datei geprüft. Was ist das Problem? Es will nicht starten.', 'German', 'Spanish')).toBe(false)
    expect(isThirdLanguage('Jeg har tjekket filen, og den skal have en rettelse for porten.', 'Danish', 'Russian')).toBe(false)
    expect(isThirdLanguage('Ik heb het bestand bekeken, het is niet goed.', 'Dutch', 'Russian')).toBe(false)
  })

  test('a Cyrillic reply is a third language for a Polish speaker learning German', async () => {
    expect(isThirdLanguage('Я проверил конфиг. Есть две проблемы.', 'German', 'Polish')).toBe(true)
  })
})

describe('direction', () => {
  test('the side is read from the script when the two languages differ', async () => {
    expect(sideOf('Checking what the plugin wrote.', 'English', 'Russian')).toBe('target')
    expect(sideOf('Давай проверим, как работает Tutor.', 'English', 'Russian')).toBe('native')
    expect(sideOf('Vamos a ver.', 'English', 'Spanish')).toBeUndefined()
  })

  test('a translation that repeats its source is caught', async () => {
    const sources = ['Your message is a test.', 'Checking the files.']
    expect(mostlyCopies(['Your message is a test.', 'Checking the files!'], sources)).toBe(true)
    expect(mostlyCopies(['Твоё сообщение — тест.', 'Проверяю файлы.'], sources)).toBe(false)
    expect(mostlyCopies(['`npm`', undefined], ['`npm`', 'x'])).toBe(false)
  })
})

describe('scripts', () => {
  test('tells Cyrillic from Latin, ignoring code', async () => {
    expect(scriptOf('Как очистить панель `npm run build`')).toBe('Cyrillic')
    expect(scriptOf('How do I clear the panel?')).toBe('Latin')
    expect(scriptForLanguage('Ukrainian')).toBe('Cyrillic')
    expect(scriptForLanguage('English')).toBe('Latin')
    expect(mostlyInScript(['Как очистить панель?', 'Давай подумаем.', 'Clear it.'], 'Cyrillic')).toBe(true)
    expect(mostlyInScript(['How do I clear it?', 'Let us think.'], 'Cyrillic')).toBe(false)
  })
})
