import type { AgentSlug, Sender } from "@kiko/protocol"
import { dayOf, region, type Item, itemLine, MAX_NAP_FAILS, napPrompt, oneLine, ROOM_SHAPE, type Span, spanOf, Tree, ZOOM_CUT } from "@kiko/memory/optmem"
import { searchMessages } from "./search"

const HUMAN_GAP_MS = 30 * 60_000
const RECALL_CUT = 300
const TRACE_MAX = 6

const TILING = "mem_tiling"
const SYNCED = "mem_synced"
const EVENTS = "mem_events"
const FORWARDED = "mem_forwarded"

type TurnRow = { pos: number; key: string; first_seq: number | null; last_seq: number | null; at: number; at_last: number; trace: string | null }

export type Compress = (prompt: string) => Promise<{ text: string } | { retryAt: number } | { error: string }>

export type Changes = { upto: number; deleted: string[]; edited: { messageId: string; text: string; at: number }[]; positions: number[] }

export class RoomMemory {
  readonly tree: Tree
  private readonly sql: SqlStorage

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly meta: { get(key: string): string | null; set(key: string, value: string): void },
  ) {
    this.sql = storage.sql
    this.tree = new Tree(this.sql, "mem_tree", ROOM_SHAPE, (lo, hi) => this.items(lo, hi))
  }

  count(): number {
    const n = this.sql.exec<{ n: number | null }>("SELECT max(pos) AS n FROM mem_turns").one().n
    return n === null ? 0 : n + 1
  }

  sync(): number {
    return this.storage.transactionSync(() => {
      const synced = Number(this.meta.get(SYNCED) ?? 0)
      const rows = this.sql
        .exec<{ seq: number; at: number; sender: string; run_id: string | null; id: string }>("SELECT seq, at, sender, run_id, id FROM messages WHERE seq > ? AND (event IS NULL OR json_extract(event, '$.private') IS NOT 1) ORDER BY seq LIMIT 5000", synced)
        .toArray()
      let last = this.sql.exec<TurnRow>("SELECT * FROM mem_turns ORDER BY pos DESC LIMIT 1").toArray()[0] ?? null
      for (const row of rows) {
        const key = turnKey(JSON.parse(row.sender) as Sender, row.run_id, row.id)
        const joins = last && last.key === key && last.last_seq !== null && (key !== "human" || row.at - last.at_last < HUMAN_GAP_MS)
        if (last && joins) {
          this.sql.exec("UPDATE mem_turns SET last_seq = ?, at_last = ? WHERE pos = ?", row.seq, row.at, last.pos)
          last = { ...last, last_seq: row.seq, at_last: row.at }
        } else {
          const pos = last ? last.pos + 1 : 0
          this.sql.exec("INSERT INTO mem_turns (pos, key, first_seq, last_seq, at, at_last) VALUES (?, ?, ?, ?, ?, ?)", pos, key, row.seq, row.seq, row.at, row.at)
          last = { pos, key, first_seq: row.seq, last_seq: row.seq, at: row.at, at_last: row.at, trace: null }
        }
      }
      const tail = rows.at(-1)
      if (tail) this.meta.set(SYNCED, String(tail.seq))
      this.forgetChanged()
      return this.count()
    })
  }

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

  changes(): Changes | null {
    this.sync()
    const from = Number(this.meta.get(FORWARDED) ?? 0)
    const events = this.sql
      .exec<{ seq: number; kind: string; payload: string }>("SELECT seq, kind, payload FROM events WHERE seq > ? AND kind IN ('edit', 'delete') ORDER BY seq", from)
      .toArray()
    const tail = events.at(-1)
    if (!tail) return null
    const deleted = new Set<string>()
    const edited = new Map<string, string>()
    for (const e of events) {
      const body = JSON.parse(e.payload) as { messageId?: string; messageIds?: string[]; text?: string }
      if (e.kind === "edit" && body.messageId && body.text !== undefined) edited.set(body.messageId, body.text)
      else for (const id of body.messageIds ?? []) deleted.add(id)
    }
    const ids = [...new Set([...deleted, ...edited.keys()])]
    const positions = new Set<number>()
    for (const id of ids) {
      const pos = this.posOfMessage(id)
      if (pos !== null) positions.add(pos)
    }
    const humanAt = new Map<string, number>()
    if (edited.size)
      for (const r of this.sql.exec<{ id: string; at: number; sender: string }>("SELECT id, at, sender FROM messages WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify([...edited.keys()])))
        if ((JSON.parse(r.sender) as Sender).kind === "human") humanAt.set(r.id, r.at)
    return {
      upto: tail.seq,
      deleted: [...deleted],
      edited: [...edited].flatMap(([messageId, text]) => {
        const at = humanAt.get(messageId)
        return deleted.has(messageId) || at === undefined ? [] : [{ messageId, text, at }]
      }),
      positions: [...positions].sort((a, b) => a - b),
    }
  }

  forwarded(upto: number): void {
    this.meta.set(FORWARDED, String(upto))
  }

  // Turns cover disjoint seq ranges in pos order, so the turn for a seq is the last one that starts at or before it.
  // A join on BETWEEN read every turn for each lookup, and recall looks up each hit.
  private posOfMessage(id: string): number | null {
    const seq = this.sql.exec<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", id).toArray()[0]?.seq
    if (seq === undefined) return null
    const turn = this.sql
      .exec<{ pos: number; last_seq: number | null }>("SELECT pos, last_seq FROM mem_turns WHERE first_seq <= ? ORDER BY first_seq DESC LIMIT 1", seq)
      .toArray()[0]
    return turn && turn.last_seq !== null && seq <= turn.last_seq ? turn.pos : null
  }

  items(lo: number, hi: number, skip: ReadonlySet<number> = new Set()): Item[] {
    const rows = this.sql
      .exec<{ pos: number; at: number; trace: string | null; seq: number | null; id: string | null; sender: string | null; text: string | null; files: string | null; deleted_at: number | null; key: string }>(
        `SELECT t.pos, t.at, t.trace, t.key, m.seq, m.id, m.sender, m.text, m.files, m.deleted_at
         FROM mem_turns t LEFT JOIN messages m ON m.seq BETWEEN t.first_seq AND t.last_seq AND (m.event IS NULL OR json_extract(m.event, '$.private') IS NOT 1)
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
        g = { item: { pos: r.pos, at: r.at, text: "" }, who: whoOfKey(r.key), parts: [], shown: [], trace: r.trace }
        groups.push(g)
      }
      if (!r.sender || r.text === null || r.deleted_at !== null) continue
      const from = JSON.parse(r.sender) as Sender
      g.who = from.kind === "human" ? "human" : from.kind === "agent" ? `@${from.slug}` : `system (${from.reason})`
      const files = r.files ? ` (files: ${(JSON.parse(r.files) as { name: string }[]).map((f) => `/${f.name}`).join(", ")})` : ""
      g.parts.push(`${r.text}${files}`)
      g.shown.push(from.kind === "human" ? `[${r.id}] ${r.text}${files}` : `${r.text}${files}`)
    }
    return groups.map(({ item, who: name, parts, shown, trace }) => {
      const did = trace ? ` (did: ${trace})` : ""
      return { ...item, text: `${name}: ${parts.join(" / ") || "(deleted)"}${did}`, shown: `${name}: ${shown.join(" / ") || "(deleted)"}${did}` }
    })
  }

  view(now: number, skip: ReadonlySet<number> = new Set()): string {
    const count = this.sync()
    const prev = this.meta.get(TILING)
    const { lines, tiling } = this.tree.view(count, prev ? (JSON.parse(prev) as Span[]) : null, now, (lo, hi) => this.items(lo, hi, skip))
    if (JSON.stringify(tiling) !== prev) this.meta.set(TILING, JSON.stringify(tiling))
    return lines.join("\n")
  }

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

  recall(query: string, now: number, limit = 10, seen?: number, skip: ReadonlySet<number> = new Set()): string[] {
    const count = this.sync()
    const lo = region(count, ROOM_SHAPE)
    const fetch = seen === undefined && !skip.size ? limit : limit * 3
    let hits = searchMessages(this.sql, query, { limit: fetch, mail: true }).results
    if (!hits.length) {
      const words = [...new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2))].sort((a, b) => b.length - a.length).slice(0, 4)
      const found = new Map<string, (typeof hits)[number]>()
      for (const w of words) for (const h of searchMessages(this.sql, w, { limit: fetch, mail: true }).results) found.set(h.id, h)
      hits = [...found.values()].sort((a, b) => b.seq - a.seq).slice(0, fetch)
    }
    const poss = new Map(hits.map((h) => [h.id, this.posOfMessage(h.id)]))
    hits = hits
      .filter((h) => {
        if (skip.has(h.seq)) return false
        const pos = poss.get(h.id)
        return seen === undefined || pos === null || pos === undefined || pos < lo || pos >= seen
      })
      .slice(0, limit)
    const texts = new Map(
      this.sql
        .exec<{ id: string; text: string | null }>("SELECT id, text FROM messages WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(hits.map((h) => h.id)))
        .toArray()
        .map((r) => [r.id, r.text ?? ""]),
    )
    return hits.map((hit) => {
      const pos = poss.get(hit.id) ?? null
      const text = oneLine(texts.get(hit.id) ?? hit.snippet.replaceAll("\u0002", "").replaceAll("\u0003", ""), RECALL_CUT)
      const rest = text.endsWith("…") && pos !== null ? ` (cut, zoom chat:${pos})` : ""
      return `${pos === null ? "" : `#${pos} `}${dayOf(hit.at, now)} ${hit.from.kind === "human" ? "human" : hit.from.kind === "agent" ? `@${hit.from.slug}` : `system (${hit.from.reason})`}: ${text}${rest}`
    })
  }

  did(slug: AgentSlug, doing: string, now: number): void {
    if (doing === "writing a reply") return
    this.sql.exec("INSERT OR IGNORE INTO mem_did (slug, doing, at) VALUES (?, ?, ?)", slug, doing.slice(0, 160), now)
  }

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

  pending(limit: number): Span[] {
    return this.tree.pending(region(this.sync(), ROOM_SHAPE), limit)
  }

  async nap(span: Span, compress: Compress): Promise<{ retryAt?: number }> {
    const input = this.tree.input(span)
    if (!input) return {}
    const free = this.tree.free(input)
    const out = free !== null ? { text: free } : await compress(napPrompt(input, "turns"))
    if ("retryAt" in out) return { retryAt: out.retryAt }
    if ("error" in out && this.tree.failed(span) < MAX_NAP_FAILS) throw new Error(out.error)
    const node = this.tree.nodeFor(input, "text" in out ? out.text : this.tree.fallback(input))
    this.tree.put(span, node)
    return {}
  }
}

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

