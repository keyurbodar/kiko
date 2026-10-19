export type Span = { lo: number; hi: number }

export type Shape = {
  page: number
  floor: number
  budget: number
  retile: number
  log?: ZoomLog
}

export type ZoomLog = "chat" | "life"

// The shape of a schema step. Structurally the same as core/durable's Step, which this package may not import.
export type Step = string | ((sql: SqlStorage) => void)

export const ROOM_SHAPE: Shape = { page: 16, floor: 32, budget: 48, retile: 32, log: "chat" }
export const LIFE_SHAPE: Shape = { page: 8, floor: 16, budget: 32, retile: 24, log: "life" }

export const LINE_BYTES = 280
const LINE_WORDS = 40
export const MAX_NAP_FAILS = 3

function tiles(T: number, alpha: number): Span[] {
  let root = 1
  while (root < T) root *= 2
  const out: Span[] = []
  const stack: Span[] = [{ lo: 0, hi: root }]
  while (stack.length) {
    const top = stack.pop()
    if (!top) break
    const { lo, hi } = top
    if (lo >= T) continue
    const size = hi - lo
    if (size > 1 && (hi > T || size > alpha * (T - lo))) {
      const mid = (lo + hi) / 2
      stack.push({ lo: mid, hi }, { lo, hi: mid })
    } else out.push({ lo, hi })
  }
  return out.sort((a, b) => a.lo - b.lo)
}

export function cover(T: number, budget: number): Span[] {
  if (T <= 0) return []
  if (T <= budget) return Array.from({ length: T }, (_, i) => ({ lo: i, hi: i + 1 }))
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (tiles(T, mid).length > budget) lo = mid
    else hi = mid
  }
  const out = tiles(T, hi)
  while (out.length < budget) {
    const at = out.findLastIndex((s) => s.hi - s.lo > 1)
    const span = out[at]
    if (!span) break
    const { lo: a, hi: b } = span
    out.splice(at, 1, { lo: a, hi: (a + b) / 2 }, { lo: (a + b) / 2, hi: b })
  }
  return out
}

export function region(count: number, shape: Shape): number {
  return Math.max(0, Math.floor((count - shape.floor) / shape.page) * shape.page)
}

export function tile(prev: readonly Span[] | null, end: number, shape: Shape): Span[] {
  const { page } = shape
  if (prev && validPrefix(prev, end, page)) {
    const last = prev[prev.length - 1]
    const from = last ? last.hi : 0
    const next = [...prev]
    for (let lo = from; lo < end; lo += page) next.push({ lo, hi: lo + page })
    if (next.length <= shape.budget) return next
  }
  return cover(end / page, shape.retile).map((s) => ({ lo: s.lo * page, hi: s.hi * page }))
}

function validPrefix(prev: readonly Span[], end: number, page: number): boolean {
  let at = 0
  for (const s of prev) {
    const size = s.hi - s.lo
    if (s.lo !== at || size < page || size % page || !isPow2(size / page) || s.lo % size) return false
    at = s.hi
  }
  return at <= end
}

const isPow2 = (n: number) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0

export function isNode(span: Span, page: number): boolean {
  const size = span.hi - span.lo
  return size >= page && size % page === 0 && isPow2(size / page) && span.lo % size === 0
}

export function spanOf(id: string): Span | null {
  const m = /^(?:\w+:)?#?(\d+)-(\d+)$/.exec(id.trim())
  if (!m) return null
  const lo = Number(m[1])
  const hi = Number(m[2]) + 1
  const size = hi - lo
  if (size < 2 || (size & (size - 1)) !== 0 || lo % size !== 0) return null
  return { lo, hi }
}

export type Item = {
  pos: number
  at: number
  text: string
  shown?: string
}

export type Node = { text: string; from: number; to: number }

type NapInput = { span: Span; items: Item[] } | { span: Span; halves: [Node, Node] }

