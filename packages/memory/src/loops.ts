import type { JsonObject } from "@earendil-works/pi-ai"
import type { Answer, Question } from "./judge"
import { keywords, norm } from "./life"
import { LINE_BYTES } from "./optmem"

// Open loops: what the human means to do, what they wait on, and what an agent promised. One row per
// loop, next to the life log. Detection lives elsewhere and writes only through `open` and `close`.

const LOOP_KINDS = ["goal", "intention", "commitment", "waiting", "project"] as const
export type LoopKind = (typeof LOOP_KINDS)[number]
export type Certainty = "explicit" | "tentative"
export type LoopStatus = "open" | "done" | "dropped" | "snoozed"
/** Who saw it: a reminder an agent set for itself (`tool`), Jev after a burst, or the memory model's summary pass. */
export type LoopSource = "tool" | "jev" | "nap"

const isLoopKind = (value: unknown): value is LoopKind => LOOP_KINDS.includes(value as LoopKind)

export type Loop = {
  id: number
  kind: LoopKind
  certainty: Certainty
  /** "human", or the slug of the agent that promised it. */
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
  certainty: Certainty
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
  certainty: string
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

/** An ISO time, or null when `due` is missing or not a time. A bare date stays a date. */
function cleanDue(due: string | null | undefined): string | null {
  const raw = due?.trim()
  if (!raw || Number.isNaN(Date.parse(raw))) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date(raw).toISOString()
}

/** An FTS query for any of the text's keywords, or null when it has none. */
function match(text: string): string | null {
  const words = keywords(text).slice(0, 12)
  return words.length ? words.map((w) => `"${w}"*`).join(" OR ") : null
}

export class Loops {
  constructor(
    private readonly sql: SqlStorage,
    private readonly transaction: <T>(fn: () => T) => T,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS loops (
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
    )`)
    sql.exec("CREATE INDEX IF NOT EXISTS loops_live ON loops (status, owner)")
    sql.exec("CREATE INDEX IF NOT EXISTS loops_ref ON loops (ref)")
    sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS loops_fts USING fts5(text)")
  }

  /**
   * Opens a loop, or adds a mention to the same one: `same` when the caller judged it, else a live loop
   * with the same words. Both must have the same owner: one's promise never merges into another's plan.
   * A mention can firm a tentative loop up and give it a due time; it never makes an explicit loop
   * tentative, and the loop keeps its first words.
   */
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
      const old =
        (same !== undefined ? this.sql.exec<Row>(`SELECT * FROM loops WHERE id = ? AND owner = ? AND ${LIVE}`, same, owner).toArray()[0] : undefined) ??
        this.sql.exec<Row>(`SELECT * FROM loops WHERE norm = ? AND owner = ? AND ${LIVE}`, key, owner).toArray()[0]
      if (old) {
        const firmer = input.certainty === "explicit" && old.certainty === "tentative"
        this.sql.exec(
          "UPDATE loops SET mentions = mentions + 1, last_seen = max(last_seen, ?), certainty = ?, due = coalesce(?, due), status = 'open', snoozed_until = NULL WHERE id = ?",
          at,
          firmer ? "explicit" : old.certainty,
          due,
          old.id,
        )
        return { ok: true, id: old.id, merged: true } as const
      }
      // An agent's message is one promise: a later pass over the same message must not open it again once
      // the follow-up run has closed it. A human's message can hold several intentions, so it is exempt.
      if (input.source !== "tool" && input.ref && owner !== "human") {
        const seen = this.sql.exec<{ id: number }>("SELECT id FROM loops WHERE ref = ? AND owner = ? LIMIT 1", input.ref, owner).toArray()[0]
        if (seen) return { ok: true, id: seen.id, merged: true } as const
      }
      this.sql.exec(
        "INSERT INTO loops (kind, certainty, owner, room, ref, due, text, norm, source, opened_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        input.kind,
        input.certainty === "explicit" ? "explicit" : "tentative",
        owner,
        input.room ?? "",
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

  /** `room` limits the close to one chat's loops: an agent touches only the loops of its own chat. */
  close(id: number, status: "done" | "dropped", at = Date.now(), room?: string): boolean {
    return this.sql.exec(`UPDATE loops SET status = ?, closed_at = ?, snoozed_until = NULL WHERE id = ? AND (? IS NULL OR room = ?) AND ${LIVE}`, status, at, id, room ?? null, room ?? null).rowsWritten > 0
  }

  /** `until` must be after `now` and at most a year away. */
  snooze(id: number, until: number, now = Date.now()): boolean {
    if (!Number.isFinite(until) || until <= now || until > now + SNOOZE_MAX_MS) return false
    return this.sql.exec(`UPDATE loops SET status = 'snoozed', snoozed_until = ? WHERE id = ? AND ${LIVE}`, until, id).rowsWritten > 0
  }

  get(id: number): Loop | null {
    const row = this.sql.exec<Row>("SELECT * FROM loops WHERE id = ?", id).toArray()[0]
    return row ? toLoop(row) : null
  }

  /** Live loops by default, newest mention first. */
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

  /** Live loops that share words with `text`, best match first. */
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

  /** Every loop that could deserve attention at `now`: open ones, and snoozed ones whose time has come. */
  candidates(now = Date.now()): Loop[] {
    return this.sql
      .exec<Row>("SELECT * FROM loops WHERE status = 'open' OR (status = 'snoozed' AND snoozed_until <= ?) ORDER BY last_seen DESC LIMIT 200", now)
      .toArray()
      .map(toLoop)
  }

  /** Forgets every loop learned from one of `refs`, as the life log forgets a deleted message. */
  redactRefs(refs: readonly string[]): number {
    if (!refs.length) return 0
    return this.drop(this.sql.exec<{ id: number }>("SELECT id FROM loops WHERE ref IN (SELECT value FROM json_each(?))", JSON.stringify(refs)).toArray())
  }

  /** Forgets every loop of a chat that became private or was deleted. */
  forgetRoom(room: string): number {
    return room ? this.drop(this.sql.exec<{ id: number }>("SELECT id FROM loops WHERE room = ?", room).toArray()) : 0
  }

  /** Forgets the loops a summary pass learned from a page of turns that holds turn `pos` (ref `room:<id>:turns:<lo>-<hi>`). */
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
    certainty: r.certainty as Certainty,
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

/** One line for a model to read: `L3 [intention, explicit, due 2026-10-17] submit the grant report`. */
export function loopLine(l: Loop): string {
  const meta = [l.kind, l.certainty, l.owner === "human" ? null : `owed by @${l.owner}`, l.due ? `due ${l.due}` : null].filter(Boolean).join(", ")
  return `L${l.id} [${meta}] ${l.text}`
}

// ---------------------------------------------------------------------------------------------------
// Jev: one batched classification of a burst, and the agent's answers to it, against the open loops it may touch.

const KIND: Record<LoopKind | "none", string> = {
  goal: "something the human wants to reach over weeks or months",
  intention: "something the human plans or has to do, often by a time",
  commitment: "a promise the human made to someone else",
  waiting: "the human waits on someone or something: an answer, a delivery, a decision",
  project: "a piece of work with several steps the human is running",
  none: "not a plan: a fact, a feeling, a question, small talk, a report that something is finished, or a request the agent can finish right away",
}

const CERTAIN = {
  true: "the human commits to it: they will, must, or have to do it, or they name a day or time",
  false: "the human is only thinking about it: maybe, someday, would like to, an idea",
}

const PROMISE = {
  true: "the agent promises to come back, follow up, or deliver something at a later time",
  false: "the agent answers now, asks a question, or only offers without promising",
}

const RELATION = {
  done: "the sentence says this is finished or has happened",
  dropped: "the sentence says the human no longer wants or needs it",
  same: "the sentence is about this same plan or promise, and it is still open",
  other: "the sentence is about something else",
}

/** `from` is the index of the message a sentence came from, so its loop can name that message. `by` is the agent slug for an agent's answer. */
export type Sentence = { text: string; from: number; by?: string }
export type BurstCheck = { sentences: Sentence[]; near: { sentence: number; loop: Loop }[] }

const MIN_CHARS = 8
const MAX_SENTENCES = 6
/** An answer's promise to come back closes it, so only its last sentences are read, and an answer never crowds out the human. */
const ANSWER_TAIL = 2

/**
 * The sentences of a burst, each a possible loop: the human's first six, and the last two of each
 * agent answer (`by`) as one. No cue words: the judge decides what each one is.
 */
export function sentencesOf(messages: readonly { text: string; by?: string }[]): Sentence[] {
  const out: Sentence[] = []
  let human = 0
  for (const [from, { text, by }] of messages.entries()) {
    const lines = text
      .split(/\n+|(?<=[.!?])\s+/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter((line) => line.length >= MIN_CHARS && encoder.encode(line).byteLength <= LINE_BYTES)
    if (by) {
      // One unit, so a closing "enjoy your day" is read beside the promise before it, not as one.
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

/** The questions for one burst. Open loops go into the questions, not `state`, as capture does. */
export function loopQuestions(check: BurstCheck): { state: JsonObject; questions: Record<string, Question> } {
  const questions: Record<string, Question> = {}
  check.sentences.forEach((sentence, i) => {
    const s = `\`sentences[${i}].text\``
    if (sentence.by) {
      questions[`s${i}_promise`] = { type: "bool", instructions: `In ${s}, said by the agent, does the agent promise to come back or follow up later?`, criteria: PROMISE }
      return
    }
    questions[`s${i}_kind`] = { type: "choice", instructions: `Is ${s} the human's own plan, goal, promise, or something they wait on? Which kind?`, criteria: KIND }
    questions[`s${i}_certain`] = { type: "bool", instructions: `Does ${s} commit to it, rather than only think about it?`, criteria: CERTAIN }
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
  /** `owner` is the agent for its own promise. `same`: the loop it repeats. */
  | { op: "open"; sentence: number; kind: LoopKind; certainty: Certainty; owner: string; same?: number }
  | { op: "close"; sentence: number; id: number; status: "done" | "dropped" }

/** The winning choice, when it holds most of the probability. Below that the judge was unsure. */
function decided(answer: Answer | undefined): string | null {
  if (answer?.type !== "choice") return null
  const p = answer.probabilities[answer.choice] ?? answer.confidence
  return p > 0.5 ? answer.choice : null
}

/** A loop when most of the probability is on some kind, not `none`: "goal" and "intention" may split it. The likeliest kind wins. */
function loopKind(answer: Answer | undefined): LoopKind | null {
  if (answer?.type !== "choice") return null
  const p = (k: string) => answer.probabilities[k] ?? (answer.choice === k ? answer.confidence : 0)
  const best = [...LOOP_KINDS].sort((a, b) => p(b) - p(a))[0]!
  return LOOP_KINDS.reduce((sum, k) => sum + p(k), 0) > 0.5 ? best : null
}

const yes = (answer: Answer | undefined) => answer?.type === "bool" && answer.probability > 0.5

/** What the answers say to write. Pure, so a table of answers pins it. */
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
    // An agent's promise repeats its newest open one here unless Jev is sure it is another: an answer
    // that restates a promise it set a reminder for is the common case, and a duplicate is owed twice.
    if (sentence.by && same === undefined && near.length && !rels.every((r) => r === "other")) same = near[0]!.loop.id
    const at = same === undefined ? {} : { same }
    if (sentence.by) {
      if (yes(answers[`s${i}_promise`])) ops.push({ op: "open", sentence: i, kind: "commitment", certainty: "explicit", owner: sentence.by, ...at })
      return
    }
    const kind = loopKind(answers[`s${i}_kind`])
    if (!kind) return
    ops.push({ op: "open", sentence: i, kind, certainty: yes(answers[`s${i}_certain`]) ? "explicit" : "tentative", owner: "human", ...at })
  })
  return ops
}

