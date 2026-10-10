import { choiceOf, type Judge, noulOf, type Question } from "./judge"
import { type CardTag, isCardTag, type Life } from "./life"
import { LINE_BYTES } from "./optmem"

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
  capture: boolean
}

export const DEFAULT_POLICY: CapturePolicy = { batch: 12, idleMs: 600_000, jevDelayMs: 3_000, worthMin: 0.6, privateMax: 0.5, cardMin: 0.7, relationMin: 0.5, rerankMin: 0.3, recallMax: 6, capture: true }

/** The stored setting over the defaults. A field of the wrong type keeps its default. */
export function mergePolicy(raw: string | null): CapturePolicy {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
  } catch {}
  const out = { ...DEFAULT_POLICY }
  for (const key of Object.keys(DEFAULT_POLICY) as (keyof CapturePolicy)[]) {
    if (typeof stored[key] === typeof DEFAULT_POLICY[key] && (typeof stored[key] !== "number" || Number.isFinite(stored[key]))) (out as Record<string, unknown>)[key] = stored[key]
  }
  return out
}

export type Heard = { messageId: string; text: string; at: number }

export type CaptureCount = { added: number; replaced: number; same: number; private: number }

export const SOURCE = "you"

const MAX_CANDIDATES = 6
const MIN_CHARS = 12
const encoder = new TextEncoder()

/** The sentences of a message that could each be one fact. */
export function candidates(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/\n+|(?<=[.!?])\s+/)) {
    const line = part.replace(/\s+/g, " ").trim()
    if (line.length < MIN_CHARS || encoder.encode(line).byteLength > LINE_BYTES || out.includes(line)) continue
    out.push(line)
    if (out.length === MAX_CANDIDATES) break
  }
  return out
}

const NEIGHBORS = 8

const WORTH: Omit<Extract<Question, { type: "noul" }>, "instructions"> = {
  type: "noul",
  criteria: {
    true: "a lasting fact about the human worth remembering for months: who they are, their people, places, work, plans, preferences, or how they want to be helped",
    false: "small talk, a passing mood, a question, or a request to the agent",
  },
}

const PRIVATE: Omit<Extract<Question, { type: "noul" }>, "instructions"> = {
  type: "noul",
  criteria: {
    true: "a street address, phone number, government id, account number, password, pin or key, a health detail, or something they asked to keep secret",
    false: "none of these. A city, country, employer, job, or who someone is to them is not private",
  },
}

const CARD: Record<CardTag | "not_card", string> = {
  IDENTITY: "who they are: name, age, pronouns, where they live, what they do",
  ATTRIBUTE: "a lasting trait, taste, or habit",
  RELATIONSHIP: "a person in their life and who that person is to them",
  INSTRUCTION: "a standing rule for how agents should help them",
  not_card: "anything that may change within six months, or a minor detail",
}

export function captureQuestions(items: { candidate: string; known: { pos: number; text: string }[] }[]): Record<string, Question> {
  const questions: Record<string, Question> = {}
  items.forEach(({ candidate, known }, i) => {
    questions[`c${i}_worth`] = { ...WORTH, instructions: { candidate, question: "Is `candidate` a lasting fact about the human worth remembering for months?" } }
    questions[`c${i}_standing`] = {
      type: "noul",
      instructions: { candidate, question: "Is `candidate` a standing rule for how to help the human from now on, rather than a request about the current message only?" },
    }
    questions[`c${i}_private`] = { ...PRIVATE, instructions: { candidate, question: "Does `candidate` hold a private detail about the human?" } }
    for (const k of known) {
      questions[`c${i}_same_${k.pos}`] = { type: "noul", instructions: { candidate, known: k.text, question: "Does `candidate` say the same thing about the human as `known`, even in other words?" } }
      questions[`c${i}_replaces_${k.pos}`] = {
        type: "noul",
        instructions: { candidate, known: k.text, question: "Does `candidate` make `known` no longer true, as an update or a correction of the same thing?" },
      }
    }
    questions[`c${i}_card`] = {
      type: "choice",
      instructions: { candidate, question: "Does `candidate` belong on the human's profile card? Only facts unlikely to change within six months belong there." },
      criteria: CARD,
    }
  })
  return questions
}

/**
 * Judges each sentence of one message and writes the facts. Null when the judge is unavailable: nothing
 * is written. `keep` is asked after the judge answers, because the message may be deleted or edited meanwhile.
 */
export async function captureWithJudge(life: Life, judge: Judge, heard: Heard, ref: string, policy: CapturePolicy, keep: () => boolean = () => true): Promise<CaptureCount | null> {
  const count: CaptureCount = { added: 0, replaced: 0, same: 0, private: 0 }
  const items = candidates(heard.text).map((candidate) => ({ candidate, known: life.nearest(candidate, NEIGHBORS).map((l) => ({ pos: l.pos, text: l.text })) }))
  if (!items.length) return count
  const answers = await judge({ message: heard.text }, captureQuestions(items))
  if (!answers) return null
  if (!keep()) return count
  items.forEach(({ candidate, known }, i) => {
    if (noulOf(answers[`c${i}_private`]) > policy.privateMax) return void count.private++
    const answer = choiceOf(answers[`c${i}_card`])
    const card = answer && isCardTag(answer.choice) && answer.p >= policy.cardMin ? answer.choice : null
    // Jev scores a standing instruction ("keep answers short from now on") low on worth, so it is asked
    // separately; a one-off request ("answer in one short line") is neither.
    const standing = card === "INSTRUCTION" && noulOf(answers[`c${i}_standing`]) >= policy.worthMin
    if (!standing && noulOf(answers[`c${i}_worth`]) < policy.worthMin) return
    const replaced = known.filter((k) => noulOf(answers[`c${i}_replaces_${k.pos}`]) >= policy.relationMin).map((k) => k.pos)
    if (!replaced.length && known.some((k) => noulOf(answers[`c${i}_same_${k.pos}`]) >= policy.relationMin)) return void count.same++
    const out = life.append(candidate, SOURCE, false, heard.at, { ref, card })
    if (!out.ok) return
    if (out.duplicate) return void count.same++
    const superseded = replaced.filter((pos) => life.supersede(pos, out.pos)).length
    if (superseded) count.replaced += superseded
    else count.added++
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
    "skip small talk, passing moods, questions, requests to the agent, and private details (a street address, phone number, government id, account number, password, pin or key, health detail, or anything they asked to keep secret). a city, employer, or job is not private.",
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
  const out = life.append(op.text, SOURCE, false, at, { ref, card: op.card })
  if (!out.ok) return
  if (out.duplicate) return void count.same++
  if (op.kind === "replace" && life.supersede(op.pos, out.pos)) count.replaced++
  else count.added++
}
