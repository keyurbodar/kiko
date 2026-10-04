// Architecture section 13. Log memory, after OptMem (github.com/VictorTaelin/OptMem).
//
// A log is a list of items that only grows: a room's turns, or a user's life lines. Position is
// identity. Over it sits a binary tree of one-line summaries: a node is an aligned power-of-two span
// of items, summarized from raw items when it is one page, else from its two halves. Summaries are a
// cache: any node can be dropped and built again from the log.
//
// A reader never sees the log whole. It sees a view: the newest `floor` items verbatim, and before
// them a tiling of the rest with at most `budget` lines, coarser with age (memo's `cover`). So every
// request costs the same, at message 50 or at message 50,000.
//
// Kiko departs from memo in four places, each for a reason:
// - The smallest summary is a page of `page` items, not 2, so a chat pays about one call per four
//   turns instead of one per turn.
// - The newest `floor` items are never compressed.
// - The tiling is sticky: new pages append to the last tiling, which is redone only past `budget`, so
//   the old lines stay byte-identical and the provider's prompt cache keeps hitting.
// - A forgotten node leaves a hole that is rebuilt alone, instead of truncating every later node.
// And summaries are made in the background, never by the agent in the middle of a reply: a missing
// node renders as its halves, so nothing ever waits for one.

/** `[lo, hi)` in item positions. A node's span is aligned and its size is a page times a power of two. */
export type Span = { lo: number; hi: number }

export type Shape = {
  /** Items in the smallest summary. */
  page: number
  /** The newest items, never compressed. */
  floor: number
  /** The most lines the compressed part of a view may have before it is tiled again. */
  budget: number
  /** The lines a new tiling aims for. Less than `budget`, so a tiling lasts many pages. */
  retile: number
}

/** A room: 40 turns verbatim, then at most 64 lines. */
export const ROOM_SHAPE: Shape = { page: 8, floor: 40, budget: 64, retile: 48 }
/** A user's life: 16 lines verbatim, then at most 32 lines. */
export const LIFE_SHAPE: Shape = { page: 8, floor: 16, budget: 32, retile: 24 }

/** The longest summary, in UTF-8 bytes. memo's 280. */
export const LINE_BYTES = 280

// ---------------------------------------------------------------- cover

/**
 * memo's `_cover`: tile `[0,T)` with aligned power-of-two blocks, keeping a block whole when its size
 * is at most `alpha` times its age. A bigger alpha makes fewer, coarser lines.
 */
function tiles(T: number, alpha: number): Span[] {
  let root = 1
  while (root < T) root *= 2
  const out: Span[] = []
  const stack: Span[] = [{ lo: 0, hi: root }]
  while (stack.length) {
    const { lo, hi } = stack.pop()!
    if (lo >= T) continue
    const size = hi - lo
    if (size > 1 && (hi > T || size > alpha * (T - lo))) {
      const mid = (lo + hi) / 2
      stack.push({ lo: mid, hi }, { lo, hi: mid })
    } else out.push({ lo, hi })
  }
  return out.sort((a, b) => a.lo - b.lo)
}

/**
 * memo's `cover`, in units: at most `budget` blocks over `[0,T)`, finest near T. When everything
 * fits, every unit is its own block. Leftover budget is spent splitting the newest coarse blocks.
 */
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
    let at = -1
    for (let i = 0; i < out.length; i++) if (out[i]!.hi - out[i]!.lo > 1) at = i
    if (at < 0) break
    const { lo: a, hi: b } = out[at]!
    out.splice(at, 1, { lo: a, hi: (a + b) / 2 }, { lo: (a + b) / 2, hi: b })
  }
  return out
}

/** The items a view compresses: whole pages before the floor. */
export function region(count: number, shape: Shape): number {
  return Math.max(0, Math.floor((count - shape.floor) / shape.page) * shape.page)
}

/**
 * The tiling of the compressed part `[0, end)`, in items. Keeps `prev` and adds one span per new page
 * while that fits `budget`; otherwise tiles again to `retile` lines. `prev` is trusted only when it is
 * a valid tiling of a prefix of `[0, end)`.
 */
