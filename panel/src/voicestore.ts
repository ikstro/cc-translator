// The natural voice's files: the Kokoro model and its voices, eSpeak NG (in
// phonemizer.js) and the ONNX runtime built for this system. Downloaded once,
// when the person asks, from the project's GitHub release into the
// extension's storage, each file gzipped there and checked here against the
// size and SHA-256 in voice-manifest.json (written by scripts/build-voice.mjs).

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'

import type { NaturalState } from './natural'

export const VOICE_BASE = 'https://github.com/ikstro/cc-translator/releases/download'

/** A file as it lands on disk (`name`, `size`, `sha256`) and as the release holds it (`asset`, gzipped, `bytes`). */
export type VoiceFile = { name: string; asset: string; size: number; bytes: number; sha256: string }
export type VoiceManifest = { release: string; files: VoiceFile[]; runtimes: Record<string, VoiceFile[]> }

/** Everything this system needs, or undefined where the ONNX runtime has no build (Intel Macs, 32-bit systems). */
export function filesFor(manifest: VoiceManifest, platform: string, arch: string): VoiceFile[] | undefined {
  const runtime = manifest.runtimes[`${platform}-${arch}`]
  return runtime ? [...manifest.files, ...runtime] : undefined
}

export type VoicePaths = { dir: string; model: string; binding: string; phonemizer: string; voice: (id: string) => string }

export type VoiceStoreOptions = {
  manifest: VoiceManifest
  /** The folder that holds one subfolder per release. */
  root: string
  platform: string
  arch: string
  /** The body of a release asset. */
  open: (url: string) => Promise<AsyncIterable<Uint8Array>>
  onChange: () => void
}

export class VoiceStore {
  private status: NaturalState['status']
  private progress = 0
  private readonly files: VoiceFile[] | undefined
  private readonly dir: string

  constructor(private readonly options: VoiceStoreOptions) {
    this.files = filesFor(options.manifest, options.platform, options.arch)
    this.dir = path.join(options.root, options.manifest.release)
    this.status = !this.files ? 'unsupported' : this.complete() ? 'ready' : 'absent'
  }

  /** The download in MB, rounded to tens. */
  get size(): number {
    const bytes = (this.files ?? []).reduce((n, f) => n + f.bytes, 0)
    return Math.max(10, Math.round(bytes / 1e7) * 10)
  }

  get state(): { status: NaturalState['status']; progress: number; size: number } {
    return { status: this.status, progress: this.progress, size: this.size }
  }

  get paths(): VoicePaths | undefined {
    if (this.status !== 'ready') return undefined
    const dir = this.dir
    return {
      dir,
      model: path.join(dir, 'kokoro.onnx'),
      binding: path.join(dir, 'onnxruntime_binding.node'),
      phonemizer: path.join(dir, 'phonemizer.cjs'),
      voice: id => path.join(dir, `${id}.bin`),
    }
  }

  /** Downloads what is missing; a second call while one runs waits for the same download. */
  download(): Promise<void> {
    if (!this.files || this.status === 'ready') return Promise.resolve()
    if (this.running) return this.running
    this.running = this.fetchAll(this.files).finally(() => (this.running = undefined))
    return this.running
  }

  private running: Promise<void> | undefined

  private async fetchAll(files: VoiceFile[]): Promise<void> {
    this.set('downloading', 0)
    const total = files.reduce((n, f) => n + f.bytes, 0)
    let done = 0
    let shown = 0
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      for (const file of files) {
        if (this.has(file)) {
          done += file.bytes
          continue
        }
        await this.fetchFile(file, got => {
          const progress = (done + got) / total
          // Every whole percent, not every chunk.
          if (progress - shown >= 0.01) {
            shown = progress
            this.set('downloading', progress)
          }
        })
        done += file.bytes
      }
      this.set('ready', 1)
      this.removeOldReleases()
    } catch (error) {
      this.set('failed', done / total)
      throw error
    }
  }

  private async fetchFile(file: VoiceFile, onBytes: (got: number) => void): Promise<void> {
    const target = path.join(this.dir, file.name)
    const part = `${target}.part`
    const hash = createHash('sha256')
    let got = 0
    let size = 0
    const body = await this.options.open(`${VOICE_BASE}/${this.options.manifest.release}/${file.asset}`)
    await pipeline(
      Readable.from(body),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          got += chunk.length
          onBytes(got)
          callback(null, chunk)
        },
      }),
      createGunzip(),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length
          hash.update(chunk)
          callback(null, chunk)
        },
      }),
      fs.createWriteStream(part),
    )
    const sha256 = hash.digest('hex')
    if (size !== file.size || sha256 !== file.sha256) {
      fs.rmSync(part, { force: true })
      throw new Error(`${file.name} did not arrive whole`)
    }
    fs.renameSync(part, target)
  }

  private has(file: VoiceFile): boolean {
    try {
      return fs.statSync(path.join(this.dir, file.name)).size === file.size
    } catch {
      return false
    }
  }

  private complete(): boolean {
    return (this.files ?? []).every(f => this.has(f))
  }

  /** A newer release replaced the files of an older one. */
  private removeOldReleases(): void {
    try {
      for (const name of fs.readdirSync(this.options.root)) {
        if (name !== this.options.manifest.release) fs.rmSync(path.join(this.options.root, name), { recursive: true, force: true })
      }
    } catch {
      // nothing else there
    }
  }

  private set(status: NaturalState['status'], progress: number): void {
    this.status = status
    this.progress = progress
    this.options.onChange()
  }
}
