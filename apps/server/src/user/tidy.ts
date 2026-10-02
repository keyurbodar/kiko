import type { Chat, RoomId } from "@kiko/protocol"
import type { MemoryStore } from "./memory"
import { nextOccurrence } from "./recurrence"

// Architecture section 13.3. The daily memory tidy. Agents mostly read memory and save only clear,
// lasting facts. This job does most of the writing: it reads the human's recent messages and
// appends the lasting facts the agents missed, then merges duplicates, shortens records, moves
// traits into the profile, writes dated corrections, and archives stale records.
//
// DEVIATION: section 13.3 and the issue run the job in an `AgentDO` named `system:tidy`. It runs
// here instead, as two plain model completions with no tools. The model answers with JSON and this
// file applies it through the memory store, so the model can touch nothing but memory, `UserDO`
// still holds no harness, and the job needs no reserved room id.
//
// Safe to run twice. Every run ends by storing a fingerprint of memory and the chat list. A run
// whose fingerprint is unchanged calls no model and writes nothing, and an alarm delivered twice
// meets the fingerprint the first one stored. A rewrite is skipped when its record changed while
// the model was thinking.

export const TIDY_WAKEUP = "memory_tidy"
export const TIDY_AUTHOR = "tidy"
/** ASSUMPTION: the hour the job runs, in the user's timezone. */
const TIDY_RULE = "FREQ=DAILY;BYHOUR=3;BYMINUTE=0;BYSECOND=0"
/** Section 13.3 ASSUMPTION: a record unused this long is archived. */
export const STALE_MS = 90 * 86_400_000
/** The bounded window of chat the job reads. ASSUMPTION: the numbers. */
export const WINDOW_MS = 7 * 86_400_000
export const MAX_CHATS = 20
export const MAX_MESSAGES = 60
const MAX_CHAT_CHARS = 16_000
const MAX_RECORD_CHARS = 3_000
const SINGLETONS = new Set(["profile", "now", "todo"])
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

const STATE_KEY = "memory_tidy_state"
/** Set this settings key to "off" to turn the job off. */
export const OFF_KEY = "memory_tidy"

export type ChatLine = { at: number; text: string }

export type TidyReport = {
  ran: boolean
  skipped?: "off" | "unchanged" | "no provider" | "model error"
  appended: number
  rewritten: number
  merged: number
  corrected: number
  archived: number
}

export type TidyDeps = {
  sql: SqlStorage
  memory: MemoryStore
  now: () => number
  chats: () => Chat[]
  /** The human's messages in one chat after `since`, oldest first, at most `limit`. */
  readChat: (roomId: RoomId, since: number, limit: number) => Promise<ChatLine[]>
  /** One completion with the user's default model. Null when the user has no credential for it. */
  complete: (system: string, prompt: string) => Promise<string | null>
}

/** The next run: 03:00 in the user's timezone, after `after`. */
export function nextTidyAt(timezone: string, after: number): number {
  return nextOccurrence(TIDY_RULE, timezone, after)?.getTime() ?? after + 86_400_000
}

/** A tainted bullet came from a run that read outside content. The model never sees one. */
const isTainted = (line: string) => /\(([^()]*,\s*)?tainted\)\s*$/.test(line)

export function splitTainted(body: string): { clean: string; tainted: string[] } {
  const lines = body.split("\n")
  return { clean: lines.filter((l) => !isTainted(l)).join("\n").trim(), tainted: lines.filter(isTainted) }
}

/** Puts the tainted bullets back after a rewrite, so the job neither drops nor promotes them. */
const withTainted = (body: string, tainted: string[]) => [body.trim(), ...tainted].filter(Boolean).join("\n")

/** The first JSON object in a model answer, fenced or not. Null when there is none. */
export function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const today = (now: number) => new Date(now).toISOString().slice(0, 10)

const EXTRACT_SYSTEM = `you keep a person's long-term memory. read their recent chat messages and list only clear, lasting facts about them: who they are, people, places, preferences, plans, how they like to be answered. skip small talk, one-off requests, and anything already in memory.
answer with json only: {"facts":[{"id":"record-id","fact":"one short sentence"}]}
put traits of how they write and like to be answered under id "profile". use an existing record id when one fits, otherwise a short new lowercase id with dashes. answer {"facts":[]} when there is nothing new.`

