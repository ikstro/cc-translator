// The platform's own synthesizer, used when the webview has no voices.
// On Windows, System.Speech reports each word it starts as
// "W <position> <length>" on stdout, positions in UTF-16 units of the text,
// so the panel can highlight the word being spoken.

import { spawn, type ChildProcess } from 'node:child_process'

import type { HostVoice } from './protocol'

const SAPI_HELPER = `
using System;
using System.Globalization;
using System.Speech.Synthesis;
public static class TutorSpeak {
  public static void Run(string voice, int rate, string culture, string text) {
    using (var s = new SpeechSynthesizer()) {
      s.SetOutputToDefaultAudioDevice();
      s.Rate = rate;
      bool chosen = false;
      if (!String.IsNullOrEmpty(voice)) { try { s.SelectVoice(voice); chosen = true; } catch {} }
      if (!chosen && !String.IsNullOrEmpty(culture)) {
        try { s.SelectVoiceByHints(VoiceGender.NotSet, VoiceAge.NotSet, 0, new CultureInfo(culture)); } catch {}
      }
      s.SpeakProgress += (o, e) => { Console.Out.WriteLine("W " + e.CharacterPosition + " " + e.CharacterCount); Console.Out.Flush(); };
      s.Speak(text);
    }
  }
}`

const SAPI_SCRIPT = [
  '[Console]::InputEncoding = [Text.Encoding]::UTF8',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Speech',
  'Add-Type -TypeDefinition $env:TUTOR_HELPER -ReferencedAssemblies System.Speech',
  '$text = [Console]::In.ReadToEnd()',
  '[TutorSpeak]::Run($env:TUTOR_VOICE, [int]$env:TUTOR_RATE, $env:TUTOR_LANG, $text)',
].join('; ')

const SAPI_LIST =
  'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture.Name }'

export type SpeechEvents = {
  progress: (id: number, pos: number, len: number) => void
  done: (id: number) => void
}

export class Speaker {
  private child: ChildProcess | undefined
  private childId = 0

  constructor(private readonly events: SpeechEvents) {}

  static canSpeak(): boolean {
    return process.platform === 'win32' || process.platform === 'darwin'
  }

  speak(id: number, text: string, lang: string, voice: string, rate: number): void {
    this.stop()
    if (!text.trim()) {
      this.events.done(id)
      return
    }
    let child: ChildProcess
    try {
      if (process.platform === 'win32') {
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SAPI_SCRIPT], {
          stdio: ['pipe', 'pipe', 'ignore'],
          env: {
            ...process.env,
            TUTOR_HELPER: SAPI_HELPER,
            TUTOR_VOICE: voice,
            TUTOR_RATE: String(Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)))),
            TUTOR_LANG: lang.replace(/[^a-zA-Z-]/g, ''),
          },
        })
      } else if (process.platform === 'darwin') {
        const args = ['-r', String(Math.round(175 * rate))]
        if (voice) args.push('-v', voice)
        child = spawn('say', args, { stdio: ['pipe', 'ignore', 'ignore'] })
      } else {
        this.events.done(id)
        return
      }
    } catch {
      this.events.done(id)
      return
    }
    this.child = child
    this.childId = id
    let buffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      let at = buffer.indexOf('\n')
      while (at >= 0) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        const m = /^W (\d+) (\d+)$/.exec(line)
        if (m && this.child === child) this.events.progress(id, Number(m[1]), Number(m[2]))
        at = buffer.indexOf('\n')
      }
    })
    const done = () => {
      if (this.child !== child) return
      this.child = undefined
      this.events.done(id)
    }
    child.on('error', done)
    child.on('exit', done)
    child.stdin?.end(text, 'utf8')
  }

  stop(): void {
    const child = this.child
    if (!child) return
    this.child = undefined
    try {
      child.kill()
    } catch {
      // already gone
    }
    this.events.done(this.childId)
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise(resolve => {
    try {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] })
      let out = ''
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => (out += chunk))
      child.on('error', () => resolve(''))
      child.on('exit', () => resolve(out))
    } catch {
      resolve('')
    }
  })
}

export async function listHostVoices(): Promise<HostVoice[]> {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SAPI_LIST])
    return out
      .split(/\r?\n/)
      .map(line => line.trim().split('|'))
      .filter((parts): parts is [string, string] => parts.length === 2 && !!parts[0])
      .map(([name, lang]) => ({ name, lang }))
  }
  if (process.platform === 'darwin') {
    const out = await run('say', ['-v', '?'])
    return out
      .split('\n')
      .map(line => /^(.+?)\s{2,}([a-z]{2}[_-][A-Z]{2})\s/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => ({ name: (m[1] ?? '').trim(), lang: m[2] ?? '' }))
  }
  return []
}
