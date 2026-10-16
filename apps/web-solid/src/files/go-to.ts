import { basename, HOME, inHome, strip } from "./model"

/*
 * The file search behind "Go to file…". It ranks the way t3code's palette does: every word of the
 * query must be in the field, and a hit in the name beats a hit in the path. Letters in order are
 * the last resort. The lists come from client state, so nothing here waits on the network.
 */
export interface FileHit {
  /** The tree path: `home/notes/a.md` for a home file, the plain path for the chat's own. */
  path: string
  name: string
  /** The path as the person knows it, without the `home/` prefix. */
  shown: string
  home: boolean
}

export const MAX_HITS = 50

export function fileHits(chat: readonly string[], home: readonly string[]): FileHit[] {
  const hit = (path: string): FileHit => ({ path, name: basename(path), shown: inHome(path) ? strip(path) : path, home: inHome(path) })
  return [...chat.map(hit), ...home.map((p) => hit(`${HOME}/${p}`))]
}

const norm = (text: string) => text.toLowerCase()

const inOrder = (word: string, text: string): boolean => {
  let at = 0
  for (const ch of word) {
    at = text.indexOf(ch, at) + 1
    if (at === 0) return false
  }
  return true
}

/** 3 whole, 2 starts with, 1 contains, 0 every word is in it somewhere, -1 no match. */
function words(field: string, query: string, tokens: readonly string[]): number {
  if (!tokens.every((t) => field.includes(t))) return -1
  return field === query ? 3 : field.startsWith(query) ? 2 : field.includes(query) ? 1 : 0
}

/** How well a file matches. Higher is better, 0 is no match. The name outranks the path outranks letters in order. */
export function scoreFile(hit: FileHit, query: string): number {
  const q = norm(query).trim().replace(/\s+/g, " ")
  if (!q) return 1
  const tokens = q.split(" ")
  const byName = words(norm(hit.name), q, tokens)
  if (byName >= 0) return 4000 + byName * 100
  const byPath = words(norm(hit.shown), q, tokens)
  if (byPath >= 0) return 3000 + byPath * 100
  const letters = q.replace(/ /g, "")
  if (inOrder(letters, norm(hit.name))) return 2000
  if (inOrder(letters, norm(hit.shown))) return 1000
  return 0
}

/**
 * The files to list. With no query, the recent ones come first in the order they were opened, then
 * the rest by path. With one, best match first, shorter names before longer on a tie.
 */
export function rankFiles(hits: readonly FileHit[], query: string, recent: readonly string[], limit = MAX_HITS): FileHit[] {
  const seen = new Map(recent.map((p, i) => [p, i]))
  const rank = (h: FileHit) => seen.get(h.path) ?? Infinity
  const byPath = (a: FileHit, b: FileHit) => a.name.length - b.name.length || a.shown.length - b.shown.length || (a.shown < b.shown ? -1 : 1)
  if (!query.trim()) return [...hits].sort((a, b) => rank(a) - rank(b) || (a.shown < b.shown ? -1 : a.shown > b.shown ? 1 : 0)).slice(0, limit)
  return hits
    .map((h) => ({ h, score: scoreFile(h, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || rank(a.h) - rank(b.h) || byPath(a.h, b.h))
    .slice(0, limit)
    .map((x) => x.h)
}

export const RECENT = "Recent"
export const THIS_CHAT = "This chat"
export const HOME_LABEL = "Home"

/**
 * The ranked files under their headings. With no query, the recent files come first under "Recent".
 * Rows of one heading stay together: in a fixed order with no query, else the heading hit first leads.
 */
export function listFiles(hits: readonly FileHit[], query: string, recent: readonly string[]): { hit: FileHit; group: string }[] {
  const empty = !query.trim()
  const open = new Set(recent)
  const ranked = rankFiles(hits, query, recent).map((hit) => ({ hit, group: empty && open.has(hit.path) ? RECENT : hit.home ? HOME_LABEL : THIS_CHAT }))
  const order = empty ? [RECENT, THIS_CHAT, HOME_LABEL] : [...new Set(ranked.map((r) => r.group))]
  return ranked.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
}
