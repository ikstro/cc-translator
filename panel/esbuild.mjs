import { copyFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')

// VS Code's own icon font, served from media/ (the packaged extension ships no node_modules).
mkdirSync('media', { recursive: true })
for (const file of ['codicon.css', 'codicon.ttf']) {
  copyFileSync(`node_modules/@vscode/codicons/dist/${file}`, `media/${file}`)
}

/** @type {import('esbuild').BuildOptions} */
const host = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
  logLevel: 'info',
}

/**
 * onnxruntime-node loads its native binding from beside its own files; the
 * natural voice downloads the binding for this system instead, so the voice
 * process names it in TUTOR_ORT_BINDING.
 * @type {import('esbuild').Plugin}
 */
const downloadedBinding = {
  name: 'downloaded-binding',
  setup(b) {
    b.onLoad({ filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ }, async args => {
      const source = await readFile(args.path, 'utf8')
      const contents = source.replace(/require\(`\.\.\/bin\/[^`]+`\)/, "require('node:module').createRequire(__filename)(process.env.TUTOR_ORT_BINDING)")
      if (contents === source) throw new Error('onnxruntime-node: the binding require changed; update esbuild.mjs')
      return { contents, loader: 'js' }
    })
  },
}

/** @type {import('esbuild').BuildOptions} */
const voice = {
  entryPoints: ['src/voice-worker.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist/voice-worker.js',
  sourcemap: true,
  logLevel: 'info',
  plugins: [downloadedBinding],
}

/** @type {import('esbuild').BuildOptions} */
const webview = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'media/panel.js',
  sourcemap: false,
  logLevel: 'info',
}

if (watch) {
  const contexts = await Promise.all([context(host), context(voice), context(webview)])
  await Promise.all(contexts.map(c => c.watch()))
  console.log('watching…')
} else {
  await Promise.all([build(host), build(voice), build(webview)])
}
