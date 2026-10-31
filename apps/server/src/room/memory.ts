import type { AgentSlug, Message, SearchHit, Sender } from "@kiko/protocol"
import { MemoryNapError } from "./errors"
import {
  dayOf,
  region,
  type Item,
  itemLine,
  nodeLine,
  MAX_NAP_FAILS,
  napPrompt,
  oneLine,
  ROOM_SHAPE,
  type Span,
  spanOf,
  Tree,
  ZOOM_CUT,
} from "@kiko/memory/optmem"
import { messageSeq, messageSeqs } from "./message-position"
import type { SearchOptions, SearchPage } from "./search"

const HUMAN_GAP_MS = 30 * 60_000
const RECALL_CUT = 300
const TRACE_MAX = 6
const NONE: ReadonlySet<number> = new Set()

const TILING = "mem_tiling"
const EVENTS = "mem_events"
const FORWARDED = "mem_forwarded"

type TurnRow = {
  pos: number
  key: string
  first_seq: number | null
  last_seq: number | null
  at: number
  at_last: number
  trace: string | null
}

export type Compress = (prompt: string) => Promise<{ text: string } | { retryAt: number } | { error: string }>

export type Changes = {
  upto: number
  deleted: string[]
  edited: { messageId: string; text: string; at: number }[]
  positions: number[]
}