const TIDY_SYSTEM = `you tidy a person's long-term memory. each record body is dated bullets like "- 2026-09-01: fact (author)".
- merge duplicate records: rewrite the one to keep with every distinct fact, and list the other in "merges".
- shorten bodies: drop incidental detail and repeated bullets, keep each bullet's date.
- when a later bullet says an earlier one is wrong, drop the wrong bullet from the body and add the right fact to "corrections".
- turn repeated examples and the person's communication style into short general traits in the profile.
- leave a record out of "records" when it needs no change. never invent facts.
answer with json only: {"records":[{"id":"...","body":"..."}],"merges":[{"from":"id","into":"id"}],"corrections":[{"id":"...","fact":"right fact, not the wrong one"}],"profile":"new profile body or null"}`

export class Tidy {
  #running: Promise<TidyReport> | null = null

  constructor(private readonly deps: TidyDeps) {}

  private setting(key: string): string | null {
    return this.deps.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value ?? null
  }

  private state(): { fingerprint: string; lastRunAt: number } | null {
    const raw = this.setting(STATE_KEY)
    return raw ? (JSON.parse(raw) as { fingerprint: string; lastRunAt: number }) : null
  }

  private save(fingerprint: string, lastRunAt: number): void {
    this.deps.sql.exec(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      STATE_KEY,
      JSON.stringify({ fingerprint, lastRunAt }),
    )
  }

  /** Changes to memory or to any chat since the last run. */
  fingerprint(): string {
    const m = this.deps.sql
      .exec<{ n: number; v: number; u: number }>(
        "SELECT count(*) AS n, coalesce(sum(version), 0) AS v, coalesce(max(updated_at), 0) AS u FROM memory_records",
      )
      .one()
    const c = this.deps.sql.exec<{ u: number }>("SELECT coalesce(max(updated_at), 0) AS u FROM chats").one()
    return `${m.n}:${m.v}:${m.u}:${c.u}`
  }

