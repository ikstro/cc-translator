import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, test } from 'vitest'

import { chosenNatural, systemVoiceName } from './natural'
import { VOICE_BASE, VoiceStore, filesFor, type VoiceManifest } from './voicestore'
import realManifest from './voice-manifest.json'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function asset(name: string, content: string) {
  const bytes = Buffer.from(content)
  const gz = gzipSync(bytes)
  return { file: { name, asset: `${name}.gz`, size: bytes.length, bytes: gz.length, sha256: createHash('sha256').update(bytes).digest('hex') }, gz }
}

function setup(options: { corrupt?: string; fail?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voicestore-'))
  dirs.push(root)
  const model = asset('kokoro.onnx', 'model '.repeat(1000))
  const binding = asset('onnxruntime_binding.node', 'binding')
  const manifest: VoiceManifest = { release: 'voice-9', files: [model.file], runtimes: { 'win32-x64': [binding.file] } }
  const served = new Map([model, binding].map(a => [`${VOICE_BASE}/voice-9/${a.file.asset}`, a.gz]))
  const asked: string[] = []
  let changes = 0
  const make = (platform = 'win32', arch = 'x64') =>
    new VoiceStore({
      manifest,
      root,
      platform,
      arch,
      open: async url => {
        asked.push(url)
        if (options.fail && url.endsWith(options.fail)) throw new Error('offline')
        const gz = served.get(url)
        if (!gz) throw new Error(`404 ${url}`)
        const body = options.corrupt && url.endsWith(options.corrupt) ? gzipSync(Buffer.from('something else')) : gz
        return (async function* () {
          yield body.subarray(0, 10)
          yield body.subarray(10)
        })()
      },
      onChange: () => changes++,
    })
  return { root, make, asked, changes: () => changes }
}

describe('natural voice download', () => {
  test('downloads, unpacks and checks every file, then finds them again on the next start', async () => {
    const { root, make, asked, changes } = setup()
    const store = make()
    expect(store.state.status).toBe('absent')
    await store.download()
    expect(store.state.status).toBe('ready')
    expect(changes()).toBeGreaterThan(1)
    expect(asked).toHaveLength(2)
    expect(fs.readFileSync(path.join(root, 'voice-9', 'kokoro.onnx'), 'utf8')).toBe('model '.repeat(1000))
    expect(store.paths?.binding).toBe(path.join(root, 'voice-9', 'onnxruntime_binding.node'))
    expect(make().state.status).toBe('ready')
  })

  test('a file that does not match its checksum fails the download and is not kept', async () => {
    const { root, make } = setup({ corrupt: 'kokoro.onnx.gz' })
    const store = make()
    await expect(store.download()).rejects.toThrow('did not arrive whole')
    expect(store.state.status).toBe('failed')
    expect(fs.existsSync(path.join(root, 'voice-9', 'kokoro.onnx'))).toBe(false)
    expect(store.paths).toBeUndefined()
  })

  test('a retry fetches only what is missing', async () => {
    const { make, asked } = setup({ fail: 'binding.node.gz' })
    const store = make()
    await expect(store.download()).rejects.toThrow('offline')
    asked.length = 0
    await expect(store.download()).rejects.toThrow('offline')
    expect(asked.map(u => u.split('/').pop())).toEqual(['onnxruntime_binding.node.gz'])
  })

  test('a system without an ONNX runtime build is not offered the voice', () => {
    const { make } = setup()
    expect(make('darwin', 'x64').state.status).toBe('unsupported')
    expect(filesFor(realManifest as VoiceManifest, 'darwin', 'x64')).toBeUndefined()
    expect(filesFor(realManifest as VoiceManifest, 'win32', 'x64')?.map(f => f.name)).toContain('onnxruntime.dll')
  })
})

describe('choosing the voice', () => {
  test('Automatic reads with Heart; a system voice by its name; a natural one by its id', () => {
    expect(chosenNatural('')?.id).toBe('af_heart')
    expect(chosenNatural('natural:bm_george')?.id).toBe('bm_george')
    expect(chosenNatural('Microsoft Zira Desktop')).toBeUndefined()
    expect(systemVoiceName('natural:af_bella')).toBe('')
    expect(systemVoiceName('Microsoft Zira Desktop')).toBe('Microsoft Zira Desktop')
  })
})
