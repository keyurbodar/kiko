import type { AgentSlug, Sender } from "@kiko/protocol"
import { dayOf, region, type Item, itemLine, MAX_NAP_FAILS, type Node, napPrompt, type NapInput, oneLine, ROOM_SHAPE, type Span, spanOf, Tree, ZOOM_CUT } from "../lib/optmem"
import { searchMessages } from "./search"

// Architecture section 13. A room's log memory. The log is the room's own messages, read as turns:
// a human burst, one agent's whole reply with a line of what it did, one agent-to-agent message, or
// one system event. Bubbles are what the chat shows; turns are what memory counts, so a page of 8 is
// 8 things that happened, not half a reply. The turns are an index over `messages`, built lazily and
// only ever appended to, so a turn's position never changes.
//
// Every agent in the room reads the same view, so a teammate that joins late sees the whole past,
// compressed. Summaries are made in the background (`nap`), never while anyone waits.

/** A human's messages more than this apart are two turns. */
const HUMAN_GAP_MS = 30 * 60_000
/** At most this many past turns go into one quiet-chat rollup. */
const ROLLUP_MAX = 64
/** A rollup of a quiet chat needs at least this many new turns. */
const ROLLUP_MIN = 4
/** A level-3 node (8 pages, 64 turns) settling becomes one line of the user's life. */
const ROLLUP_SIZE = ROOM_SHAPE.page * 8
/** The most distinct acts a run's trace keeps. */
const TRACE_MAX = 6

const TILING = "mem_tiling"
const SYNCED = "mem_synced"
const EVENTS = "mem_events"
const ROLLED = "mem_rolled"

type TurnRow = { pos: number; key: string; first_seq: number | null; last_seq: number | null; at: number; at_last: number; trace: string | null }

/** What a nap needs from outside the room: one summary line, or when to try again. */
export type Compress = (prompt: string) => Promise<{ text: string } | { retryAt: number } | { error: string }>
/** A line for the user's life log. */
export type Rollup = (text: string, tainted: boolean, at: number) => Promise<void>