export function tile(prev: readonly Span[] | null, end: number, shape: Shape): Span[] {
  const { page } = shape
  if (prev && validPrefix(prev, end, page)) {
    const from = prev.length ? prev[prev.length - 1]!.hi : 0
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

/** Whether `span` is a node of a tree with this page size. */
export function isNode(span: Span, page: number): boolean {
  const size = span.hi - span.lo
  return size >= page && size % page === 0 && isPow2(size / page) && span.lo % size === 0
}

/** The nodes above the item at `pos`, smallest first, up to spans that end at or before `count`. */
export function ancestors(pos: number, count: number, page: number): Span[] {
  const out: Span[] = []
  for (let size = page; size <= count; size *= 2) {
    const lo = Math.floor(pos / size) * size
    if (lo + size <= count) out.push({ lo, hi: lo + size })
  }
  return out
}

// ---------------------------------------------------------------- the tree in SQLite

/** One item of a log, as a summary prompt and a view read it. */
export type Item = {
  pos: number
  at: number
  /** The item in plain words, such as `@ada: booked JL 41`. */
  text: string
  tainted: boolean
  /** Shown before the text in a view, such as message ids a reaction can target. */
  ref?: string
}

/** One summary. `from` and `to` are the times of its first and last item. */
export type Node = { text: string; tainted: boolean; from: number; to: number }

/** What a summary is made from: the raw items of one page, or the two halves. */
export type NapInput = { span: Span; items: Item[] } | { span: Span; halves: [Node, Node] }

/**
 * The summaries of one log, in table `<name>` (`size, k` names node `[k*size, (k+1)*size)`), and the
 * nodes forgotten below the frontier in `<name>_holes`. Writes are idempotent: a node is stored once,
 * so a repeated alarm writes nothing twice. Reading the items is the caller's: `items(lo, hi)`.
 */
export class Tree {
  constructor(
    private readonly sql: SqlStorage,
    private readonly name: string,
    readonly shape: Shape,
    private readonly items: (lo: number, hi: number) => Item[],
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS ${name} (size INTEGER NOT NULL, k INTEGER NOT NULL, text TEXT NOT NULL, tainted INTEGER NOT NULL, at_from INTEGER NOT NULL, at_to INTEGER NOT NULL, PRIMARY KEY (size, k)) WITHOUT ROWID`)
    sql.exec(`CREATE TABLE IF NOT EXISTS ${name}_holes (size INTEGER NOT NULL, k INTEGER NOT NULL, PRIMARY KEY (size, k)) WITHOUT ROWID`)
  }

  node(span: Span): Node | null {
    const size = span.hi - span.lo
    const row = this.sql
      .exec<{ text: string; tainted: number; at_from: number; at_to: number }>(`SELECT text, tainted, at_from, at_to FROM ${this.name} WHERE size = ? AND k = ?`, size, span.lo / size)
      .toArray()[0]
    return row ? { text: row.text, tainted: row.tainted === 1, from: row.at_from, to: row.at_to } : null
  }

  /** Stores a summary. False when it was stored before. */
  put(span: Span, node: Node): boolean {
    const size = span.hi - span.lo
    const k = span.lo / size
    this.sql.exec(`DELETE FROM ${this.name}_holes WHERE size = ? AND k = ?`, size, k)
    return (
      this.sql.exec(`INSERT OR IGNORE INTO ${this.name} (size, k, text, tainted, at_from, at_to) VALUES (?, ?, ?, ?, ?, ?)`, size, k, node.text, node.tainted ? 1 : 0, node.from, node.to)
        .rowsWritten > 0
    )
  }

  /** Drops every summary above the item at `pos`. Each is built again, alone. Returns the count. */
  forget(pos: number): number {
    let gone = 0
    for (let size = this.shape.page; ; size *= 2) {
      const k = Math.floor(pos / size)
      const frontier = this.sql.exec<{ k: number | null }>(`SELECT max(k) AS k FROM ${this.name} WHERE size = ?`, size).one().k
      if (frontier === null) break
      if (this.sql.exec(`DELETE FROM ${this.name} WHERE size = ? AND k = ?`, size, k).rowsWritten > 0) {
        gone++
        if (k < frontier) this.sql.exec(`INSERT OR IGNORE INTO ${this.name}_holes (size, k) VALUES (?, ?)`, size, k)
      }
    }
    return gone
  }

  /**
   * Nodes that can be built now and are not, smallest first: a page once its items are settled, a
   * bigger node once both halves exist. `settled` is how many items are final. At most `limit`.
   */
  pending(settled: number, limit: number): Span[] {
    const out: Span[] = []
    const holes = this.sql.exec<{ size: number; k: number }>(`SELECT size, k FROM ${this.name}_holes ORDER BY size, k LIMIT ?`, limit).toArray()
    const ready = (span: Span) => {
      if (span.hi > settled) return false
      if (span.hi - span.lo === this.shape.page) return true
      const mid = (span.lo + span.hi) / 2
      return this.node({ lo: span.lo, hi: mid }) !== null && this.node({ lo: mid, hi: span.hi }) !== null
    }
    for (const h of holes) {
      const span = { lo: h.k * h.size, hi: (h.k + 1) * h.size }
      if (ready(span)) out.push(span)
    }
    for (let size = this.shape.page; size <= settled && out.length < limit; size *= 2) {
      const frontier = this.sql.exec<{ k: number | null }>(`SELECT max(k) AS k FROM ${this.name} WHERE size = ?`, size).one().k ?? -1
      for (let k = frontier + 1; (k + 1) * size <= settled && out.length < limit; k++) {
        const span = { lo: k * size, hi: (k + 1) * size }
        // A level is built left to right: a node whose halves are missing stops the level.
        if (!ready(span)) break
        if (!out.some((s) => s.lo === span.lo && s.hi === span.hi)) out.push(span)
      }
    }
    return out.slice(0, limit)
  }

  /** What a summary of `span` reads. Null when a half went missing since `pending` listed it. */
  input(span: Span): NapInput | null {
    if (span.hi - span.lo === this.shape.page) return { span, items: this.items(span.lo, span.hi) }
    const mid = (span.lo + span.hi) / 2
    const a = this.node({ lo: span.lo, hi: mid })
    const b = this.node({ lo: mid, hi: span.hi })
    return a && b ? { span, halves: [a, b] } : null
  }

  /** The summary of `input` with the text the model wrote: tainted when any input is, timed by its items. */
  nodeFor(input: NapInput, text: string): Node {
    if ("items" in input) {
      return { text, tainted: input.items.some((i) => i.tainted), from: input.items[0]?.at ?? 0, to: input.items[input.items.length - 1]?.at ?? 0 }
    }
    const [a, b] = input.halves
    return { text, tainted: a.tainted || b.tainted, from: a.from, to: b.to }
  }

  /**
   * The view of a log of `count` items: the compressed part as `tiling` (sticky, see `tile`), then the
   * floor verbatim. Returns the lines and the tiling to keep for next time.
   */
  view(count: number, prev: readonly Span[] | null, now: number, opts: { cut?: number; before?: (pos: number) => string | null } = {}): { lines: string[]; tiling: Span[] } {
    const end = region(count, this.shape)
    const tiling = tile(prev, end, this.shape)
    const lines: string[] = []
    for (const span of tiling) this.render(span, now, lines)
    for (const item of this.items(end, count)) {
      const mark = opts.before?.(item.pos)
      if (mark) lines.push(mark)
      lines.push(itemLine(item, now, opts.cut ?? TAIL_CUT))
    }
    return { lines, tiling }
  }

  /** One node as lines: its summary, or its halves when it is not built yet, or its items as short lines. */
  render(span: Span, now: number, out: string[] = []): string[] {
    const node = this.node(span)
    if (node) out.push(nodeLine(span, node, now))
    else if (span.hi - span.lo <= this.shape.page) for (const item of this.items(span.lo, span.hi)) out.push(itemLine(item, now, PAGE_CUT))
    else {
      const mid = (span.lo + span.hi) / 2
      this.render({ lo: span.lo, hi: mid }, now, out)
      this.render({ lo: mid, hi: span.hi }, now, out)
    }
    return out
  }

  /** memo's `zoom`: a node opened into its two halves, or a page into its items. */
  zoom(span: Span, count: number, now: number): string[] {
    if (span.lo >= count) return []
    if (span.hi - span.lo <= this.shape.page) return this.items(span.lo, Math.min(span.hi, count)).map((i) => itemLine(i, now, ZOOM_CUT))
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

// ---------------------------------------------------------------- text

/** A verbatim item in a view is cut here; `zoom` shows more. */
const TAIL_CUT = 500
/** An item that stands in for a page not summarized yet. */
const PAGE_CUT = 160
const ZOOM_CUT = 4_000

const OUTSIDE = "[outside] "

export function itemLine(item: Item, now: number, cut: number): string {
  const text = oneLine(item.text, cut)
  return `#${item.pos} ${age(item.at, now)} ${item.tainted ? OUTSIDE : ""}${item.ref ? `${item.ref} ` : ""}${text}`
}

export function nodeLine(span: Span, node: Node, now: number): string {
  return `#${span.lo}-${span.hi - 1} ${range(node.from, node.to, now)} ${node.tainted ? OUTSIDE : ""}${node.text}`
}

export function oneLine(text: string, cut: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > cut ? `${flat.slice(0, cut)}…` : flat
}

/** How long ago, in the fewest characters: now, 5m, 3h, 2d, 3w, 4mo, 2y. */
export function age(at: number, now: number): string {
  const m = Math.max(0, now - at) / 60_000
  if (m < 1) return "now"
  if (m < 60) return `${Math.floor(m)}m`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h`
  const d = h / 24
  if (d < 14) return `${Math.floor(d)}d`
  if (d < 70) return `${Math.floor(d / 7)}w`
  if (d < 730) return `${Math.floor(d / 30)}mo`
  return `${Math.floor(d / 365)}y`
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/** A node's dates: `sep 20`, `sep 20–28`, `sep 20–oct 2`, with the year when it is not this year's. */
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

/** The system prompt of every summary call. */
export const NAP_SYSTEM =
  "you keep a long-term memory by compressing logs into single lines. you answer with exactly one line of plain lowercase text and nothing else."

/** memo's nap prompt, for a chat (`what: "turns"`) or a life (`what: "memories"`). */
export function napPrompt(input: NapInput, what: "turns" | "memories"): string {
  const { span } = input
  const body =
    "items" in input
      ? input.items.map((i) => `  #${i.pos} ${i.tainted ? OUTSIDE : ""}${oneLine(i.text, 1_200)}`).join("\n")
      : input.halves.map((h, n) => `  #${n === 0 ? span.lo : (span.lo + span.hi) / 2}-${n === 0 ? (span.lo + span.hi) / 2 - 1 : span.hi - 1} ${h.text}`).join("\n")
  return [
    `compress ${what} #${span.lo}-${span.hi - 1} into one line of at most ${LINE_BYTES} bytes.`,
    "keep what has lasting effect: facts about people, decisions, plans, results, open questions, who did what. drop small talk and greetings. invent nothing. name people and agents as they are named below.",
    "",
    body,
  ].join("\n")
}

/** The model's answer as one summary line: the first non-empty line, unquoted, at most `LINE_BYTES` bytes. Null when empty. */
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

/** At most `max` UTF-8 bytes, cut at a character, ending with `…` when cut. */
export function capBytes(text: string, max: number): string {
  if (encoder.encode(text).byteLength <= max) return text
  let out = ""
  for (const ch of text) {
    if (encoder.encode(`${out}${ch}…`).byteLength > max) break
    out += ch
  }
  return `${out}…`
}