// ---------------------------------------------------------------------------------------------------
// The memory model's summary pass: the same call that writes a page's summary line also lists loops.

export const NAP_LOOPS_SYSTEM =
  "you keep a long-term memory by compressing logs. the first line of your answer is one line of plain lowercase text. after it come only loop lines in the format you are given, or nothing."

const LOOP_LINE = /^loop\s+/i

/** The page prompt with the loop part. `known` are open loops the turns may touch. */
export function napLoopsPrompt(base: string, known: readonly Loop[], endsAt: number): string {
  return [
    base,
    "",
    "after that line, list the open loops in these turns, one per line, in these formats:",
    "loop + <kind> <explicit|tentative> <owner> <due> <text>",
    "loop done <id>",
    "loop dropped <id>",
    "kind is goal, intention (a plan or something they have to do), commitment (a promise to someone), waiting (on someone or something), or project.",
    "owner is human, or @name for an agent that promised to come back or follow up later.",
    "explicit when they commit or name a time; tentative for maybe, thinking about, someday.",
    "due is a date like 2026-10-17 when one is named or clear, else -. text is one short line in the third person.",
    "list every one, tentative ones too. skip only what the agent finished in these same turns, and an item already known below with the same owner and the same goal. a known loop the turns say is finished is loop done <id>; one no longer wanted is loop dropped <id>.",
    `the turns end on ${new Date(endsAt).toISOString().slice(0, 10)}.`,
    "known open loops:",
    ...(known.length ? known.map((l) => `${l.id}: ${l.text}`) : ["(none)"]),
  ].join("\n")
}

