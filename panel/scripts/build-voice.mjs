// Builds the natural voice's download: the Kokoro-82M model (uint8, the
// fastest on a CPU for its size) and five of its voices from Hugging Face,
// eSpeak NG as phonemizer.js, and the ONNX runtime for each system from the
// onnxruntime-node package. Usage: node scripts/build-voice.mjs
//
// Writes every file gzipped to .cache/voice/release/ (upload them to the
// GitHub release named in RELEASE) and src/voice-manifest.json, which the
// panel checks each download against. Kokoro is Apache-2.0, phonemizer.js
// Apache-2.0 with eSpeak NG inside (GPL-3.0), ONNX Runtime MIT.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const RELEASE = 'voice-1'
const HF = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/main'
const VOICES = ['af_heart', 'af_bella', 'bf_emma', 'am_michael', 'bm_george']
const ORT = JSON.parse(readFileSync('node_modules/onnxruntime-node/package.json', 'utf8')).version
/** Each system's ONNX runtime: the Node binding and the one library it loads from beside itself. */
const RUNTIMES = {
  'win32-x64': 'onnxruntime.dll',
  'win32-arm64': 'onnxruntime.dll',
  'darwin-arm64': 'libonnxruntime.1.dylib',
  'linux-x64': 'libonnxruntime.so.1',
  'linux-arm64': 'libonnxruntime.so.1',
}
const CACHE = '.cache/voice'
const OUT = `${CACHE}/release`

async function fetchOnce(url, name) {
  const file = `${CACHE}/src/${name}`
  if (existsSync(file)) return readFileSync(file)
  mkdirSync(`${CACHE}/src`, { recursive: true })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  writeFileSync(file, bytes)
  return bytes
}

mkdirSync(OUT, { recursive: true })

/** Gzips one file into the release folder and describes it for the manifest. */
function pack(name, asset, bytes) {
  const gz = gzipSync(bytes, { level: 9 })
  writeFileSync(`${OUT}/${asset}`, gz)
  console.log(`${asset}: ${(bytes.length / 1e6).toFixed(1)} MB → ${(gz.length / 1e6).toFixed(1)} MB`)
  return { name, asset, size: bytes.length, bytes: gz.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}

const files = [
  pack('kokoro.onnx', 'kokoro-v1.0-uint8.onnx.gz', await fetchOnce(`${HF}/onnx/model_uint8.onnx`, 'model_uint8.onnx')),
  ...(await Promise.all(VOICES.map(async v => pack(`${v}.bin`, `${v}.bin.gz`, await fetchOnce(`${HF}/voices/${v}.bin`, `${v}.bin`))))),
  pack('phonemizer.cjs', 'phonemizer-1.2.1.cjs.gz', readFileSync('node_modules/phonemizer/dist/phonemizer.cjs')),
]

const runtimes = {}
for (const [system, library] of Object.entries(RUNTIMES)) {
  const dir = `node_modules/onnxruntime-node/bin/napi-v6/${system.replace('-', '/')}`
  runtimes[system] = [
    pack('onnxruntime_binding.node', `ort-${ORT}-${system}-binding.node.gz`, readFileSync(`${dir}/onnxruntime_binding.node`)),
    pack(library, `ort-${ORT}-${system}-${library}.gz`, readFileSync(`${dir}/${library}`)),
  ]
}

writeFileSync('src/voice-manifest.json', JSON.stringify({ release: RELEASE, files, runtimes }, null, 2) + '\n')
console.log(`src/voice-manifest.json: ${RELEASE}, ${files.length} files + ${Object.keys(runtimes).length} runtimes`)
