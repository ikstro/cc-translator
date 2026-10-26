// The natural voice's own process, started by the extension host when the
// person first listens with it. It loads the ONNX runtime, eSpeak NG and the
// Kokoro model from the downloaded files and turns each sentence into 24 kHz
// audio with the time each word is spoken. A process of its own keeps the
// model's memory and threads out of the extension host, and stopping it is a
// kill away. Environment: TUTOR_VOICE_DIR, TUTOR_ORT_BINDING, TUTOR_THREADS.

import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as path from 'node:path'

import * as ort from 'onnxruntime-node'

import { groupsOf, normalizePunct, normalizeText, piecesOf, postPhonemes, styleOffset, tokenSpans, tokensOf, wordTimes, type Spoken } from './kokoro'
import { espeakLanguage } from './natural'
import type { WorkerIn, WorkerOut } from './synth'

const dir = process.env.TUTOR_VOICE_DIR ?? ''
const threads = Math.max(1, Number(process.env.TUTOR_THREADS) || 2)

type Phonemize = (text: string, language: string) => Promise<string[]>
const phonemize = (createRequire(__filename)(path.join(dir, 'phonemizer.cjs')) as { phonemize: Phonemize }).phonemize

const session = ort.InferenceSession.create(path.join(dir, 'kokoro.onnx'), {
  intraOpNumThreads: threads,
  interOpNumThreads: 1,
  graphOptimizationLevel: 'all',
})
const styles = new Map<string, Float32Array>()

function styleOf(voice: string): Float32Array {
  let style = styles.get(voice)
  if (!style) {
    const bytes = fs.readFileSync(path.join(dir, `${voice}.bin`))
    style = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    styles.set(voice, style)
  }
  return style
}

async function speak(text: string, voice: string, speed: number): Promise<{ samples: Float32Array; words: ReturnType<typeof wordTimes> }> {
  const language = espeakLanguage(voice)
  const spoken: Spoken[] = []
  for (const piece of piecesOf(text)) {
    const raw = text.slice(piece.start, piece.end)
    const phonemes = piece.punct ? normalizePunct(raw) : postPhonemes((await phonemize(normalizeText(raw), language)).join(' '), language === 'en-us')
    spoken.push({ piece, phonemes })
  }
  const tokens = tokensOf(spoken)
  const model = await session
  const style = styleOf(voice)
  const parts: Float32Array[] = []
  const spans: [number, number][] = []
  let offset = 0
  for (const group of groupsOf(tokens)) {
    const ids = [0, ...group.map(t => t.id), 0]
    const at = styleOffset(group.length)
    const out = await model.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      style: new ort.Tensor('float32', style.slice(at, at + 256), [1, 256]),
      speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
    })
    const wave = out.waveform?.data as Float32Array
    const durations = (out.durations?.data ?? []) as ArrayLike<number>
    for (const [from, to] of tokenSpans(durations, wave.length)) spans.push([offset + from, offset + to])
    parts.push(wave)
    offset += wave.length / 24_000
  }
  const samples = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    samples.set(part, at)
    at += part.length
  }
  return { samples, words: wordTimes(text, spoken, tokens, spans) }
}

// One sentence at a time, in order; a cancelled job's sentences are dropped unread.
const queue: Extract<WorkerIn, { type: 'speak' }>[] = []
let busy = false

function send(message: WorkerOut): void {
  process.send?.(message)
}

async function work(): Promise<void> {
  if (busy) return
  busy = true
  try {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        const { samples, words } = await speak(next.text, next.voice, next.speed)
        send({ type: 'audio', job: next.job, index: next.index, samples, words })
      } catch (error) {
        send({ type: 'failed', job: next.job, message: error instanceof Error ? error.message : String(error) })
      }
    }
  } finally {
    busy = false
  }
}

process.on('message', (message: WorkerIn) => {
  if (message.type === 'speak') {
    queue.push(message)
    void work()
  } else if (message.type === 'cancel') {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]?.job === message.job) queue.splice(i, 1)
  }
})

session.then(
  () => send({ type: 'loaded' }),
  error => {
    send({ type: 'failed', job: -1, message: error instanceof Error ? error.message : String(error) })
    process.exit(1)
  },
)
// The extension host went away: so does this process.
process.on('disconnect', () => process.exit(0))
