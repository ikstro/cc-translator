import { copyFileSync, mkdirSync } from 'node:fs'
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
  const [a, b] = await Promise.all([context(host), context(webview)])
  await Promise.all([a.watch(), b.watch()])
  console.log('watching…')
} else {
  await Promise.all([build(host), build(webview)])
}
