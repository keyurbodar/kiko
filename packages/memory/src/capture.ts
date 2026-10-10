import type { JsonObject } from "@earendil-works/pi-ai"
import { boolOf, choiceOf, type Judge, type Question } from "./judge"
import { type CardTag, isCardTag, type Life } from "./life"
import { LINE_BYTES } from "./optmem"

/** "auto" captures only with a judge, "always" falls back to the memory model, "off" never captures. */
export type CaptureMode = "auto" | "always" | "off"
const MODES: readonly CaptureMode[] = ["auto", "always", "off"]

export type CapturePolicy = {
  batch: number
  idleMs: number
  jevDelayMs: number
  worthMin: number
  privateMax: number
  cardMin: number
  relationMin: number
  rerankMin: number
  recallMax: number
  capture: CaptureMode
}

export const DEFAULT_POLICY: CapturePolicy = { batch: 8, idleMs: 60_000, jevDelayMs: 3_000, worthMin: 0.6, privateMax: 0.5, cardMin: 0.7, relationMin: 0.5, rerankMin: 0.3, recallMax: 6, capture: "auto" }

/** The stored setting over the defaults. A field of the wrong type keeps its default; a stored boolean `capture` means "auto" or "off". */
export function mergePolicy(raw: string | null): CapturePolicy {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
  } catch {}
  const out = { ...DEFAULT_POLICY }
  for (const key of Object.keys(DEFAULT_POLICY) as (keyof CapturePolicy)[]) {
    if (key !== "capture" && Number.isFinite(stored[key])) (out as Record<string, unknown>)[key] = stored[key]
  }
  const capture = stored.capture
  if (typeof capture === "boolean") out.capture = capture ? "auto" : "off"
  else if (MODES.includes(capture as CaptureMode)) out.capture = capture as CaptureMode
  return out
}

/** Whether the human's own words are captured now. Agents read it to know what `note` is for. */
export const captureActive = (policy: CapturePolicy, judgeReady: boolean): boolean => policy.capture === "always" || (policy.capture === "auto" && judgeReady)

export type Heard = { messageId: string; text: string; at: number }

export type CaptureCount = { added: number; replaced: number; same: number; private: number }

export const SOURCE = "you"

const MAX_CANDIDATES = 6
const MIN_CHARS = 12
const encoder = new TextEncoder()

const NOT_A_FACT = /^(?:can|could|would|will|what|what's|whats|how|why|when|where|who|which|should|do|does|did|is|are|give|tell|show|remind|suggest|help|find|make|write|list|explain|let's|lets|ok|okay|thanks|thank)\b/i

/** The sentences of a message that could each be one fact. Questions and requests to the agent never are. */
export function candidates(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/\n+|(?<=[.!?])\s+/)) {
    const line = part.replace(/\s+/g, " ").trim()
    if (line.length < MIN_CHARS || encoder.encode(line).byteLength > LINE_BYTES || out.includes(line)) continue
    if (line.endsWith("?") || NOT_A_FACT.test(line)) continue
    out.push(line)
    if (out.length === MAX_CANDIDATES) break
  }
  return out
}

const NEIGHBORS = 8

const WORTH = {
  true: "a lasting fact about the human worth remembering for months: who they are, their people, places, work, plans, preferences, or how they want to be helped",
  false: "small talk, a passing mood, a question, or a request to the agent",
}

const STANDING = { true: "a rule for how to help the human from now on", false: "a request about the current message only, or no rule at all" }

const PRIVATE = {
  true: "a street address, phone number, government id, account number, password, pin or key, a medical diagnosis, condition, or medication, or something they asked to keep secret",
  false: "none of these. A city, employer, job, who someone is to them, tastes, and food allergies or diets are not private",
}

const SAME = { true: "the same fact, maybe in other words", false: "a different fact. A different name, person, place, or detail makes it a different fact, even when the sentences look alike" }

const REPLACES = { true: "an update or correction of the same detail about the same person, place, or thing, so the known fact is no longer true", false: "both can be true at once, or they are about different people, places, or things" }

const CARD: Record<CardTag | "not_card", string> = {
  IDENTITY: "who they are: name, age, pronouns, where they live, what they do",
  ATTRIBUTE: "a lasting trait, taste, or habit",
  RELATIONSHIP: "a person in their life and who that person is to them",
  INSTRUCTION: "a standing rule for how agents should help them",
  not_card: "anything that may change within six months, or a minor detail",
}

export type CaptureItem = { candidate: string; known: { pos: number; text: string }[] }

