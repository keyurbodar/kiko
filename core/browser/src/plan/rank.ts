import { BROWSER } from "../config"
import type { JevPort } from "../decide/ports"
import { goalWords, rawWords } from "./words"

const TARGET = 300

export interface Ranker {
  rank(find: string, passages: string[], signal: AbortSignal): Promise<number[]>
}

function split(text: string): string[] {
  const parts = text
    .split(/\n+/)
    .flatMap((p) => p.match(/[^.!?]+[.!?]*\s*/g) ?? [p])
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const out: string[] = []
  let cur = ""
  for (const s of parts) {
    if (cur && cur.length + s.length + 1 > TARGET) {
      out.push(cur)
      cur = ""
    }
    cur = cur ? `${cur} ${s}` : s
    while (cur.length > TARGET * 2) {
      out.push(cur.slice(0, TARGET * 2))
      cur = cur.slice(TARGET * 2)
    }
  }
  if (cur) out.push(cur)
  return out
}

function lexicalScores(find: string, passages: string[]): number[] {
  const words = goalWords(find)
  const bags = passages.map((p) => rawWords(p))
  const avg = bags.reduce((n, b) => n + b.length, 0) / (bags.length || 1)
  const idf = new Map(
    words.map((w) => {
      const df = bags.reduce((n, b) => n + (b.includes(w) ? 1 : 0), 0)
      return [w, Math.log(1 + (bags.length - df + 0.5) / (df + 0.5))] as const
    }),
  )
  return bags.map((b) => {
    let s = 0
    for (const w of words) {
      const tf = b.reduce((n, x) => n + (x === w ? 1 : 0), 0)
      if (tf) s += (idf.get(w) ?? 0) * ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * b.length) / (avg || 1))))
    }
    return s
  })
}

export const lexicalRanker: Ranker = { rank: async (find, passages) => lexicalScores(find, passages) }

export function jevRanker(port: JevPort, fallback: Ranker = lexicalRanker): Ranker {
  return {
    async rank(find, passages, signal) {
      if (!port.noul || passages.length === 0) return fallback.rank(find, passages, signal)
      const questions = passages.map((p, i) => ({
        key: `p${i}`,
        instructions: `Does this passage help with: ${find}?\n\n${p}`,
      }))
      const answers = await port.noul({ state: { find }, questions }, signal)
      return passages.map((_, i) => answers[`p${i}`] ?? 0)
    },
  }
}

function join(chosen: string[]): string {
  let out = ""
  for (const p of chosen) {
    const next = out ? `${out} … ${p}` : p
    if (next.length > BROWSER.summaryText) return out || p.slice(0, BROWSER.summaryText)
    out = next
  }
  return out
}

function pick(passages: string[], scores: number[], k: number): string {
  const top = scores
    .map((s, i) => [s, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, k)
    .map(([, i]) => i)
    .sort((a, b) => a - b)
  return join(top.map((i) => passages[i]))
}

export function passages(text: string, find: string, k: number): string {
  const ps = split(text)
  return pick(ps, lexicalScores(find, ps), k)
}

export async function rankPassages(text: string, find: string, k: number, ranker: Ranker, signal: AbortSignal): Promise<string> {
  const ps = split(text).slice(0, BROWSER.passagesPerRank * 3)
  return pick(ps, await ranker.rank(find, ps, signal), k)
}
