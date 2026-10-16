import type { JsonObject } from "@earendil-works/pi-ai"
import type { Answer, Question } from "./judge"
import { keywords, norm } from "./life"
import { LINE_BYTES, type Step } from "./optmem"

const LOOP_KINDS = ["goal", "intention", "commitment", "waiting", "project"] as const
export type LoopKind = (typeof LOOP_KINDS)[number]
export type LoopStatus = "open" | "done" | "dropped" | "snoozed"
export type LoopSource = "tool" | "jev"

const isLoopKind = (value: unknown): value is LoopKind => LOOP_KINDS.includes(value as LoopKind)

export type Loop = {
  id: number
  kind: LoopKind
  owner: string
  room: string
  ref: string
  due: string | null
  status: LoopStatus
  text: string
  source: LoopSource
  openedAt: number
  lastSeen: number
  mentions: number
  closedAt: number | null
  snoozedUntil: number | null
}

export type NewLoop = {
  kind: LoopKind
  owner: string
  text: string
  source: LoopSource
  room?: string
  ref?: string
  due?: string | null
  at?: number
}

export type OpenResult = { ok: true; id: number; merged: boolean } | { ok: false; error: string }

type Row = {
  id: number
  kind: string
  owner: string
  room: string
  ref: string
  due: string | null
  status: string
  text: string
  source: string
  opened_at: number
  last_seen: number
  mentions: number
  closed_at: number | null
  snoozed_until: number | null
}

const LIVE = "status IN ('open', 'snoozed')"
export const SNOOZE_MAX_MS = 365 * 86_400_000
const encoder = new TextEncoder()

function cleanDue(due: string | null | undefined): string | null {
  const raw = due?.trim()
  if (!raw || Number.isNaN(Date.parse(raw))) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date(raw).toISOString()
}

function match(text: string): string | null {
  const words = keywords(text).slice(0, 12)
  return words.length ? words.map((w) => `"${w}"*`).join(" OR ") : null
}

// The open loops' table, its indexes, and its search table. Its object's schema list spreads these.
export const LOOPS_STEPS: Step[] = [
  `CREATE TABLE IF NOT EXISTS loops (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    certainty TEXT NOT NULL,
    owner TEXT NOT NULL,
    room TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL DEFAULT '',
    due TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    text TEXT NOT NULL,
    norm TEXT NOT NULL,
    source TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    mentions INTEGER NOT NULL DEFAULT 1,
    closed_at INTEGER,
    snoozed_until INTEGER
  )`,
  "CREATE INDEX IF NOT EXISTS loops_live ON loops (status, owner)",
  "CREATE INDEX IF NOT EXISTS loops_ref ON loops (ref)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS loops_fts USING fts5(text)",
]