export type NapLoopOp =
  | { op: "open"; kind: LoopKind; certainty: Certainty; owner: string; due: string | null; text: string }
  | { op: "close"; id: number; status: "done" | "dropped" }

/** The summary line, and the loop lines after it. A malformed loop line, or one naming an unknown id, is dropped. */
export function parseNapLoops(answer: string, known: ReadonlySet<number>): { summary: string | null; ops: NapLoopOp[] } {
  const lines = answer.split("\n").map((l) => l.trim()).filter(Boolean)
  const summary = lines.find((l) => !LOOP_LINE.test(l)) ?? null
  const ops: NapLoopOp[] = []
  for (const line of lines) {
    if (!LOOP_LINE.test(line)) continue
    const words = line.split(/\s+/)
    const verb = words[1]?.toLowerCase()
    if (verb === "done" || verb === "dropped") {
      const id = Number(words[2]?.replace(/^l/i, ""))
      if (known.has(id)) ops.push({ op: "close", id, status: verb })
      continue
    }
    if (verb !== "+") continue
    const [, , kind, certainty, owner, due, ...rest] = words
    const text = rest.join(" ").trim()
    if (!isLoopKind(kind) || (certainty !== "explicit" && certainty !== "tentative") || !owner || text.length < 3) continue
    if (encoder.encode(text).byteLength > LINE_BYTES) continue
    ops.push({ op: "open", kind, certainty, owner: owner.replace(/^@/, "").toLowerCase(), due: due === "-" ? null : cleanDue(due), text })
  }
  return { summary, ops }
}
