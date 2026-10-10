import type { JsonObject } from "@earendil-works/pi-ai"
import type { Answer, Question } from "./judge"
import { keywords, norm } from "./life"
import { LINE_BYTES } from "./optmem"

// Open loops: what the human means to do, what they wait on, and what an agent promised. One row per
// loop, next to the life log. Detection lives elsewhere and writes only through `open` and `close`.

export const LOOP_KINDS = ["goal", "intention", "commitment", "waiting", "project"] as const
export type LoopKind = (typeof LOOP_KINDS)[number]
export type Certainty = "explicit" | "tentative"
export type LoopStatus = "open" | "done" | "dropped" | "snoozed"
/** Who saw it: the agent's `loop` tool, Jev on the human's burst, or the memory model's summary pass. */
export type LoopSource = "tool" | "jev" | "nap"

export const isLoopKind = (value: unknown): value is LoopKind => LOOP_KINDS.includes(value as LoopKind)

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
  surfaced: number
  ignored: number
  tainted: boolean
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
  tainted?: boolean
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
  surfaced: number
  ignored: number
  tainted: number
  closed_at: number | null
  snoozed_until: number | null
}

const LIVE = "status IN ('open', 'snoozed')"
const encoder = new TextEncoder()

/** An ISO time, or null when `due` is missing or not a time. A bare date stays a date. */
export function cleanDue(due: string | null | undefined): string | null {
  const raw = due?.trim()
  if (!raw || Number.isNaN(Date.parse(raw))) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date(raw).toISOString()
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
      surfaced INTEGER NOT NULL DEFAULT 0,
      ignored INTEGER NOT NULL DEFAULT 0,
      tainted INTEGER NOT NULL DEFAULT 0,
      closed_at INTEGER,
      snoozed_until INTEGER
    )`)
    sql.exec("CREATE INDEX IF NOT EXISTS loops_live ON loops (status, owner)")
    sql.exec("CREATE INDEX IF NOT EXISTS loops_ref ON loops (ref)")
    sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS loops_fts USING fts5(text)")
  }

  /**
   * Opens a loop, or adds a mention to the same one: `same` when the caller judged it, else a live loop
   * with the same words. Either must have the same owner: one's promise never merges into another's
   * plan. A mention can firm a tentative loop up and give it a due time; it never makes an explicit
   * loop tentative, and the loop keeps its first words.
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
        (same === undefined ? undefined : this.sql.exec<Row>(`SELECT * FROM loops WHERE id = ? AND owner = ? AND ${LIVE}`, same, owner).toArray()[0]) ??
        this.sql.exec<Row>(`SELECT * FROM loops WHERE norm = ? AND owner = ? AND ${LIVE}`, key, owner).toArray()[0] ??
        // One message answered with one promise, kept two ways (a loop and a reminder), is one commitment.
        (input.kind === "commitment" && input.ref
          ? this.sql.exec<Row>(`SELECT * FROM loops WHERE kind = 'commitment' AND owner = ? AND ref = ? AND ${LIVE}`, owner, input.ref).toArray()[0]
          : undefined)
      if (old) {
        const firmer = input.certainty === "explicit" && old.certainty === "tentative"
        this.sql.exec(
          "UPDATE loops SET mentions = mentions + 1, last_seen = max(last_seen, ?), certainty = ?, due = coalesce(?, due), status = 'open', snoozed_until = NULL, tainted = ? WHERE id = ?",
          at,
          firmer ? "explicit" : old.certainty,
          due,
          old.tainted && input.tainted ? 1 : 0,
          old.id,
        )
        return { ok: true, id: old.id, merged: true } as const
      }
      this.sql.exec(
        "INSERT INTO loops (kind, certainty, owner, room, ref, due, text, norm, source, opened_at, last_seen, tainted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
        input.tainted ? 1 : 0,
      )
      const id = this.sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").one().id
      this.sql.exec("INSERT INTO loops_fts (rowid, text) VALUES (?, ?)", id, text)
      return { ok: true, id, merged: false } as const
    })
  }

  touch(id: number, at = Date.now()): boolean {
    return this.sql.exec(`UPDATE loops SET mentions = mentions + 1, last_seen = max(last_seen, ?) WHERE id = ? AND ${LIVE}`, at, id).rowsWritten > 0
  }

  close(id: number, status: "done" | "dropped", at = Date.now()): boolean {
    return this.sql.exec(`UPDATE loops SET status = ?, closed_at = ?, snoozed_until = NULL WHERE id = ? AND ${LIVE}`, status, at, id).rowsWritten > 0
  }

  snooze(id: number, until: number): boolean {
    return this.sql.exec(`UPDATE loops SET status = 'snoozed', snoozed_until = ? WHERE id = ? AND ${LIVE}`, until, id).rowsWritten > 0
  }

  /** The next wave's attention pass reports what it raised and what the human let pass. */
  surfaced(id: number): void {
    this.sql.exec("UPDATE loops SET surfaced = surfaced + 1 WHERE id = ?", id)
  }

  ignored(id: number): void {
    this.sql.exec("UPDATE loops SET ignored = ignored + 1 WHERE id = ?", id)
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
    const words = keywords(text).slice(0, 12)
    if (!words.length) return []
    return this.sql
      .exec<Row>(
        `SELECT l.* FROM loops_fts f JOIN loops l ON l.id = f.rowid WHERE loops_fts MATCH ? AND l.status IN ('open', 'snoozed') AND l.id NOT IN (SELECT value FROM json_each(?)) ORDER BY bm25(loops_fts) LIMIT ?`,
        words.map((w) => `"${w}"*`).join(" OR "),
        JSON.stringify(skip),
        limit,
      )
      .toArray()
      .map(toLoop)
  }

  /**
   * Every loop that could deserve attention at `now`: open ones, and snoozed ones whose time has come.
   * The attention pass (next wave) ranks these. It decides; this only gathers.
   */
  candidates(now = Date.now()): Loop[] {
    return this.sql
      .exec<Row>("SELECT * FROM loops WHERE status = 'open' OR (status = 'snoozed' AND snoozed_until <= ?) ORDER BY last_seen DESC LIMIT 200", now)
      .toArray()
      .map(toLoop)
  }

  /** Forgets every loop learned from one of `refs`, as the life log forgets a deleted message. */
  redactRefs(refs: readonly string[]): number {
    if (!refs.length) return 0
    return this.transaction(() => {
      const gone = this.sql.exec<{ id: number }>("SELECT id FROM loops WHERE ref IN (SELECT value FROM json_each(?))", JSON.stringify(refs)).toArray()
      for (const r of gone) {
        this.sql.exec("DELETE FROM loops WHERE id = ?", r.id)
        this.sql.exec("DELETE FROM loops_fts WHERE rowid = ?", r.id)
      }
      return gone.length
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
    surfaced: r.surfaced,
    ignored: r.ignored,
    tainted: r.tainted === 1,
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
// Jev: one batched classification of a human burst against the open loops it may touch.

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

const RELATION = {
  done: "the sentence says this is finished or has happened",
  dropped: "the sentence says the human no longer wants or needs it",
  same: "the sentence is about this same plan, and it is still open",
  other: "the sentence is about something else",
}

/** `from` is the index of the message a sentence came from, so its loop can name that message. */
export type Sentence = { text: string; from: number }
export type BurstCheck = { sentences: Sentence[]; near: { sentence: number; loop: Loop }[] }

const MIN_CHARS = 8
const MAX_SENTENCES = 6

/** The sentences of a burst, each a possible loop. No cue words: the judge decides what each one is. */
export function sentencesOf(texts: readonly string[]): Sentence[] {
  const out: Sentence[] = []
  for (const [from, text] of texts.entries()) {
    for (const part of text.split(/\n+|(?<=[.!?])\s+/)) {
      const line = part.replace(/\s+/g, " ").trim()
      if (line.length < MIN_CHARS || encoder.encode(line).byteLength > LINE_BYTES || out.some((s) => s.text === line)) continue
      out.push({ text: line, from })
      if (out.length === MAX_SENTENCES) return out
    }
  }
  return out
}

/** The questions for one burst. Open loops go into the questions, not `state`, as capture does. */
export function loopQuestions(check: BurstCheck): { state: JsonObject; questions: Record<string, Question> } {
  const questions: Record<string, Question> = {}
  check.sentences.forEach((_, i) => {
    const s = `\`sentences[${i}].text\``
    questions[`s${i}_kind`] = { type: "choice", instructions: `Is ${s} the human's own plan, goal, promise, or something they wait on? Which kind?`, criteria: KIND }
    questions[`s${i}_certain`] = { type: "bool", instructions: `Does ${s} commit to it, rather than only think about it?`, criteria: CERTAIN }
  })
  for (const { sentence, loop } of check.near) {
    questions[`s${sentence}_l${loop.id}`] = {
      type: "choice",
      instructions: `How does \`sentences[${sentence}].text\` relate to this open item the human had: ${JSON.stringify(loop.text)}?`,
      criteria: RELATION,
    }
  }
  return { state: { sentences: check.sentences.map((s) => ({ text: s.text })) }, questions }
}

