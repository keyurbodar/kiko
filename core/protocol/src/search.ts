import type { ChatSearchHit } from "./room"

export const SNIPPET_OPEN = "\u0002"
export const SNIPPET_CLOSE = "\u0003"

export type SnippetPart = { text: string; match: boolean }

export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = []
  let match = false
  let text = ""
  const flush = () => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last && last.match === match) last.text += text
    else parts.push({ text, match })
    text = ""
  }
  for (const ch of snippet) {
    if (ch === SNIPPET_OPEN || ch === SNIPPET_CLOSE) {
      flush()
      match = ch === SNIPPET_OPEN
    } else text += ch
  }
  flush()
  return parts
}

const snippetText = (snippet: string) =>
  snippetParts(snippet)
    .map((p) => p.text)
    .join("")

export function mergeHits(
  pages: readonly { results: readonly ChatSearchHit[]; more: boolean }[],
  limit: number,
): { results: ChatSearchHit[]; next: number | null } {
  const all = pages.flatMap((p) => p.results)
  all.sort((a, b) => b.at - a.at || (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0) || b.seq - a.seq)
  const results = all.slice(0, limit)
  const more = all.length > limit || pages.some((p) => p.more)
  const last = results[results.length - 1]
  return { results, next: more && last ? last.at : null }
}
