export type RecallLog = "life" | "chat"
export type RecallHit = { id: string | null; line: string }

const RECALL_MAX = 6

export function hitId(log: RecallLog, line: string): string | null {
  const m = /^#(\d+)\s/.exec(line)
  return m ? `${log}:${m[1]}` : null
}

export function tagHits(log: RecallLog, lines: string[]): RecallHit[] {
  return lines.map((line) => ({ id: hitId(log, line), line }))
}

export function mergeRecall(life: RecallHit[], chat: RecallHit[], shown: Set<string>, max = RECALL_MAX): string {
  const again: string[] = []
  const fresh = (hits: RecallHit[]) =>
    hits.filter((h) => {
      if (!h.id || !shown.has(h.id)) return true
      again.push(h.id)
      return false
    })
  const lf = fresh(life)
  const cf = fresh(chat)
  const room = Math.min(cf.length, Math.max(max - lf.length, max >> 1))
  const l = lf.slice(0, max - room)
  const c = cf.slice(0, room)
  for (const h of [...l, ...c]) if (h.id) shown.add(h.id)
  const part = (name: string, hits: RecallHit[]) => (hits.length ? `${name}:\n${hits.map((h) => h.line).join("\n")}` : "")
  return [part("life", l), part("chat", c), again.length ? `already seen: ${again.join(", ")}` : ""].filter(Boolean).join("\n\n")
}