// A tree's table and its fail counter. The object's schema list runs these, so a tree never creates a table on use.
export function treeSteps(name: string): Step[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${name} (size INTEGER NOT NULL, k INTEGER NOT NULL, text TEXT NOT NULL, at_from INTEGER NOT NULL, at_to INTEGER NOT NULL, PRIMARY KEY (size, k)) WITHOUT ROWID`,
    `CREATE TABLE IF NOT EXISTS ${name}_fails (size INTEGER NOT NULL, k INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (size, k)) WITHOUT ROWID`,
  ]
}

export class Tree {
  constructor(
    private readonly sql: SqlStorage,
    private readonly name: string,
    readonly shape: Shape,
    private readonly items: (lo: number, hi: number) => Item[],
  ) {}

  node(span: Span): Node | null {
    const size = span.hi - span.lo
    const row = this.sql
      .exec<{ text: string; at_from: number; at_to: number }>(`SELECT text, at_from, at_to FROM ${this.name} WHERE size = ? AND k = ?`, size, span.lo / size)
      .toArray()[0]
    return row ? { text: row.text, from: row.at_from, to: row.at_to } : null
  }

  put(span: Span, node: Node): boolean {
    const size = span.hi - span.lo
    const k = span.lo / size
    return (
      this.sql.exec(`INSERT OR IGNORE INTO ${this.name} (size, k, text, at_from, at_to) VALUES (?, ?, ?, ?, ?)`, size, k, node.text, node.from, node.to)
        .rowsWritten > 0
    )
  }

  forget(pos: number): number {
    return this.sql.exec(`DELETE FROM ${this.name} WHERE k * size <= ? AND (k + 1) * size > ?`, pos, pos).rowsWritten
  }

  pending(settled: number, limit: number): Span[] {
    const out: Span[] = []
    const ready = (span: Span) => {
      if (span.hi > settled) return false
      if (span.hi - span.lo === this.shape.page) return true
      const mid = (span.lo + span.hi) / 2
      return this.node({ lo: span.lo, hi: mid }) !== null && this.node({ lo: mid, hi: span.hi }) !== null
    }
    for (let size = this.shape.page; size <= settled && out.length < limit; size *= 2) {
      const { n, k: frontier } = this.sql.exec<{ n: number; k: number | null }>(`SELECT count(*) AS n, max(k) AS k FROM ${this.name} WHERE size = ?`, size).one()
      if (frontier !== null && n < frontier + 1) {
        const built = new Set(this.sql.exec<{ k: number }>(`SELECT k FROM ${this.name} WHERE size = ?`, size).toArray().map((r) => r.k))
        for (let k = 0; k < frontier && out.length < limit; k++) {
          const span = { lo: k * size, hi: (k + 1) * size }
          if (!built.has(k) && ready(span)) out.push(span)
        }
      }
      for (let k = (frontier ?? -1) + 1; (k + 1) * size <= settled && out.length < limit; k++) {
        const span = { lo: k * size, hi: (k + 1) * size }
        if (!ready(span)) break
        out.push(span)
      }
    }
    return out.slice(0, limit)
  }

  input(span: Span): NapInput | null {
    if (span.hi - span.lo === this.shape.page) return { span, items: this.items(span.lo, span.hi) }
    const mid = (span.lo + span.hi) / 2
    const a = this.node({ lo: span.lo, hi: mid })
    const b = this.node({ lo: mid, hi: span.hi })
    return a && b ? { span, halves: [a, b] } : null
  }

  fallback(input: NapInput): string {
    const parts = "items" in input ? input.items.map((i) => oneLine(i.text, 60)) : input.halves.map((h) => h.text)
    return capBytes(parts.join("; "), LINE_BYTES)
  }

  free(input: NapInput): string | null {
    const parts = "items" in input ? input.items.map((i) => i.text.replace(/\s+/g, " ").trim()) : input.halves.map((h) => h.text)
    const text = parts.join("; ")
    return encoder.encode(text).byteLength <= LINE_BYTES ? text : null
  }

  failed(span: Span): number {
    const size = span.hi - span.lo
    this.sql.exec(`INSERT INTO ${this.name}_fails (size, k, n) VALUES (?, ?, 1) ON CONFLICT(size, k) DO UPDATE SET n = n + 1`, size, span.lo / size)
    return this.sql.exec<{ n: number }>(`SELECT n FROM ${this.name}_fails WHERE size = ? AND k = ?`, size, span.lo / size).one().n
  }

  nodeFor(input: NapInput, text: string): Node {
    if ("items" in input) {
      return { text, from: input.items[0]?.at ?? 0, to: input.items[input.items.length - 1]?.at ?? 0 }
    }
    const [a, b] = input.halves
    return { text, from: a.from, to: b.to }
  }

  view(count: number, prev: readonly Span[] | null, now: number, tail: (lo: number, hi: number) => Item[] = this.items): { lines: string[]; tiling: Span[] } {
    const end = region(count, this.shape)
    const tiling = tile(prev, end, this.shape)
    const lines: string[] = []
    for (const span of tiling) this.render(span, now, lines)
    let day = ""
    for (const item of tail(end, count)) {
      const d = dayOf(item.at, now)
      lines.push(itemLine(item, TAIL_CUT, d !== day, this.shape.log))
      day = d
    }
    return { lines, tiling }
  }

  render(span: Span, now: number, out: string[] = []): string[] {
    const node = this.node(span)
    if (node) out.push(nodeLine(span, node, now))
    else if (span.hi - span.lo <= this.shape.page) for (const item of this.items(span.lo, span.hi)) out.push(itemLine(item, PAGE_CUT, true, this.shape.log))
    else {
      const mid = (span.lo + span.hi) / 2
      this.render({ lo: span.lo, hi: mid }, now, out)
      this.render({ lo: mid, hi: span.hi }, now, out)
    }
    return out
  }

  zoom(span: Span, count: number, now: number): string[] {
    if (span.lo >= count) return []
    if (span.hi - span.lo <= this.shape.page) return this.items(span.lo, Math.min(span.hi, count)).map((i) => itemLine(i, ZOOM_CUT, true, this.shape.log))
    const mid = (span.lo + span.hi) / 2
    const out: string[] = []
    for (const half of [{ lo: span.lo, hi: mid }, { lo: mid, hi: span.hi }]) {
      if (half.lo >= count) continue
      const node = this.node(half)
      if (node) out.push(nodeLine(half, node, now))
      else out.push(...this.zoom(half, count, now))
    }
    return out
  }
}

const TAIL_CUT = 300
const PAGE_CUT = 160
export const ZOOM_CUT = 4_000

export function itemLine(item: Item, cut: number, withDay = true, log: ZoomLog = "chat"): string {
  const d = new Date(item.at)
  const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
  const text = oneLine(item.shown ?? item.text, cut)
  const rest = text.endsWith("…") ? ` (cut, zoom ${log}:${item.pos})` : ""
  return `#${item.pos} ${withDay ? `${dayOf(item.at, item.at)} ` : ""}${time} ${text}${rest}`
}