export class Loops {
  constructor(
    private readonly sql: SqlStorage,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {}

  open(input: NewLoop, same?: number): OpenResult {
    const text = input.text.replace(/\s+/g, " ").trim()
    if (!text) return { ok: false, error: "empty. a loop is one line of text." }
    if (encoder.encode(text).byteLength > LINE_BYTES) return { ok: false, error: `too long: a loop is at most ${LINE_BYTES} bytes. say it shorter.` }
    if (!isLoopKind(input.kind)) return { ok: false, error: `kind is one of ${LOOP_KINDS.join(", ")}` }
    const owner = input.owner.replace(/^@/, "").trim() || "human"
    const at = input.at ?? Date.now()
    const due = cleanDue(input.due)
    const key = norm(text)
    return this.transaction(() => {
      const room = input.room ?? ""
      const old =
        (same !== undefined ? this.sql.exec<Row>(`SELECT * FROM loops WHERE id = ? AND owner = ? AND room = ? AND ${LIVE}`, same, owner, room).toArray()[0] : undefined) ??
        this.sql.exec<Row>(`SELECT * FROM loops WHERE norm = ? AND owner = ? AND room = ? AND ${LIVE}`, key, owner, room).toArray()[0]
      if (old) {
        this.sql.exec("UPDATE loops SET mentions = mentions + 1, last_seen = max(last_seen, ?), due = coalesce(?, due), status = 'open', snoozed_until = NULL WHERE id = ?", at, due, old.id)
        return { ok: true, id: old.id, merged: true } as const
      }
      if (input.source === "jev" && input.ref && owner !== "human") {
        const seen = this.sql.exec<{ id: number }>("SELECT id FROM loops WHERE ref = ? AND owner = ? AND room = ? LIMIT 1", input.ref, owner, room).toArray()[0]
        if (seen) return { ok: true, id: seen.id, merged: true } as const
      }
      this.sql.exec(
        "INSERT INTO loops (kind, certainty, owner, room, ref, due, text, norm, source, opened_at, last_seen) VALUES (?, 'explicit', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.kind,
        owner,
        room,
        input.ref ?? "",
        due,
        text,
        key,
        input.source,
        at,
        at,
      )
      const id = this.sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").one().id
      this.sql.exec("INSERT INTO loops_fts (rowid, text) VALUES (?, ?)", id, text)
      return { ok: true, id, merged: false } as const
    })
  }

  touch(id: number, at = Date.now()): boolean {
    return this.sql.exec(`UPDATE loops SET mentions = mentions + 1, last_seen = max(last_seen, ?) WHERE id = ? AND ${LIVE}`, at, id).rowsWritten > 0
  }

  close(id: number, status: "done" | "dropped", at = Date.now(), room?: string): boolean {
    return this.sql.exec(`UPDATE loops SET status = ?, closed_at = ?, snoozed_until = NULL WHERE id = ? AND (? IS NULL OR room = ?) AND ${LIVE}`, status, at, id, room ?? null, room ?? null).rowsWritten > 0
  }

  snooze(id: number, until: number, now = Date.now()): boolean {
    if (!Number.isFinite(until) || until <= now || until > now + SNOOZE_MAX_MS) return false
    return this.sql.exec(`UPDATE loops SET status = 'snoozed', snoozed_until = ? WHERE id = ? AND ${LIVE}`, until, id).rowsWritten > 0
  }

  get(id: number): Loop | null {
    const row = this.sql.exec<Row>("SELECT * FROM loops WHERE id = ?", id).toArray()[0]
    return row ? toLoop(row) : null
  }

  list(filter: { status?: readonly LoopStatus[]; owner?: string; room?: string; limit?: number } = {}): Loop[] {
    return this.sql
      .exec<Row>(
        "SELECT * FROM loops WHERE status IN (SELECT value FROM json_each(?)) AND (? IS NULL OR owner = ?) AND (? IS NULL OR room = ?) ORDER BY last_seen DESC, id DESC LIMIT ?",
        JSON.stringify(filter.status ?? ["open", "snoozed"]),
        filter.owner ?? null,
        filter.owner ?? null,
        filter.room ?? null,
        filter.room ?? null,
        Math.min(Math.max(filter.limit ?? 50, 1), 200),
      )
      .toArray()
      .map(toLoop)
  }

  similar(text: string, limit = 5, skip: readonly number[] = []): Loop[] {
    const words = match(text)
    if (!words) return []
    return this.sql
      .exec<Row>(
        `SELECT l.* FROM loops_fts f JOIN loops l ON l.id = f.rowid WHERE loops_fts MATCH ? AND l.status IN ('open', 'snoozed') AND l.id NOT IN (SELECT value FROM json_each(?)) ORDER BY bm25(loops_fts) LIMIT ?`,
        words,
        JSON.stringify(skip),
        limit,
      )
      .toArray()
      .map(toLoop)
  }

  /** Closes the open loops with no due date that nobody mentioned since `before`: a plan the human let go of. */
  expire(before: number, now = Date.now()): number {
    return this.sql.exec("UPDATE loops SET status = 'dropped', closed_at = ? WHERE status = 'open' AND due IS NULL AND last_seen < ?", now, before).rowsWritten
  }

  redactRefs(refs: readonly string[]): number {
    if (!refs.length) return 0
    return this.drop(this.sql.exec<{ id: number }>("SELECT id FROM loops WHERE ref IN (SELECT value FROM json_each(?))", JSON.stringify(refs)).toArray())
  }

  forgetRoom(room: string): number {
    return room ? this.drop(this.sql.exec<{ id: number }>("SELECT id FROM loops WHERE room = ?", room).toArray()) : 0
  }

  forgetTurn(room: string, pos: number): number {
    const prefix = `room:${room}:turns:`
    const rows = this.sql.exec<{ id: number; ref: string }>("SELECT id, ref FROM loops WHERE substr(ref, 1, ?) = ?", prefix.length, prefix).toArray()
    return this.drop(
      rows.filter((r) => {
        const m = /^(\d+)-(\d+)$/.exec(r.ref.slice(prefix.length))
        return m !== null && Number(m[1]) <= pos && pos < Number(m[2])
      }),
    )
  }

  private drop(rows: readonly { id: number }[]): number {
    if (!rows.length) return 0
    return this.transaction(() => {
      for (const r of rows) {
        this.sql.exec("DELETE FROM loops WHERE id = ?", r.id)
        this.sql.exec("DELETE FROM loops_fts WHERE rowid = ?", r.id)
      }
      return rows.length
    })
  }
}

function toLoop(r: Row): Loop {
  return {
    id: r.id,
    kind: r.kind as LoopKind,
    owner: r.owner,
    room: r.room,
    ref: r.ref,
    due: r.due,
    status: r.status as LoopStatus,
    text: r.text,
    source: r.source as LoopSource,
    openedAt: r.opened_at,
    lastSeen: r.last_seen,
    mentions: r.mentions,
    closedAt: r.closed_at,
    snoozedUntil: r.snoozed_until,
  }
}

export function loopLine(l: Loop): string {
  const meta = [l.kind, l.owner === "human" ? null : `owed by @${l.owner}`, l.due ? `due ${l.due}` : null].filter(Boolean).join(", ")
  return `L${l.id} [${meta}] ${l.text}`
}

const KIND: Record<LoopKind | "none", string> = {
  goal: "something the human wants to reach over weeks or months",
  intention: "something the human plans or has to do, often by a time",
  commitment: "a promise the human made to someone else",
  waiting: "the human waits on someone or something: an answer, a delivery, a decision",
  project: "a piece of work with several steps the human is running",
  none: "not a plan: a fact, a feeling, a question, small talk, a report that something is finished, or a request the agent can finish right away",
}

const WHEN = {
  none: "no day or time is named or implied",
  today: "it is to happen today, tonight, or right away",
  tomorrow: "it is to happen tomorrow",
  week: "it is to happen within the next few days or this week or next",
  month: "it is to happen within the next month or so",
}

const WHEN_DAYS = { today: 0, tomorrow: 1, week: 7, month: 30 } as const
type When = keyof typeof WHEN_DAYS

/** The date a loop is due, from when it was said and how soon the sentence puts it. */
export function dueAfter(when: When, at: number): string {
  return new Date(at + WHEN_DAYS[when] * 86_400_000).toISOString().slice(0, 10)
}

const PROMISE = {
  true: "the agent promises to come back, follow up, or deliver something at a later time",
  false: "the agent answers now, asks a question, or only offers without promising",
}

const RELATION = {
  done: "the sentence says this is finished or has happened",
  dropped: "the sentence says the human no longer wants or needs it followed up, or will handle it themselves",
  same: "the sentence is about this same plan or promise, and it is still open",
  other: "the sentence is about something else",
}

export type Sentence = { text: string; from: number; by?: string }
export type BurstCheck = { sentences: Sentence[]; near: { sentence: number; loop: Loop }[] }

const MIN_CHARS = 8
const MAX_SENTENCES = 6
const ANSWER_TAIL = 2

export function sentencesOf(messages: readonly { text: string; by?: string }[]): Sentence[] {
  const out: Sentence[] = []
  let human = 0
  for (const [from, { text, by }] of messages.entries()) {
    const lines = text
      .split(/\n+|(?<=[.!?])\s+/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= MIN_CHARS && encoder.encode(line).byteLength <= LINE_BYTES)
    if (by) {
      const tail = lines.slice(-ANSWER_TAIL).join(" ")
      const line = encoder.encode(tail).byteLength <= LINE_BYTES ? tail : lines.at(-1)
      if (line) out.push({ text: line, from, by })
      continue
    }
    for (const line of lines) {
      if (human === MAX_SENTENCES) break
      if (out.some((s) => s.text === line)) continue
      out.push({ text: line, from })
      human++
    }
  }
  return out
}

export function loopQuestions(check: BurstCheck): { state: JsonObject; questions: Record<string, Question> } {
  const questions: Record<string, Question> = {}
  check.sentences.forEach((sentence, i) => {
    const s = `\`sentences[${i}].text\``
    if (sentence.by) {
      questions[`s${i}_promise`] = { type: "bool", instructions: `In ${s}, said by the agent, does the agent promise to come back or follow up later?`, criteria: PROMISE }
      questions[`s${i}_when`] = { type: "choice", instructions: `When does ${s} say the agent will come back or deliver?`, criteria: WHEN }
      return
    }
    questions[`s${i}_kind`] = { type: "choice", instructions: `Is ${s} the human's own plan, goal, promise, or something they wait on? Which kind?`, criteria: KIND }
    questions[`s${i}_when`] = { type: "choice", instructions: `When does ${s} say it is to happen?`, criteria: WHEN }
  })
  for (const { sentence, loop } of check.near) {
    questions[`s${sentence}_l${loop.id}`] = {
      type: "choice",
      instructions: `How does \`sentences[${sentence}].text\` relate to this open item: ${JSON.stringify(loop.text)}?`,
      criteria: RELATION,
    }
  }
  return { state: { sentences: check.sentences.map((s) => ({ text: s.text, by: s.by ? "agent" : "human" })) }, questions }
}

export type LoopOp =
  | { op: "open"; sentence: number; kind: LoopKind; owner: string; when?: When; same?: number }
  | { op: "close"; sentence: number; id: number; status: "done" | "dropped" }

function decided(answer: Answer | undefined): string | null {
  if (answer?.type !== "choice") return null
  const p = answer.probabilities[answer.choice] ?? answer.confidence
  return p > 0.5 ? answer.choice : null
}

function loopKind(answer: Answer | undefined): LoopKind | null {
  if (answer?.type !== "choice") return null
  const p = (k: string) => answer.probabilities[k] ?? (answer.choice === k ? answer.confidence : 0)
  const best = [...LOOP_KINDS].sort((a, b) => p(b) - p(a))[0] ?? null
  return LOOP_KINDS.reduce((sum, k) => sum + p(k), 0) > 0.5 ? best : null
}

const yes = (answer: Answer | undefined) => answer?.type === "bool" && answer.probability > 0.5

export function loopOps(check: BurstCheck, answers: Record<string, Answer>): LoopOp[] {
  const ops: LoopOp[] = []
  check.sentences.forEach((sentence, i) => {
    let same: number | undefined
    let closed = false
    const near = check.near.filter((n) => n.sentence === i)
    const rels = near.map(({ loop }) => decided(answers[`s${i}_l${loop.id}`]))
    near.forEach(({ loop }, k) => {
      const rel = rels[k]
      if (rel === "done" || rel === "dropped") {
        ops.push({ op: "close", sentence: i, id: loop.id, status: rel })
        closed = true
      } else if (rel === "same" && same === undefined) same = loop.id
    })
    if (closed) return
    if (sentence.by && same === undefined && !rels.every((r) => r === "other")) same = near[0]?.loop.id
    const at = same === undefined ? {} : { same }
    const soon = decided(answers[`s${i}_when`])
    const when = soon && soon in WHEN_DAYS ? { when: soon as When } : {}
    if (sentence.by) {
      if (yes(answers[`s${i}_promise`])) ops.push({ op: "open", sentence: i, kind: "commitment", owner: sentence.by, ...when, ...at })
      return
    }
    const kind = loopKind(answers[`s${i}_kind`])
    if (!kind) return
    ops.push({ op: "open", sentence: i, kind, owner: "human", ...when, ...at })
  })
  return ops
}
