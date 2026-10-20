import { plainText, type Message, type ReplyPreview, type SearchHit } from "@kiko/protocol"
import { snippetOf, type SearchOptions, type SearchPage } from "../room/search"

export const UTC_DAY = 86_400_000
export const HISTORY_ARCHIVE_STEPS = [
  `CREATE TABLE IF NOT EXISTS history_archive_state (
    room_id TEXT PRIMARY KEY, written_day TEXT, pending TEXT
  ) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS history_archive_pending (room_id TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(room_id, kind, n)) WITHOUT ROWID`,
] as const

export type ArchivedMessage = {
  id: string
  seq: number
  at: number
  message: Message | null
  fingerprint: string
  preview?: ReplyPreview
}

export type PendingArchive = { day: string; rows: ArchivedMessage[]; snapshot: ArchivedMessage[] }

export interface HistoryStore {
  state(): { writtenDay: string | null; pending: PendingArchive | null }
  oldestDay(before: number): string | null
  snapshot(day: string): ArchivedMessage[]
  prepare(pending: PendingArchive): void
  finish(pending: PendingArchive, writtenDay: string): void
  around(seq: number, before: number, after: number): Message[]
  search(query: string, options: SearchOptions): SearchPage
  overrides(ids: string[]): ArchivedMessage[]
  hydrate(row: ArchivedMessage): void
}

export interface HistoryArchiveIO {
  writeDay(roomId: string, day: string, rows: ArchivedMessage[]): Promise<void>
  readDay(roomId: string, day: string): Promise<ArchivedMessage[]>
  listDays(roomId: string): Promise<string[]>
  eraseRoom(roomId: string): Promise<void>
}

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10)
const ordered = (rows: ArchivedMessage[]) => rows.sort((a, b) => a.seq - b.seq)
const merge = (older: ArchivedMessage[], newer: ArchivedMessage[]) => ordered([...new Map([...older, ...newer].map((row) => [row.id, row])).values()])

export class HistoryArchive {
  private running?: Promise<void>
  private erased = false

  constructor(
    private readonly roomId: string,
    private readonly store: HistoryStore,
    private readonly archive?: HistoryArchiveIO,
    private readonly now: () => number = Date.now,
  ) {}

  private scanMessages(messages: Message[], cursor: number, deadline: number, results: SearchHit[], size: number, options: SearchOptions, seen: Set<string>, patterns: RegExp[], query: string): { cursor: number; page: SearchPage | null } {
    let scanned = 0
    for (const message of messages) {
      if (message.seq >= cursor) continue
      if (scanned > 0 && this.now() >= deadline) {
        results.sort((a, b) => b.seq - a.seq)
        const safe = results.filter((hit) => hit.seq >= cursor).slice(0, size)
        return { cursor, page: { results: safe, next: safe.length === size ? safe[size - 1]!.seq : cursor } }
      }
      scanned++
      cursor = message.seq
      if (message.at >= (options.beforeAt ?? Number.MAX_SAFE_INTEGER)) continue
      if (message.event && "private" in message.event && message.event.private || !options.mail && message.to) continue
      const text = message.rich ? plainText(message.rich) : message.text
      if (!seen.has(message.id) && patterns.every((pattern) => pattern.test(text))) {
        results.push({ id: message.id, seq: message.seq, at: message.at, from: message.from, snippet: snippetOf(text, query) })
        seen.add(message.id)
        results.sort((a, b) => b.seq - a.seq)
        if (results.length > size && cursor <= results[size - 1]!.seq) return { cursor, page: { results: results.slice(0, size), next: results[size - 1]!.seq } }
      }
    }
    return { cursor, page: null }
  }

  private finishAround(candidates: Map<string, Message>, previews: Map<string, ReplyPreview>, seq: number, before: number, after: number): Message[] {
    for (const row of this.store.overrides([...candidates.keys()])) {
      if (row.message) candidates.set(row.id, row.message)
      else candidates.delete(row.id)
    }
    for (const row of this.store.overrides([...candidates.values()].flatMap((m) => m.replyTo ? [m.replyTo] : []))) {
      if (row.preview) previews.set(row.id, row.preview)
    }
    const values = [...candidates.values()].sort((a, b) => a.seq - b.seq).map((message) => {
      const reply = message.replyTo ? previews.get(message.replyTo) : undefined
      return reply ? { ...message, reply } : message
    })
    return [...(before ? values.filter((m) => m.seq < seq).slice(-before) : []), ...values.filter((m) => m.seq >= seq).slice(0, after)]
  }

  afterRun(): Promise<void> {
    if (!this.archive || this.erased) return Promise.resolve()
    return this.running ??= this.moveDay().finally(() => { this.running = undefined })
  }

  private async moveDay(): Promise<void> {
    const archive = this.archive
    if (!archive) return
    const today = dayOf(this.now())
    const state = this.store.state()
    if (state.writtenDay === today && !state.pending) return
    let pending = state.pending
    let existing: ArchivedMessage[]
    if (!pending) {
      const day = this.store.oldestDay(Date.parse(today) - 30 * UTC_DAY)
      if (!day) return
      const snapshot = this.store.snapshot(day)
      if (!snapshot.length) return
      existing = await archive.readDay(this.roomId, day)
      pending = { day, rows: merge(existing, snapshot), snapshot }
      this.store.prepare(pending)
    } else existing = await archive.readDay(this.roomId, pending.day)
    const same = existing.length === pending.rows.length && existing.every((row, index) => {
      const next = pending.rows[index]!
      return row.id === next.id && row.fingerprint === next.fingerprint && JSON.stringify(row.preview) === JSON.stringify(next.preview)
    })
    if (!same) await archive.writeDay(this.roomId, pending.day, pending.rows)
    this.store.finish(pending, dayOf(this.now()))
  }