  /** One run at a time in this object. A second call while one runs gets the same report. */
  run(): Promise<TidyReport> {
    this.#running ??= this.#run().finally(() => {
      this.#running = null
    })
    return this.#running
  }

  async #run(): Promise<TidyReport> {
    const report: TidyReport = { ran: false, appended: 0, rewritten: 0, merged: 0, corrected: 0, archived: 0 }
    if (this.setting(OFF_KEY) === "off") return { ...report, skipped: "off" }
    const started = this.deps.now()
    report.archived = this.archiveStale(started)
    const before = this.state()
    if (before?.fingerprint === this.fingerprint()) {
      if (report.archived) this.save(this.fingerprint(), before.lastRunAt)
      return { ...report, skipped: "unchanged" }
    }

    const since = Math.max(before?.lastRunAt ?? 0, started - WINDOW_MS)
    const outcome = await this.extract(since, started, report)
    if (outcome) return { ...report, skipped: outcome }
    const tidied = await this.tidy(started, report)
    if (tidied) return { ...report, skipped: tidied }
    this.save(this.fingerprint(), started)
    return { ...report, ran: true }
  }

  /** Archives records that are not pinned and unused for `STALE_MS`. No model. */
  private archiveStale(now: number): number {
    const stale = this.deps.memory
      .list()
      .filter((r) => !r.pinned && !SINGLETONS.has(r.id) && Math.max(r.lastUsedAt, r.createdAt) < now - STALE_MS)
    for (const r of stale) this.deps.memory.archive(r.id, true)
    return stale.length
  }

  /** The human's messages since `since`, newest chats first, bounded in chats, lines, and characters. */
  private async transcript(since: number): Promise<string> {
    const chats = this.deps
      .chats()
      .filter((c) => c.updatedAt > since)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CHATS)
    const parts: string[] = []
    let size = 0
    for (const chat of chats) {
      const lines = await this.deps.readChat(chat.roomId, since, MAX_MESSAGES).catch(() => [])
      if (!lines.length) continue
      const text = `## ${chat.title}\n${lines.map((l) => `- ${l.text.replace(/\s+/g, " ").slice(0, 500)}`).join("\n")}`
      if (size + text.length > MAX_CHAT_CHARS) break
      parts.push(text)
      size += text.length
    }
    return parts.join("\n\n")
  }

  private async extract(since: number, now: number, report: TidyReport): Promise<TidyReport["skipped"] | null> {
    const transcript = await this.transcript(since)
    if (!transcript) return null
    const records = this.deps.memory.list().map((r) => `- ${r.id} (${r.type}): ${r.title}`)
    const known = norm(this.deps.memory.list(true).map((r) => r.body).join("\n"))
    const answer = await this.ask(EXTRACT_SYSTEM, `today is ${today(now)}.\n\nrecords:\n${records.join("\n")}\n\nmessages:\n${transcript}`)
    if (typeof answer === "string") return answer
    for (const f of list(answer.facts)) {
      const id = str(f.id)?.toLowerCase()
      const fact = str(f.fact)
      if (!id || !fact || !ID.test(id) || known.includes(norm(fact))) continue
      const existing = this.deps.memory.peek(id)
      if (existing?.archived) continue
      this.deps.memory.append(id, fact, { author: TIDY_AUTHOR })
      report.appended++
    }
    return null
  }

  private async tidy(now: number, report: TidyReport): Promise<TidyReport["skipped"] | null> {
    const records = this.deps.memory.list()
    const seen = new Map(records.map((r) => [r.id, { version: r.version, ...splitTainted(r.body), pinned: r.pinned }]))
    const shown = records.map((r) => {
      const { clean } = seen.get(r.id)!
      const body = clean.length > MAX_RECORD_CHARS ? `${clean.slice(0, MAX_RECORD_CHARS)}\n[cut]` : clean
      return `### ${r.id} (${r.type}${r.pinned ? ", pinned" : ""}): ${r.title}\n${body || "(empty)"}`
    })
    const answer = await this.ask(TIDY_SYSTEM, `today is ${today(now)}.\n\n${shown.join("\n\n")}`)
    if (typeof answer === "string") return answer

    // A rewrite applies only to a record the model saw whole and that nobody changed since.
    const current = (id: string) => {
      const was = seen.get(id)
      const row = this.deps.memory.peek(id)
      if (!was || !row || row.archived || row.version !== was.version || was.clean.length > MAX_RECORD_CHARS) return null
      return was
    }
    const rewrite = (id: string, body: string) => {
      const was = current(id)
      if (!was || norm(body) === norm(was.clean)) return
      this.deps.memory.replace(id, withTainted(body, was.tainted), TIDY_AUTHOR)
      report.rewritten++
    }
    for (const r of list(answer.records)) {
      const id = str(r.id)
      const body = typeof r.body === "string" ? r.body : null
      if (id && body !== null && id !== "profile") rewrite(id, body)
    }
    const profile = str(answer.profile)
    if (profile) rewrite("profile", profile)
    for (const m of list(answer.merges)) {
      const from = str(m.from)
      const into = str(m.into)
      const gone = from ? seen.get(from) : undefined
      if (!from || !into || from === into || SINGLETONS.has(from) || !gone || gone.pinned || !seen.has(into)) continue
      if (this.deps.memory.peek(from)?.archived) continue
      this.deps.memory.archive(from, true)
      report.merged++
    }
    for (const c of list(answer.corrections)) {
      const id = str(c.id)
      const fact = str(c.fact)
      const row = id ? this.deps.memory.peek(id) : null
      if (!id || !fact || !row || row.archived) continue
      const text = /^correction\b/i.test(fact) ? fact : `correction: ${fact}`
      if (norm(row.body).includes(norm(text))) continue
      this.deps.memory.append(id, text, { author: TIDY_AUTHOR })
      report.corrected++
    }
    return null
  }

  /** The model's JSON answer, or why there is none. */
  private async ask(system: string, prompt: string): Promise<Record<string, unknown> | "no provider" | "model error"> {
    let text: string | null
    try {
      text = await this.deps.complete(system, prompt)
    } catch (error) {
      console.error(`memory tidy failed: ${error instanceof Error ? error.name : "error"}`)
      return "model error"
    }
    if (text === null) return "no provider"
    return parseJson(text) ?? "model error"
  }
}

/** `POST /api/memory/tidy`: runs the job now for the session's user. */
export const TIDY_PATH = "/api/memory/tidy"
