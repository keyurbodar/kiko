export type RunSummary = { label: string; startedAt?: number; endedAt?: number }

const KEY = "kiko.run-summaries"
const MAX = 300

function load(): Map<string, RunSummary> {
  try {
    const raw = localStorage.getItem(KEY)
    return new Map(raw ? (JSON.parse(raw) as [string, RunSummary][]) : [])
  } catch {
    return new Map()
  }
}

let summaries: Map<string, RunSummary> | undefined

const all = () => (summaries ??= load())

export const recallSummary = (key: string): RunSummary | undefined => all().get(key)

export function rememberSummary(key: string, summary: RunSummary): void {
  const map = all()
  const old = map.get(key)
  if (old?.label === summary.label && old.startedAt === summary.startedAt && old.endedAt === summary.endedAt) return
  map.delete(key)
  map.set(key, summary)
  while (map.size > MAX) map.delete(map.keys().next().value as string)
  try {
    localStorage.setItem(KEY, JSON.stringify([...map]))
  } catch {}
}