  async erase(): Promise<void> {
    this.erased = true
    await this.running?.catch(() => {})
    await this.archive?.eraseRoom(this.roomId)
  }

  private async archived(id: string): Promise<ArchivedMessage | undefined> {
    if (!this.archive || this.erased) return undefined
    for (const day of await this.archive.listDays(this.roomId)) {
      const row = (await this.archive.readDay(this.roomId, day)).find((row) => row.id === id)
      if (row) return row
    }
    return undefined
  }

  async hydrate(id: string): Promise<boolean> {
    const hot = this.store.overrides([id])[0]
    if (hot) return hot.message !== null
    const row = await this.archived(id)
    if (!row || this.erased) return false
    this.store.hydrate(row)
    return this.store.overrides([id])[0]?.message != null
  }

  async mutate<T>(id: string, apply: () => T): Promise<T> {
    if (this.erased) throw new Error("Chat deleted")
    if (!this.store.overrides([id]).length) {
      const row = await this.archived(id)
      if (row && !this.erased) this.store.hydrate(row)
    }
    if (this.erased) throw new Error("Chat deleted")
    return apply()
  }

  private current(rows: ArchivedMessage[]): Message[] {
    const combined = merge(rows, this.store.overrides(rows.map((row) => row.id)))
    return combined.flatMap((row) => row.message ? [row.message] : [])
  }

  async around(seq: number, before: number, after: number): Promise<Message[]> {
    const hot = this.store.around(seq, before, after)
    const complete = hot.filter((m) => m.seq < seq).length === before && hot.filter((m) => m.seq >= seq).length === after
    const recent = hot.every((message) => message.at >= Date.parse(dayOf(this.now())) - 30 * UTC_DAY)
    const anchored = after === 0 || hot.some((message) => message.seq <= seq)
    if (!this.archive || this.erased || before === 0 && after === 0 || complete && recent && anchored && hot.every((m) => !m.replyTo || m.reply)) return hot
    const candidates = new Map<string, Message>(hot.map((message) => [message.id, message]))
    const previews = new Map<string, ReplyPreview>()
    for (const day of await this.archive.listDays(this.roomId)) {
      const rows = await this.archive.readDay(this.roomId, day)
      for (const row of merge(rows, this.store.overrides(rows.map((row) => row.id)))) {
        if (row.preview) previews.set(row.id, row.preview)
        if (row.message) candidates.set(row.message.id, row.message)
      }
      const values = [...candidates.values()].sort((a, b) => a.seq - b.seq)
      const older = before ? values.filter((m) => m.seq < seq).slice(-before) : []
      const newer = values.filter((m) => m.seq >= seq).slice(0, after)
      const selected = [...older, ...newer]
      candidates.clear()
      for (const message of selected) candidates.set(message.id, message)
      const needed = new Set(selected.flatMap((message) => message.replyTo ? [message.replyTo as string] : []))
      for (const id of previews.keys()) if (!needed.has(id)) previews.delete(id)
      const floor = Math.min(seq, older[0]?.seq ?? seq)
      if (older.length === before && newer.length === after && rows.some((row) => row.seq <= floor) && [...older, ...newer].every((m) => !m.replyTo || m.reply || previews.has(m.replyTo))) break
    }
    return this.finishAround(candidates, previews, seq, before, after)
  }

  async search(query: string, options: SearchOptions = {}, budgetMs = 40): Promise<SearchPage> {
    const size = Math.min(Math.max(options.limit || 20, 1), 50)
    const hot = this.store.search(query, { ...options, limit: size })
    const recent = hot.results.every((hit) => hit.at >= Date.parse(dayOf(this.now())) - 30 * UTC_DAY)
    if (!this.archive || this.erased || hot.next !== null && recent) return hot
    const words = query.replaceAll('"', "").trim().split(/\s+/).filter(Boolean).slice(0, 12)
    if (!words.length) return hot
    const literal = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const patterns = words.map((word, i) => new RegExp(`(?<![\\p{L}\\p{N}])${literal(word)}${i === words.length - 1 ? "" : "(?![\\p{L}\\p{N}])"}`, "iu"))
    const results: SearchHit[] = [...hot.results]
    const seen = new Set(results.map((hit) => hit.id))
    const deadline = this.now() + budgetMs
    let cursor = options.before ?? Number.MAX_SAFE_INTEGER
    const days = await this.archive.listDays(this.roomId)
    for (let index = 0; index < days.length; index++) {
      const day = days[index]!
      const rows = await this.archive.readDay(this.roomId, day)
      const messages = this.current(rows).sort((a, b) => b.seq - a.seq)
      const scanned = this.scanMessages(messages, cursor, deadline, results, size, options, seen, patterns, query)
      if (scanned.page) return scanned.page
      cursor = scanned.cursor
      cursor = Math.min(cursor, ...rows.map((row) => row.seq))
      results.sort((a, b) => b.seq - a.seq)
      if (results.length > size && cursor <= results[size - 1]!.seq) return { results: results.slice(0, size), next: results[size - 1]!.seq }
      if (index < days.length - 1 && this.now() >= deadline) {
        const safe = results.filter((hit) => hit.seq >= cursor).slice(0, size)
        return { results: safe, next: safe.length === size ? safe[size - 1]!.seq : cursor }
      }
    }
    results.sort((a, b) => b.seq - a.seq)
    return { results: results.slice(0, size), next: results.length > size || hot.next !== null ? results[size - 1]!.seq : null }
  }
}