/**
 * The sentences are in `state` once and questions point at them by path. Known facts go only into the
 * same and replaces questions: in `state` they made Jev rate a new friend lower with each friend it
 * already knew (worth 0.61, then 0.47, then 0.35).
 */
export function captureQuestions(message: string, items: readonly CaptureItem[]): { state: JsonObject; questions: Record<string, Question> } {
  const questions: Record<string, Question> = {}
  items.forEach(({ known }, i) => {
    const c = `\`candidates[${i}].text\``
    questions[`c${i}_worth`] = { type: "bool", instructions: `Is ${c} a lasting fact about the human worth remembering for months?`, criteria: WORTH }
    questions[`c${i}_standing`] = { type: "bool", instructions: `Is ${c} a standing rule for how to help the human from now on?`, criteria: STANDING }
    questions[`c${i}_private`] = { type: "bool", instructions: `Does ${c} hold a private detail about the human?`, criteria: PRIVATE }
    known.forEach((k) => {
      const fact = `this known fact: ${JSON.stringify(k.text)}`
      questions[`c${i}_same_${k.pos}`] = { type: "bool", instructions: `Does ${c} state the very same fact as ${fact}: the same person, place, or thing, and the same detail about it?`, criteria: SAME }
      questions[`c${i}_replaces_${k.pos}`] = { type: "bool", instructions: `Does ${c} make ${fact} no longer true?`, criteria: REPLACES }
    })
    questions[`c${i}_card`] = {
      type: "choice",
      instructions: `Does ${c} belong on the human's profile card? Only facts unlikely to change within six months belong there.`,
      criteria: CARD,
    }
  })
  const state = { message, candidates: items.map((it) => ({ text: it.candidate })) }
  return { state, questions }
}

/**
 * Judges each sentence of one message and writes the facts. Null when the judge is unavailable: nothing
 * is written. `keep` is asked after the judge answers, because the message may be deleted or edited meanwhile.
 */
export async function captureWithJudge(life: Life, judge: Judge, heard: Heard, ref: string, policy: CapturePolicy, keep: () => boolean = () => true): Promise<CaptureCount | null> {
  const count: CaptureCount = { added: 0, replaced: 0, same: 0, private: 0 }
  const items = candidates(heard.text).map((candidate) => ({ candidate, known: life.nearest(candidate, NEIGHBORS).map((l) => ({ pos: l.pos, text: l.text })) }))
  if (!items.length) return count
  const { state, questions } = captureQuestions(heard.text, items)
  const answers = await judge(state, questions)
  if (!answers) return null
  if (!keep()) return count
  items.forEach(({ candidate, known }, i) => {
    if (boolOf(answers[`c${i}_private`]) > policy.privateMax) return void count.private++
    const answer = choiceOf(answers[`c${i}_card`])
    const card = answer && isCardTag(answer.choice) && answer.p >= policy.cardMin ? answer.choice : null
    // Jev scores a standing instruction ("keep answers short from now on") low on worth, so it is asked
    // separately; a one-off request ("answer in one short line") is neither.
    const standing = card === "INSTRUCTION" && boolOf(answers[`c${i}_standing`]) >= policy.worthMin
    if (!standing && boolOf(answers[`c${i}_worth`]) < policy.worthMin) return
    const replaced = known.filter((k) => boolOf(answers[`c${i}_replaces_${k.pos}`]) >= policy.relationMin).map((k) => k.pos)
    if (!replaced.length && known.some((k) => boolOf(answers[`c${i}_same_${k.pos}`]) >= policy.relationMin)) return void count.same++
    store(life, candidate, card, heard.at, ref, replaced, count)
  })
  return count
}

/** `from` is the index of the message the fact came from, so deleting that message forgets it. */
export type CaptureOp =
  | { kind: "new"; text: string; card: CardTag | null; from: number }
  | { kind: "same"; pos: number }
  | { kind: "replace"; pos: number; text: string; card: CardTag | null; from: number }

export const CAPTURE_SYSTEM = "you keep a memory of lasting facts about one human. you answer only with lines in the format you are given."

const MAX_KNOWN = 12
const MESSAGE_CUT = 2_000