export class RoomMemory {
  readonly tree: Tree
  private readonly sql: SqlStorage

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly roomId: string,
    private readonly meta: { get(key: string): string | null; set(key: string, value: string): void },
    private readonly search: (query: string, options: SearchOptions) => SearchPage,
  ) {
    this.sql = storage.sql
    this.tree = new Tree(this.sql, "memory_tree", ROOM_SHAPE, (lo, hi) => this.items(lo, hi), this.roomId)
  }

  private turns(): TurnRow[] {
    const turns = this.sql
      .exec<TurnRow>("SELECT * FROM mem_turns WHERE room_id = ? ORDER BY pos", this.roomId)
      .toArray()
    const synced = turns.reduce((seq, turn) => Math.max(seq, turn.last_seq ?? 0), 0)
    const rows = this.sql
      .exec<{ seq: number; at: number; sender: string; run_id: string | null; id: string }>(
        "SELECT seq, at, sender, run_id, id FROM messages WHERE room_id = ? AND seq > ? AND (event IS NULL OR json_extract(event, '$.private') IS NOT 1) ORDER BY seq",
        this.roomId,
        synced,
      )
      .toArray()
    for (const row of rows) {
      const key = turnKey(JSON.parse(row.sender) as Sender, row.run_id, row.id)
      const last = turns.at(-1)
      if (
        last &&
        last.key === key &&
        last.last_seq !== null &&
        (key !== "human" || row.at - last.at_last < HUMAN_GAP_MS)
      ) {
        last.last_seq = row.seq
        last.at_last = row.at
      } else
        turns.push({
          pos: turns.length,
          key,
          first_seq: row.seq,
          last_seq: row.seq,
          at: row.at,
          at_last: row.at,
          trace: null,
        })
    }
    return turns
  }

  count(): number {
    return this.turns().length
  }

  sync(): number {
    this.forgetChanged()
    return this.count()
  }

  capture(): void {
    this.storage.transactionSync(() => {
      const turns = this.turns()
      this.sql.exec(
        `INSERT INTO mem_turns (room_id, pos, key, first_seq, last_seq, at, at_last, trace)
         SELECT ?1, json_extract(value, '$.pos'), json_extract(value, '$.key'), json_extract(value, '$.first_seq'),
           json_extract(value, '$.last_seq'), json_extract(value, '$.at'), json_extract(value, '$.at_last'), json_extract(value, '$.trace')
         FROM json_each(?2) WHERE true
         ON CONFLICT(room_id, pos) DO UPDATE SET last_seq = excluded.last_seq, at_last = excluded.at_last
         WHERE mem_turns.last_seq IS NOT excluded.last_seq OR mem_turns.at_last IS NOT excluded.at_last`,
        this.roomId,
        JSON.stringify(turns),
      )
      this.forgetChanged()
    })
  }

  private forgetChanged(): void {
    const from = Number(this.meta.get(EVENTS) ?? 0)
    const events = this.sql
      .exec<{ seq: number; kind: string; payload: string }>(
        "SELECT seq, kind, payload FROM events WHERE (seq > ?1 AND kind IN ('edit', 'delete')) AND events.room_id = ?2 ORDER BY seq",
        from,
        this.roomId,
      )
      .toArray()
    const newest = events.at(-1)?.seq ?? from
    const turns = events.length ? this.turns() : []
    for (const e of events) {
      const body = JSON.parse(e.payload) as { messageId?: string; messageIds?: string[] }
      for (const id of body.messageIds ?? (body.messageId ? [body.messageId] : [])) {
        const pos = this.posOfMessage(id, turns)
        if (pos !== null) this.tree.forget(pos)
      }
    }
    if (newest > from) this.meta.set(EVENTS, String(newest))
  }

  changes(): Changes | null {
    this.sync()
    const from = Number(this.meta.get(FORWARDED) ?? 0)
    const events = this.sql
      .exec<{ seq: number; kind: string; payload: string }>(
        "SELECT seq, kind, payload FROM events WHERE (seq > ?1 AND kind IN ('edit', 'delete')) AND events.room_id = ?2 ORDER BY seq",
        from,
        this.roomId,
      )
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
    const turns = this.turns()
    for (const id of ids) {
      const pos = this.posOfMessage(id, turns)
      if (pos !== null) positions.add(pos)
    }
    const humanAt = new Map<string, number>()
    if (edited.size)
      for (const r of this.sql.exec<{ id: string; at: number; sender: string }>(
        "SELECT id, at, sender FROM messages WHERE seq IN (SELECT value FROM JSON_EACH(?1)) AND messages.room_id = ?2",
        messageSeqs(this.roomId, [...edited.keys()]),
        this.roomId,
      ))
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

  private posOfMessage(id: string, turns: readonly TurnRow[] = this.turns()): number | null {
    const seq = this.sql
      .exec<{ seq: number }>(
        "SELECT seq FROM messages WHERE seq = ?1 AND messages.room_id = ?2",
        messageSeq(this.roomId, id),
        this.roomId,
      )
      .toArray()[0]?.seq
    return seq === undefined ? null : this.posOfSeq(seq, turns)
  }

  private posOfSeq(seq: number, turns: readonly TurnRow[] = this.turns()): number | null {
    const turn = turns.findLast((turn) => turn.first_seq !== null && turn.first_seq <= seq)
    return turn && turn.last_seq !== null && seq <= turn.last_seq ? turn.pos : null
  }

  items(lo: number, hi: number, skip: ReadonlySet<number> = NONE, turns: readonly TurnRow[] = this.turns()): Item[] {
    const rows = this.sql
      .exec<{
        pos: number
        at: number
        trace: string | null
        seq: number | null
        id: string | null
        sender: string | null
        text: string | null
        files: string | null
        deleted_at: number | null
        key: string
      }>(
        `SELECT json_extract(t.value, '$.pos') AS pos, json_extract(t.value, '$.at') AS at,
          json_extract(t.value, '$.trace') AS trace, json_extract(t.value, '$.key') AS key,
          m.seq, m.id, m.sender, m.text, m.files, m.deleted_at
         FROM json_each(?1) AS t LEFT JOIN messages AS m
         ON m.room_id = ?2 AND m.seq BETWEEN json_extract(t.value, '$.first_seq') AND json_extract(t.value, '$.last_seq')
         AND (m.event IS NULL OR json_extract(m.event, '$.private') IS NOT 1)
         ORDER BY pos, m.seq`,
        JSON.stringify(turns.slice(lo, hi)),
        this.roomId,
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
      const files = r.files
        ? ` (files: ${(JSON.parse(r.files) as { name: string }[]).map((f) => `/${f.name}`).join(", ")})`
        : ""
      g.parts.push(`${r.text}${files}`)
      g.shown.push(from.kind === "human" ? `[${r.id}] ${r.text}${files}` : `${r.text}${files}`)
    }
    return groups.map(({ item, who: name, parts, shown, trace }) => {
      const did = trace ? ` (did: ${trace})` : ""
      return {
        ...item,
        text: `${name}: ${parts.join(" / ") || "(deleted)"}${did}`,
        shown: `${name}: ${shown.join(" / ") || "(deleted)"}${did}`,
      }
    })
  }

  view(now: number, skip: ReadonlySet<number> = NONE): string {
    const count = this.sync()
    const turns = this.turns()
    const prev = this.meta.get(TILING)
    const { lines, tiling } = this.tree.view(
      count,
      prev ? (JSON.parse(prev) as Span[]) : null,
      now,
      (lo, hi) => this.items(lo, hi, skip, turns),
      (lo, hi) => this.items(lo, hi, NONE, turns),
    )
    if (JSON.stringify(tiling) !== prev) this.meta.set(TILING, JSON.stringify(tiling))
    return lines.join("\n")
  }

  since(slug: AgentSlug, pos: number, now: number, skip: ReadonlySet<number>): { text: string; count: number } {
    const count = this.sync()
    const turns = this.turns()
    const own = new Set(
      turns
        .filter(
          (turn) => turn.pos >= pos && (turn.key.startsWith(`agent:${slug}:`) || turn.key.startsWith(`trace:${slug}:`)),
        )
        .map((turn) => turn.pos),
    )
    let day = ""
    const lines: string[] = []
    for (const item of this.items(pos, count, skip, turns)) {
      if (own.has(item.pos)) continue
      const d = dayOf(item.at, now)
      lines.push(itemLine(item, 300, d !== day, "chat", now))
      day = d
    }
    return { text: lines.join("\n"), count }
  }

  zoom(id: string, now: number): string | null {
    const count = this.sync()
    const turns = this.turns()
    const one = /^t?(\d+)$/.exec(id)
    if (one) {
      const pos = Number(one[1])
      return pos < count
        ? this.items(pos, pos + 1, NONE, turns)
            .map((i) => itemLine(i, ZOOM_CUT, true, "chat", now))
            .join("\n")
        : null
    }
    const span = spanOf(id)
    if (!span) return null
    const lines = this.tree.zoom(span, count, now, (lo, hi) => this.items(lo, hi, NONE, turns))
    return lines.length ? lines.join("\n") : null
  }

  async zoomArchived(
    id: string,
    load: (seq: number, before: number, after: number) => Promise<Message[]>,
    now: number,
  ): Promise<string | null> {
    const count = this.sync()
    const turns = this.turns()
    const one = /^t?(\d+)$/.exec(id)
    const span = one ? { lo: Number(one[1]), hi: Number(one[1]) + 1 } : spanOf(id)
    if (!span || span.lo >= count) return null
    const raw = async (lo: number, hi: number): Promise<string[]> => {
      const slice = turns.slice(lo, hi)
      const first = Math.min(...slice.flatMap((turn) => (turn.first_seq === null ? [] : [turn.first_seq])))
      const last = Math.max(...slice.flatMap((turn) => (turn.last_seq === null ? [] : [turn.last_seq])))
      const messages = Number.isFinite(first) && Number.isFinite(last) ? await load(first, 0, last - first + 1) : []
      return slice.map((turn) => {
        const parts = messages
          .filter(
            (message) =>
              turn.first_seq !== null &&
              turn.last_seq !== null &&
              message.seq >= turn.first_seq &&
              message.seq <= turn.last_seq &&
              !(message.event && "private" in message.event && message.event.private),
          )
          .map((message) => {
            const files = message.files?.length
              ? ` (files: ${message.files.map((file) => `/${file.name}`).join(", ")})`
              : ""
            return `${message.from.kind === "human" ? `[${message.id}] ` : ""}${message.text}${files}`
          })
        const did = turn.trace ? ` (did: ${turn.trace})` : ""
        return itemLine(
          { pos: turn.pos, at: turn.at, text: `${whoOfKey(turn.key)}: ${parts.join(" / ") || "(deleted)"}${did}` },
          ZOOM_CUT,
          true,
          "chat",
          now,
        )
      })
    }
    const zoom = async (part: Span): Promise<string[]> => {
      if (part.lo >= count) return []
      if (part.hi - part.lo <= ROOM_SHAPE.page) return raw(part.lo, Math.min(part.hi, count))
      const mid = (part.lo + part.hi) / 2
      const out: string[] = []
      for (const half of [
        { lo: part.lo, hi: mid },
        { lo: mid, hi: part.hi },
      ]) {
        if (half.lo >= count) continue
        const node = this.tree.node(half)
        out.push(...(node ? [nodeLine(half, node, now)] : await zoom(half)))
      }
      return out
    }
    const lines = await zoom(span)
    return lines.length ? lines.join("\n") : null
  }

  recall(query: string, now: number, limit = 10, seen?: number, skip: ReadonlySet<number> = new Set()): string[] {
    const fetch = seen === undefined && !skip.size ? limit : limit * 3
    let hits = this.search(query, { limit: fetch, mail: true }).results
    if (!hits.length) {
      const words = [
        ...new Set(
          query
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length > 2),
        ),
      ]
        .sort((a, b) => b.length - a.length)
        .slice(0, 4)
      const found = new Map<string, (typeof hits)[number]>()
      for (const w of words) for (const h of this.search(w, { limit: fetch, mail: true }).results) found.set(h.id, h)
      hits = [...found.values()].sort((a, b) => b.seq - a.seq).slice(0, fetch)
    }
    return this.recallHits(hits, now, limit, seen, skip)
  }

  recallHits(
    hits: SearchHit[],
    now: number,
    limit = 10,
    seen?: number,
    skip: ReadonlySet<number> = new Set(),
  ): string[] {
    this.capture()
    const lo = region(this.sync(), ROOM_SHAPE)
    const turns = this.turns()
    const poss = new Map(hits.map((h) => [h.id, this.posOfSeq(h.seq, turns)]))
    hits = hits
      .filter((h) => {
        if (skip.has(h.seq)) return false
        const pos = poss.get(h.id)
        return seen === undefined || pos === null || pos === undefined || pos < lo || pos >= seen
      })
      .slice(0, limit)
    const texts = new Map(
      this.sql
        .exec<{ id: string; text: string | null }>(
          "SELECT id, text FROM messages WHERE seq IN (SELECT value FROM JSON_EACH(?1)) AND messages.room_id = ?2",
          messageSeqs(
            this.roomId,
            hits.map((h) => h.id),
          ),
          this.roomId,
        )
        .toArray()
        .map((r) => [r.id, r.text ?? ""]),
    )
    return hits.map((hit) => {
      const pos = poss.get(hit.id) ?? null
      const text = oneLine(
        texts.get(hit.id) ?? hit.snippet.replaceAll("\u0002", "").replaceAll("\u0003", ""),
        RECALL_CUT,
      )
      const rest = text.endsWith("…") && pos !== null ? ` (cut, zoom chat:${pos})` : ""
      return `${pos === null ? "" : `#${pos} `}${dayOf(hit.at, now)} ${hit.from.kind === "human" ? "human" : hit.from.kind === "agent" ? `@${hit.from.slug}` : `system (${hit.from.reason})`}: ${text}${rest}`
    })
  }

  did(slug: AgentSlug, doing: string, now: number): void {
    if (doing === "writing a reply") return
    this.sql.exec(
      "INSERT OR IGNORE INTO mem_did (slug, doing, at, room_id) VALUES (?1, ?2, ?3, ?4)",
      slug,
      doing.slice(0, 160),
      now,
      this.roomId,
    )
  }

  trace(slug: AgentSlug, runId: string, now: number): void {
    const acts = this.sql
      .exec<{ doing: string }>(
        "SELECT doing FROM mem_did WHERE slug = ?1 AND mem_did.room_id = ?3 ORDER BY at LIMIT ?2",
        slug,
        TRACE_MAX,
        this.roomId,
      )
      .toArray()
      .map((r) => r.doing)
    this.sql.exec("DELETE FROM mem_did WHERE slug = ?1 AND mem_did.room_id = ?2", slug, this.roomId)
    if (!acts.length) return
    this.capture()
    const count = this.sync()
    const trace = acts.join(", ")
    const reply = this.sql
      .exec<{ pos: number }>(
        "SELECT pos FROM mem_turns WHERE key = ?1 AND mem_turns.room_id = ?2",
        `agent:${slug}:${runId}`,
        this.roomId,
      )
      .toArray()[0]
    if (reply) {
      this.sql.exec(
        "UPDATE mem_turns SET trace = ?1 WHERE pos = ?2 AND mem_turns.room_id = ?3",
        trace,
        reply.pos,
        this.roomId,
      )
      return
    }
    this.sql.exec(
      "INSERT OR IGNORE INTO mem_turns (pos, key, first_seq, last_seq, at, at_last, trace, room_id) VALUES (?1, ?2, NULL, NULL, ?3, ?4, ?5, ?6)",
      count,
      `trace:${slug}:${runId}`,
      now,
      now,
      trace,
      this.roomId,
    )
  }

  pending(limit: number): Span[] {
    return this.tree.pending(region(this.sync(), ROOM_SHAPE), limit)
  }

  async nap(span: Span, compress: Compress): Promise<{ retryAt?: number }> {
    this.capture()
    const input = this.tree.input(span)
    if (!input) return {}
    const free = this.tree.free(input)
    const out = free !== null ? { text: free } : await compress(napPrompt(input, "turns"))
    if ("retryAt" in out) return { retryAt: out.retryAt }
    if ("error" in out && this.tree.failed(span) < MAX_NAP_FAILS) throw new MemoryNapError({ message: out.error })
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