export type LoopOp =
  | { op: "open"; sentence: number; kind: LoopKind; certainty: Certainty; same?: number }
  | { op: "close"; sentence: number; id: number; status: "done" | "dropped" }

/** The winning choice, when it holds most of the probability. Below that the judge was unsure. */
function decided(answer: Answer | undefined): string | null {
  if (answer?.type !== "choice") return null
  const p = answer.probabilities[answer.choice] ?? answer.confidence
  return p > 0.5 ? answer.choice : null
}

/** What the answers say to write. Pure, so a table of answers pins it. */
export function loopOps(check: BurstCheck, answers: Record<string, Answer>): LoopOp[] {
  const ops: LoopOp[] = []
  check.sentences.forEach((_, i) => {
    let same: number | undefined
    let closed = false
    for (const { sentence, loop } of check.near) {
      if (sentence !== i) continue
      const rel = decided(answers[`s${i}_l${loop.id}`])
      if (rel === "done" || rel === "dropped") {
        ops.push({ op: "close", sentence: i, id: loop.id, status: rel })
        closed = true
      } else if (rel === "same" && same === undefined) same = loop.id
    }
    if (closed) return
    const kind = decided(answers[`s${i}_kind`])
    if (!isLoopKind(kind)) return
    const certain = answers[`s${i}_certain`]
    const certainty: Certainty = certain?.type === "bool" && certain.probability > 0.5 ? "explicit" : "tentative"
    ops.push({ op: "open", sentence: i, kind, certainty, ...(same === undefined ? {} : { same }) })
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
    "skip what the agent finished in these same turns, and anything already known below. a known loop the turns say is finished is loop done <id>; one no longer wanted is loop dropped <id>.",
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