export function capturePrompt(heard: readonly Heard[], known: readonly { pos: number; text: string }[]): string {
  return [
    "read the human's messages and the facts already known. write one line for each fact worth remembering for months: who they are, their people, places, work, plans, tastes, and how they want to be helped.",
    "skip small talk, passing moods, questions, requests to the agent, and private details (a street address, phone number, government id, account number, password, pin or key, a medical diagnosis, condition, or medication, or something they asked to keep secret). a city, employer, job, who someone is to them, tastes, and food allergies or diets are not private.",
    `write each fact in the third person about the human, in one line of at most ${LINE_BYTES} bytes. copy names, numbers, and dates exactly. invent nothing.`,
    "use only these line formats:",
    "+ m<i> <fact>        a new fact, from message m<i>",
    "= <n>                the same as known fact #n",
    "~ <n> m<i> <fact>    replaces known fact #n, which is no longer true",
    "a fact a known fact already covers, even in other words, is = <n>. keep one fact on one line; do not split it.",
    "end a fact with [IDENTITY], [ATTRIBUTE], [RELATIONSHIP], or [INSTRUCTION] only when it is unlikely to change within six months.",
    "if nothing is worth keeping, answer: none",
    "",
    "known facts:",
    ...(known.length ? known.slice(0, MAX_KNOWN).map((k) => `#${k.pos} ${k.text}`) : ["(none)"]),
    "",
    "human messages:",
    ...heard.map((h, i) => `m${i + 1}: ${(h.text.length > MESSAGE_CUT ? `${h.text.slice(0, MESSAGE_CUT)}…` : h.text).replace(/\s+/g, " ").trim()}`),
  ].join("\n")
}

export function knownFor(life: Life, heard: readonly Heard[]): { pos: number; text: string }[] {
  const seen = new Map<number, string>()
  for (const h of heard) for (const l of life.nearest(h.text, NEIGHBORS)) if (seen.size < MAX_KNOWN) seen.set(l.pos, l.text)
  return [...seen].map(([pos, text]) => ({ pos, text }))
}

const TAG = /\s*\[(IDENTITY|ATTRIBUTE|RELATIONSHIP|INSTRUCTION)\]\s*$/

/** Reads the model's lines. A malformed line, or one naming a fact that was not shown, is dropped. */
export function parseCapture(answer: string, known: ReadonlySet<number>, messages = 1): CaptureOp[] {
  const ops: CaptureOp[] = []
  const from = (raw: string | undefined) => {
    const i = raw ? Number(raw) - 1 : 0
    return i >= 0 && i < messages ? i : 0
  }
  const fact = (raw: string) => {
    const tag = TAG.exec(raw)
    const text = raw.replace(TAG, "").replace(/\s+/g, " ").trim()
    const card = tag && isCardTag(tag[1]) ? tag[1] : null
    return text.length >= 3 && encoder.encode(text).byteLength <= LINE_BYTES ? { text, card } : null
  }
  for (const line of answer.split("\n").map((l) => l.trim())) {
    let m: RegExpExecArray | null
    if ((m = /^\+\s+(?:m(\d+)\s+)?(.+)$/.exec(line))) {
      const f = fact(m[2]!)
      if (f) ops.push({ kind: "new", ...f, from: from(m[1]) })
    } else if ((m = /^=\s*#?(\d+)$/.exec(line))) {
      if (known.has(Number(m[1]))) ops.push({ kind: "same", pos: Number(m[1]) })
    } else if ((m = /^~\s*#?(\d+)\s+(?:m(\d+)\s+)?(.+)$/.exec(line))) {
      const f = fact(m[3]!)
      if (f && known.has(Number(m[1]))) ops.push({ kind: "replace", pos: Number(m[1]), ...f, from: from(m[2]) })
    }
  }
  return ops
}

export function applyOps(life: Life, ops: readonly CaptureOp[], heard: readonly { ref: string; at: number }[]): CaptureCount {
  const count: CaptureCount = { added: 0, replaced: 0, same: 0, private: 0 }
  for (const op of ops) {
    const source = op.kind === "same" ? heard[0]! : (heard[op.from] ?? heard[0]!)
    apply(life, op, source.ref, source.at, count)
  }
  return count
}

function apply(life: Life, op: CaptureOp, ref: string, at: number, count: CaptureCount): void {
  if (op.kind === "same") return void count.same++
  store(life, op.text, op.card, at, ref, op.kind === "replace" ? [op.pos] : [], count)
}

/** Appends one fact, supersedes the facts it replaces, and counts what happened. */
function store(life: Life, text: string, card: CardTag | null, at: number, ref: string, replaces: readonly number[], count: CaptureCount): void {
  const out = life.append(text, SOURCE, false, at, { ref, card })
  if (!out.ok) return
  if (out.duplicate) return void count.same++
  const superseded = replaces.filter((pos) => life.supersede(pos, out.pos)).length
  if (superseded) count.replaced += superseded
  else count.added++
}