export class RoomMemory {
  readonly tree: Tree
  private readonly sql: SqlStorage

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly meta: { get(key: string): string | null; set(key: string, value: string): void },
  ) {
    this.sql = storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS mem_turns (
      pos INTEGER PRIMARY KEY,
      key TEXT NOT NULL,
      first_seq INTEGER,
      last_seq INTEGER,
      at INTEGER NOT NULL,
      at_last INTEGER NOT NULL,
      trace TEXT
    ) STRICT`)
    this.sql.exec("CREATE INDEX IF NOT EXISTS mem_turns_seq ON mem_turns (first_seq)")
    this.sql.exec("CREATE TABLE IF NOT EXISTS mem_did (slug TEXT NOT NULL, doing TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (slug, doing)) WITHOUT ROWID")
    this.tree = new Tree(this.sql, "mem_tree", ROOM_SHAPE, (lo, hi) => this.items(lo, hi))
  }

  /** How many turns the index has. `sync` first to include the newest messages. */
  count(): number {
    const n = this.sql.exec<{ n: number | null }>("SELECT max(pos) AS n FROM mem_turns").one().n
    return n === null ? 0 : n + 1
  }

  /**
   * Brings the turn index up to the log: new messages join the last turn or start one, and an edit or
   * delete of a message drops the summaries above its turn, to be built again without it. Cheap when
   * nothing changed. Returns the turn count.
   */
  sync(): number {
    return this.storage.transactionSync(() => {
      const synced = Number(this.meta.get(SYNCED) ?? 0)
      const rows = this.sql
        .exec<{ seq: number; at: number; sender: string; run_id: string | null; id: string }>("SELECT seq, at, sender, run_id, id FROM messages WHERE seq > ? ORDER BY seq LIMIT 5000", synced)
        .toArray()
      let last = this.sql.exec<TurnRow>("SELECT * FROM mem_turns ORDER BY pos DESC LIMIT 1").toArray()[0] ?? null
      for (const row of rows) {
        const key = turnKey(JSON.parse(row.sender) as Sender, row.run_id, row.id)
        const joins = last && last.key === key && last.last_seq !== null && (key !== "human" || row.at - last.at_last < HUMAN_GAP_MS)
        if (joins) {
          this.sql.exec("UPDATE mem_turns SET last_seq = ?, at_last = ? WHERE pos = ?", row.seq, row.at, last!.pos)
          last = { ...last!, last_seq: row.seq, at_last: row.at }
        } else {
          const pos = last ? last.pos + 1 : 0
          this.sql.exec("INSERT INTO mem_turns (pos, key, first_seq, last_seq, at, at_last) VALUES (?, ?, ?, ?, ?, ?)", pos, key, row.seq, row.seq, row.at, row.at)
          last = { pos, key, first_seq: row.seq, last_seq: row.seq, at: row.at, at_last: row.at, trace: null }
        }
      }
      if (rows.length) this.meta.set(SYNCED, String(rows[rows.length - 1]!.seq))
      this.forgetChanged()
      return this.count()
    })
  }

  /** Edits and deletes since the last sync drop the summaries above the turns they touched. */
  private forgetChanged(): void {
    const from = Number(this.meta.get(EVENTS) ?? 0)
    const events = this.sql
      .exec<{ seq: number; kind: string; payload: string }>("SELECT seq, kind, payload FROM events WHERE seq > ? AND kind IN ('edit', 'delete') ORDER BY seq", from)
      .toArray()
    const newest = this.sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM events").one().seq ?? 0
    for (const e of events) {
      const body = JSON.parse(e.payload) as { messageId?: string; messageIds?: string[] }
      for (const id of body.messageIds ?? (body.messageId ? [body.messageId] : [])) {
        const pos = this.posOfMessage(id)
        if (pos !== null) this.tree.forget(pos)
      }
    }
    if (newest > from) this.meta.set(EVENTS, String(newest))
  }

  private posOfMessage(id: string): number | null {
    return (
      this.sql
        .exec<{ pos: number }>("SELECT t.pos FROM messages m JOIN mem_turns t ON m.seq BETWEEN t.first_seq AND t.last_seq WHERE m.id = ?", id)
        .toArray()[0]?.pos ?? null
    )
  }

  /** The turns `[lo, hi)` as memory items, without the messages `skip` (by seq). A turn left empty is left out. */
  items(lo: number, hi: number, skip: ReadonlySet<number> = new Set()): Item[] {
    const rows = this.sql
      .exec<{ pos: number; at: number; trace: string | null; seq: number | null; id: string | null; sender: string | null; text: string | null; files: string | null; deleted_at: number | null; tainted: number | null; key: string }>(
        `SELECT t.pos, t.at, t.trace, t.key, m.seq, m.id, m.sender, m.text, m.files, m.deleted_at, m.tainted
         FROM mem_turns t LEFT JOIN messages m ON m.seq BETWEEN t.first_seq AND t.last_seq
         WHERE t.pos >= ? AND t.pos < ? ORDER BY t.pos, m.seq`,
        lo,
        hi,
      )
      .toArray()
    type Group = { item: Item; who: string; parts: string[]; shown: string[]; trace: string | null }
    const groups: Group[] = []
    for (const r of rows) {
      if (r.seq !== null && skip.has(r.seq)) continue
      let g = groups[groups.length - 1]
      if (g?.item.pos !== r.pos) {
        g = { item: { pos: r.pos, at: r.at, text: "", tainted: false }, who: whoOfKey(r.key), parts: [], shown: [], trace: r.trace }
        groups.push(g)
      }
      if (r.tainted) g.item.tainted = true
      if (!r.sender || r.text === null || r.deleted_at !== null) continue
      const from = JSON.parse(r.sender) as Sender
      g.who = who(from)
      const files = r.files ? ` (files: ${(JSON.parse(r.files) as { name: string }[]).map((f) => `/${f.name}`).join(", ")})` : ""
      g.parts.push(`${r.text}${files}`)
      // A human message keeps its id in a view, so `[react:..:id]` and `[reply:id]` can name it.
      g.shown.push(from.kind === "human" ? `[${r.id}] ${r.text}${files}` : `${r.text}${files}`)
    }
    return groups.map(({ item, who: name, parts, shown, trace }) => {
      const did = trace ? ` (did: ${trace})` : ""
      return { ...item, text: `${name}: ${parts.join(" / ") || "(deleted)"}${did}`, shown: `${name}: ${shown.join(" / ") || "(deleted)"}${did}` }
    })
  }

  /**
   * The room as an agent reads it at the start of a run: older turns compressed, the newest 40
   * verbatim. Turns made only of `skip` messages (the burst the run answers, which arrives on its
   * own) are left out. The tiling is kept, so the next view repeats the old lines exactly.
   */
  view(now: number, skip: ReadonlySet<number> = new Set()): string {
    const count = this.sync()
    const prev = this.meta.get(TILING)
    const { lines, tiling } = this.tree.view(count, prev ? (JSON.parse(prev) as Span[]) : null, now, (lo, hi) => this.items(lo, hi, skip))
    if (JSON.stringify(tiling) !== prev) this.meta.set(TILING, JSON.stringify(tiling))
    return lines.join("\n")
  }

  /** The turns after `pos`, as verbatim lines, without `slug`'s own turns and the messages `skip`. */
  since(slug: AgentSlug, pos: number, now: number, skip: ReadonlySet<number>): { text: string; count: number } {
    const count = this.sync()
    const own = new Set(
      this.sql
        .exec<{ pos: number }>("SELECT pos FROM mem_turns WHERE pos >= ? AND (key LIKE ? OR key LIKE ?)", pos, `agent:${slug}:%`, `trace:${slug}:%`)
        .toArray()
        .map((r) => r.pos),
    )
    let day = ""
    const lines: string[] = []
    for (const item of this.items(pos, count, skip)) {
      if (own.has(item.pos)) continue
      const d = dayOf(item.at, now)
      lines.push(itemLine(item, 300, d !== day))
      day = d
    }
    return { text: lines.join("\n"), count }
  }

  /** `zoom`: `t12` for one turn in full, or `12-19` / `0-63` for a node opened into its halves. */
  zoom(id: string, now: number): string | null {
    const count = this.sync()
    const one = /^t?(\d+)$/.exec(id)
    if (one) {
      const pos = Number(one[1])
      return pos < count ? this.items(pos, pos + 1).map((i) => itemLine(i, ZOOM_CUT)).join("\n") : null
    }
    const span = spanOf(id)
    if (!span) return null
    const lines = this.tree.zoom(span, count, now)
    return lines.length ? lines.join("\n") : null
  }

  /**
   * `recall` in this room: messages that match every word, newest first, each with its turn. When none
   * matches every word, the messages that match any of the longest words: "trip money" still finds
   * "the budget for the whole trip".
   */
  recall(query: string, now: number, limit = 10): string[] {
    this.sync()
    let hits = searchMessages(this.sql, query, { limit }).results
    if (!hits.length) {
      const words = [...new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2))].sort((a, b) => b.length - a.length).slice(0, 4)
      const seen = new Map<string, (typeof hits)[number]>()
      for (const w of words) for (const h of searchMessages(this.sql, w, { limit }).results) seen.set(h.id, h)
      hits = [...seen.values()].sort((a, b) => b.seq - a.seq).slice(0, limit)
    }
    return hits.map((hit) => {
      const pos = this.posOfMessage(hit.id)
      const text = hit.snippet.replace(/[\u0002\u0003]/g, "")
      return `${pos === null ? "" : `#${pos} `}${dayOf(hit.at, now)} ${who(hit.from)}: ${oneLine(text, 300)}`
    })
  }

  /** Something an agent did during its run, for the run's trace (section 7.12's board, kept). */
  did(slug: AgentSlug, doing: string, now: number): void {
    if (doing === "writing a reply") return
    this.sql.exec("INSERT OR IGNORE INTO mem_did (slug, doing, at) VALUES (?, ?, ?)", slug, doing.slice(0, 160), now)
  }

  /**
   * The run ended: what the agent did joins its reply turn as one line. A run that did things and said
   * nothing gets a turn of its own, so teammates and its own next run still see it.
   */
  trace(slug: AgentSlug, runId: string, now: number): void {
    const acts = this.sql.exec<{ doing: string }>("SELECT doing FROM mem_did WHERE slug = ? ORDER BY at LIMIT ?", slug, TRACE_MAX).toArray().map((r) => r.doing)
    this.sql.exec("DELETE FROM mem_did WHERE slug = ?", slug)
    if (!acts.length) return
    const count = this.sync()
    const trace = acts.join(", ")
    const reply = this.sql.exec<{ pos: number }>("SELECT pos FROM mem_turns WHERE key = ?", `agent:${slug}:${runId}`).toArray()[0]
    if (reply) {
      this.sql.exec("UPDATE mem_turns SET trace = ? WHERE pos = ?", trace, reply.pos)
      return
    }
    this.sql.exec("INSERT OR IGNORE INTO mem_turns (pos, key, first_seq, last_seq, at, at_last, trace) VALUES (?, ?, NULL, NULL, ?, ?, ?)", count, `trace:${slug}:${runId}`, now, now, trace)
  }

  /**
   * Summaries that are needed now: a page is summarized only once it leaves the verbatim floor, so a
   * chat shorter than the floor makes no summary calls at all, and a reply that is still growing is
   * never summarized half done.
   */
  pending(limit: number): Span[] {
    return this.tree.pending(region(this.sync(), ROOM_SHAPE), limit)
  }

  /**
   * One summary: reads the input, asks `compress`, stores the line. A settled 64-turn node also becomes
   * a line of the user's life (`rollup`), once. Returns when to try again after a refusal.
   */
  async nap(span: Span, compress: Compress, rollup: Rollup | null): Promise<{ retryAt?: number }> {
    const input = this.tree.input(span)
    if (!input) return {}
    const free = this.tree.free(input)
    const out = free !== null ? { text: free } : await compress(napPrompt(input, "turns"))
    if ("retryAt" in out) return { retryAt: out.retryAt }
    if ("error" in out && this.tree.failed(span) < MAX_NAP_FAILS) throw new Error(out.error)
    const node = this.tree.nodeFor(input, "text" in out ? out.text : this.tree.fallback(input))
    this.tree.put(span, node)
    if (rollup && span.hi - span.lo === ROLLUP_SIZE && span.lo >= Number(this.meta.get(ROLLED) ?? 0)) {
      await rollup(node.text, node.tainted, node.to)
      this.meta.set(ROLLED, String(span.hi))
    }
    return {}
  }

  /**
   * The chat went quiet: the turns since the last rollup become one line of the user's life, so a slow
   * chat reaches it without waiting for 64 turns. Returns false when there was too little.
   */
  async rollupQuiet(compress: Compress, rollup: Rollup): Promise<{ done: boolean; retryAt?: number }> {
    const count = this.sync()
    const rolled = Number(this.meta.get(ROLLED) ?? 0)
    if (count - rolled < ROLLUP_MIN) return { done: false }
    const lo = Math.max(rolled, count - ROLLUP_MAX)
    const input: NapInput = { span: { lo, hi: count }, items: this.items(lo, count) }
    const out = await compress(napPrompt(input, "turns"))
    if ("retryAt" in out) return { done: false, retryAt: out.retryAt }
    if ("error" in out) throw new Error(out.error)
    const items = input.items
    await rollup(out.text, items.some((i) => i.tainted), items[items.length - 1]?.at ?? Date.now())
    this.meta.set(ROLLED, String(count))
    return { done: true }
  }

  /** For tests and the CLI. */
  node(span: Span): Node | null {
    return this.tree.node(span)
  }
}

/** Which turn a message belongs to: a human's burst, one agent run, or one message on its own. */
function turnKey(from: Sender, runId: string | null, id: string): string {
  if (from.kind === "human") return "human"
  if (from.kind === "agent") return `agent:${from.slug}:${runId ?? id}`
  return `system:${id}`
}

function whoOfKey(key: string): string {
  if (key === "human") return "human"
  const [kind, slug] = key.split(":")
  return kind === "agent" || kind === "trace" ? `@${slug}` : "system"
}

function who(from: Sender): string {
  return from.kind === "human" ? "human" : from.kind === "agent" ? `@${from.slug}` : `system (${from.reason})`
}