export function nodeLine(span: Span, node: Node, now: number): string {
  return `#${span.lo}-${span.hi - 1} ${range(node.from, node.to, now)} ${node.text}`
}

export function oneLine(text: string, cut: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > cut ? `${flat.slice(0, cut)}…` : flat
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

export function dayOf(at: number, now: number): string {
  const d = new Date(at)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${d.getUTCFullYear() === new Date(now).getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`}`
}

export function range(from: number, to: number, now: number): string {
  const a = new Date(from)
  const b = new Date(to)
  const year = (d: Date) => (d.getUTCFullYear() === new Date(now).getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`)
  const day = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${day(a)}${year(a)}–${day(b)}${year(b)}`
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()) return `${day(a)}${year(a)}`
  if (a.getUTCMonth() === b.getUTCMonth()) return `${day(a)}–${b.getUTCDate()}${year(a)}`
  return `${day(a)}–${day(b)}${year(a)}`
}


export const NAP_SYSTEM =
  "you keep a long-term memory by compressing logs into single lines. you answer with exactly one line of plain lowercase text and nothing else."

const NAP_ITEM_CUT = 8_000

export function napPrompt(input: NapInput, what: "turns" | "memories"): string {
  const body = "items" in input ? input.items.map((i) => (i.text.length > NAP_ITEM_CUT ? `${i.text.slice(0, NAP_ITEM_CUT)}…` : i.text)) : input.halves.map((h) => h.text)
  return [
    "items" in input ? `compress these ${what} into one line of at most ${LINE_WORDS} words.` : `merge these two lines into one line of at most ${LINE_WORDS} words.`,
    "keep what has lasting effect: facts about people, decisions, plans, results, open questions, who did what. copy exactly every name, number, amount, date, time, place, and code (like a flight or booking number): a later reader needs them word for word. drop small talk, greetings, and repeats. invent nothing. name people and agents as they are named below.",
    "",
    ...body,
  ].join("\n")
}

export function cleanLine(answer: string): string | null {
  const first = answer
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!first) return null
  const line = first.replace(/^["'`]+|["'`]+$/g, "").replace(/^#\d+(-\d+)?\s*/, "").trim()
  return line ? capBytes(line, LINE_BYTES) : null
}

const encoder = new TextEncoder()

function cutBytes(text: string, max: number): string {
  let out = ""
  let size = 0
  for (const ch of text) {
    size += encoder.encode(ch).byteLength
    if (size > max) break
    out += ch
  }
  return out
}

export function capBytes(text: string, max: number): string {
  if (encoder.encode(text).byteLength <= max) return text
  return `${cutBytes(text, max - 3)}…`
}
