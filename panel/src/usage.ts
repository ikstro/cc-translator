// Tutor tokens over time. The plugin keeps one ledger per session in
// ~/.claude/language-tutor/usage/ (tokens per local day, and the project the
// session ran in); the panel adds them up for today, 7 and 30 days, and per
// project, and deletes ledgers older than 31 days.

export type DayUsage = { input: number; output: number; calls: number }
export type Ledger = { project: string; days: Record<string, DayUsage> }

export type Totals = { tokens: number; calls: number }
export type ProjectTotals = Totals & { name: string; path: string }
export type UsageSummary = { today: Totals; week: Totals; month: Totals; projects: ProjectTotals[] }

export const EMPTY_SUMMARY: UsageSummary = {
  today: { tokens: 0, calls: 0 },
  week: { tokens: 0, calls: 0 },
  month: { tokens: 0, calls: 0 },
  projects: [],
}

/** The local calendar day of a moment, YYYY-MM-DD, as the plugin writes it. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseLedger(text: string): Ledger | undefined {
  try {
    const raw = JSON.parse(text) as { project?: unknown; days?: unknown }
    if (typeof raw.project !== 'string' || !raw.days || typeof raw.days !== 'object') return undefined
    const days: Record<string, DayUsage> = {}
    for (const [day, u] of Object.entries(raw.days as Record<string, Partial<DayUsage>>)) {
      if (!u || typeof u !== 'object') continue
      days[day] = { input: Number(u.input) || 0, output: Number(u.output) || 0, calls: Number(u.calls) || 0 }
    }
    return { project: raw.project, days }
  } catch {
    return undefined
  }
}

function lastDays(now: number, count: number): Set<string> {
  const days = new Set<string>()
  const d = new Date(now)
  for (let i = 0; i < count; i++) {
    days.add(dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i, 12).getTime()))
  }
  return days
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

/** Today, the last 7 and 30 days (today included), and the 30 days per project, most tokens first. */
export function summarize(ledgers: readonly Ledger[], now: number): UsageSummary {
  const today = dayOf(now)
  const week = lastDays(now, 7)
  const month = lastDays(now, 30)
  const sum = { today: { tokens: 0, calls: 0 }, week: { tokens: 0, calls: 0 }, month: { tokens: 0, calls: 0 } }
  const projects = new Map<string, ProjectTotals>()
  for (const ledger of ledgers) {
    const key = ledger.project.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    for (const [day, u] of Object.entries(ledger.days)) {
      if (!month.has(day)) continue
      const tokens = u.input + u.output
      const add = (t: Totals) => {
        t.tokens += tokens
        t.calls += u.calls
      }
      add(sum.month)
      if (week.has(day)) add(sum.week)
      if (day === today) add(sum.today)
      const p = projects.get(key) ?? { name: baseName(ledger.project), path: ledger.project, tokens: 0, calls: 0 }
      add(p)
      projects.set(key, p)
    }
  }
  return { ...sum, projects: [...projects.values()].sort((a, b) => b.tokens - a.tokens) }
}
