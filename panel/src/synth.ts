// The host side of the natural voice: starts the voice process the first
// time the person listens with it, hands it a reading's sentences a couple
// ahead of the one playing in the webview, passes the audio back, and ends
// the process after a while without use (the model holds a few hundred MB).

import { fork, type ChildProcess } from 'node:child_process'
import * as os from 'node:os'
import * as path from 'node:path'

import type { WordTime } from './kokoro'
import type { VoicePaths } from './voicestore'

export type WorkerIn =
  | { type: 'speak'; job: number; index: number; text: string; voice: string; speed: number }
  | { type: 'cancel'; job: number }

/** `failed` with job -1: the model did not load. */
export type WorkerOut =
  | { type: 'loaded' }
  | { type: 'audio'; job: number; index: number; samples: Float32Array; words: WordTime[] }
  | { type: 'failed'; job: number; message: string }

/** Sentences made ahead of the one playing. */
const AHEAD = 2
const IDLE_MS = 5 * 60_000

export type SynthEvents = {
  audio: (id: number, index: number, samples: Float32Array, words: WordTime[]) => void
  failed: (id: number, message: string) => void
}

type Reading = { id: number; job: number; items: string[]; voice: string; speed: number; sent: number }

export class NaturalSpeaker {
  private child: ChildProcess | undefined
  private job = 0
  private reading: Reading | undefined
  private idle: NodeJS.Timeout | undefined
  private stderr = ''

  constructor(
    private readonly workerPath: string,
    private readonly paths: () => VoicePaths | undefined,
    private readonly events: SynthEvents,
  ) {}

  speak(id: number, items: string[], voice: string, speed: number): void {
    this.stop()
    const paths = this.paths()
    if (!paths) {
      this.events.failed(id, 'the natural voice is not downloaded')
      return
    }
    try {
      this.start(paths)
    } catch (error) {
      this.events.failed(id, String(error))
      return
    }
    this.job += 1
    this.reading = { id, job: this.job, items, voice, speed, sent: 0 }
    this.feed(0)
  }

  /** The webview started playing sentence `index` of reading `id`. */
  at(id: number, index: number): void {
    if (this.reading?.id === id) this.feed(index)
  }

  stop(): void {
    if (!this.reading) return
    this.child?.send({ type: 'cancel', job: this.reading.job } satisfies WorkerIn)
    this.reading = undefined
  }

  dispose(): void {
    this.reading = undefined
    if (this.idle) clearTimeout(this.idle)
    this.child?.kill()
    this.child = undefined
  }

  private feed(playing: number): void {
    const r = this.reading
    const child = this.child
    if (!r || !child) return
    while (r.sent < r.items.length && r.sent <= playing + AHEAD) {
      child.send({ type: 'speak', job: r.job, index: r.sent, text: r.items[r.sent] ?? '', voice: r.voice, speed: r.speed } satisfies WorkerIn)
      r.sent += 1
    }
    this.touch()
  }

  private start(paths: VoicePaths): void {
    if (this.child) return
    this.stderr = ''
    const child = fork(this.workerPath, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        TUTOR_VOICE_DIR: paths.dir,
        // A Windows path with backslashes, or Windows loads its own older onnxruntime.dll from System32.
        TUTOR_ORT_BINDING: path.resolve(paths.binding),
        TUTOR_THREADS: String(Math.max(1, Math.min(8, Math.floor(os.availableParallelism() / 2)))),
      },
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-2000)))
    child.on('message', (m: WorkerOut) => this.onMessage(m))
    const gone = (why: string) => {
      if (this.child !== child) return
      this.child = undefined
      const r = this.reading
      this.reading = undefined
      if (r) this.events.failed(r.id, this.stderr.trim().split('\n').pop() || why)
    }
    child.on('error', error => gone(String(error)))
    child.on('exit', code => gone(`the voice process stopped (${code})`))
    this.child = child
  }

  private onMessage(m: WorkerOut): void {
    const r = this.reading
    if (!r) return
    if (m.type === 'audio' && m.job === r.job) {
      // The last sentence is made: the reading needs nothing more, and the process may rest.
      if (m.index === r.items.length - 1) this.reading = undefined
      this.events.audio(r.id, m.index, m.samples, m.words)
    }
    if (m.type === 'failed' && (m.job === r.job || m.job === -1)) {
      this.reading = undefined
      this.events.failed(r.id, m.message)
    }
  }

  /** Ends the process once nothing has been read for a while. */
  private touch(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      if (this.reading) return this.touch()
      this.child?.kill()
      this.child = undefined
    }, IDLE_MS)
  }
}
