export type RecallLog = "life" | "chat"
export type RecallHit = { id: string | null; line: string }
export type Rank = (lines: { id: string; text: string }[]) => Promise<string[] | null>

export const RECALL_MAX = 6

export function hitId(log: RecallLog, line: string): string | null {
  const m = /^#(\d+)\s/.exec(line)
  return m ? `${log}:${m[1]}` : null
}

export function tagHits(log: RecallLog, lines: string[]): RecallHit[] {
  return lines.map((line) => ({ id: hitId(log, line), line }))
}

export async function mergeRecall(life: RecallHit[], chat: RecallHit[], shown: Set<string>, rank: Rank, max = RECALL_MAX): Promise<string> {
  const again: string[] = []
  const fresh = (hits: RecallHit[]) =>
    hits.filter((h) => {
      if (!h.id || !shown.has(h.id)) return true
      again.push(h.id)
      return false
    })
  let l = fresh(life)
  let c = fresh(chat)
  if (l.length + c.length > max) {
    const ids = await rank([...l, ...c].flatMap((h) => (h.id ? [{ id: h.id, text: h.line }] : []))).catch(() => null)
    if (ids?.length) {
      const order = new Map(ids.map((id, i) => [id, i]))
      const keep = (hits: RecallHit[]) =>
        hits.filter((h) => !h.id || order.has(h.id)).sort((a, b) => (order.get(a.id ?? "") ?? Infinity) - (order.get(b.id ?? "") ?? Infinity))
      l = keep(l)
      c = keep(c)
    }
  }
  for (const h of [...l, ...c]) if (h.id) shown.add(h.id)
  const part = (name: string, hits: RecallHit[]) => (hits.length ? `${name}:\n${hits.map((h) => h.line).join("\n")}` : "")
  return [part("life", l), part("chat", c), again.length ? `already seen: ${again.join(", ")}` : ""].filter(Boolean).join("\n\n")
}
