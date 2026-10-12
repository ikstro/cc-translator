// Which window learns. `learner.json` names the project (its folders) whose
// window has the tutor translate; every other window's panel only records,
// with a Translate button per message. A project rather than a window id, so
// the same window learns again after VS Code restarts.

export type Learner = { folders: string[]; ts: number }

/** Where learning is, as a window sees it. */
export type LearningState = { where: 'here' | 'elsewhere' | 'nowhere'; project?: string }

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function parseLearner(text: string): Learner | undefined {
  try {
    const raw = JSON.parse(text) as { folders?: unknown; ts?: unknown }
    const folders = Array.isArray(raw.folders) ? raw.folders.filter((f): f is string => typeof f === 'string' && f.length > 0) : []
    return folders.length > 0 ? { folders, ts: typeof raw.ts === 'number' ? raw.ts : 0 } : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether a window with these folders is the learner: one of its folders is
 * a learner folder or contains one (`/tutor on` names the session's folder,
 * which can sit inside the workspace).
 */
export function learnsHere(learner: Learner | undefined, windowFolders: readonly string[]): boolean {
  if (!learner) return false
  const mine = windowFolders.map(normalize)
  return learner.folders.map(normalize).some(l => mine.some(w => l === w || l.startsWith(w + '/')))
}

/** The project's short name for "Learning is on in …": the last part of its first folder. */
export function projectName(learner: Learner | undefined): string | undefined {
  const first = learner?.folders[0]
  if (!first) return undefined
  return first.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || first
}

export function learningState(enabled: boolean, learner: Learner | undefined, windowFolders: readonly string[]): LearningState {
  if (!enabled || !learner) return { where: 'nowhere' }
  if (learnsHere(learner, windowFolders)) return { where: 'here' }
  const project = projectName(learner)
  return project ? { where: 'elsewhere', project } : { where: 'elsewhere' }
}
