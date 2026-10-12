import type { JsonObject } from "@earendil-works/pi-ai"
import { boolOf, choiceOf, type Judge, type Question } from "./judge"
import { type CardTag, isCardTag, type Life } from "./life"
import { LINE_BYTES } from "./optmem"

export type CaptureMode = "auto" | "off"

export type CapturePolicy = { idleMs: number; jevDelayMs: number; capture: CaptureMode }

export const DEFAULT_POLICY: CapturePolicy = { idleMs: 60_000, jevDelayMs: 3_000, capture: "auto" }

// How sure the judge must be. Scores are probabilities.
export const WORTH_MIN = 0.6
export const PRIVATE_MAX = 0.5
export const CARD_MIN = 0.7
export const RELATION_MIN = 0.5
export const RERANK_MIN = 0.3
export const RECALL_MAX = 6

export function mergePolicy(raw: string | null): CapturePolicy {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
  } catch {}
  const { idleMs, jevDelayMs } = stored
  return {
    idleMs: Number.isFinite(idleMs) ? (idleMs as number) : DEFAULT_POLICY.idleMs,
    jevDelayMs: Number.isFinite(jevDelayMs) ? (jevDelayMs as number) : DEFAULT_POLICY.jevDelayMs,
    capture: stored.capture === "off" || stored.capture === false ? "off" : "auto",
  }
}

export type Heard = { messageId: string; text: string; at: number }

export type CaptureCount = { added: number; replaced: number; same: number; private: number }

export const SOURCE = "you"

const MAX_CANDIDATES = 6
const MIN_CHARS = 12
const encoder = new TextEncoder()

const NOT_A_FACT = /^(?:can|could|would|will|what|what's|whats|how|why|when|where|who|which|should|do|does|did|is|are|give|tell|show|remind|suggest|help|find|make|write|list|explain|let's|lets|ok|okay|thanks|thank)\b/i

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

// The long definitions travel once in the judge state; each question carries only a short label and points at them by path.
const RULES = {
  worth: {
    true: "a lasting fact about the human worth remembering for months: who they are, their people, places, work, plans, preferences, or how they want to be helped",
    false: "small talk, a passing mood, a question, or a request to the agent",
  },
  standing: { true: "a rule for how to help the human from now on", false: "a request about the current message only, or no rule at all" },
  private: {
    true: "a street address, phone number, government id, account number, password, pin or key, a medical diagnosis, condition, or medication, or something they asked to keep secret",
    false: "none of these. A city, employer, job, who someone is to them, tastes, and food allergies or diets are not private",
  },
  same: { true: "the same fact, maybe in other words", false: "a different fact. A different name, person, place, or detail makes it a different fact, even when the sentences look alike" },
  replaces: {
    true: "an update or correction of the same detail about the same person, place, or thing, so the known fact is no longer true",
    false: "both can be true at once, or they are about different people, places, or things",
  },
  card: {
    IDENTITY: "who they are: name, age, pronouns, where they live, what they do",
    ATTRIBUTE: "a lasting trait, taste, or habit",
    RELATIONSHIP: "a person in their life and who that person is to them",
    INSTRUCTION: "a standing rule for how agents should help them",
    not_card: "anything that may change within six months, or a minor detail",
  },
}

const YES_NO = { true: "yes", false: "no" }

export type CaptureItem = { message: number; candidate: string; known: { pos: number; text: string }[] }

export function captureQuestions(items: readonly CaptureItem[]): { state: JsonObject; questions: Record<string, Question> } {
  const questions: Record<string, Question> = {}
  items.forEach(({ known }, i) => {
    const c = `\`candidates[${i}].text\``
    questions[`c${i}_worth`] = { type: "bool", instructions: `Is ${c} a lasting fact about the human worth remembering for months? Judge by \`rules.worth\`.`, criteria: YES_NO }
    questions[`c${i}_standing`] = { type: "bool", instructions: `Is ${c} a standing rule for how to help the human from now on? Judge by \`rules.standing\`.`, criteria: YES_NO }
    questions[`c${i}_private`] = { type: "bool", instructions: `Does ${c} hold a private detail about the human? Judge by \`rules.private\`.`, criteria: YES_NO }
    for (const k of known) {
      const fact = `this known fact: ${JSON.stringify(k.text)}`
      questions[`c${i}_same_${k.pos}`] = { type: "bool", instructions: `Does ${c} state the very same fact as ${fact}: the same person, place, or thing, and the same detail about it? Judge by \`rules.same\`.`, criteria: YES_NO }
      questions[`c${i}_replaces_${k.pos}`] = { type: "bool", instructions: `Does ${c} make ${fact} no longer true? Judge by \`rules.replaces\`.`, criteria: YES_NO }
    }
    questions[`c${i}_card`] = {
      type: "choice",
      instructions: `Does ${c} belong on the human's profile card? Only facts unlikely to change within six months belong there. Choose by \`rules.card\`.`,
      criteria: Object.fromEntries(Object.keys(RULES.card).map((k) => [k, k])),
    }
  })
  const state = { candidates: items.map((it) => ({ text: it.candidate })), rules: RULES }
  return { state, questions }
}

type CaptureRow = { heard: Heard; ref: string; keep?: () => boolean }

// One judge request for every queued message. A message the human changed meanwhile (keep() false) is asked about but not written.
export async function captureWithJudge(life: Life, judge: Judge, rows: readonly CaptureRow[]): Promise<CaptureCount | null> {
  const count: CaptureCount = { added: 0, replaced: 0, same: 0, private: 0 }
  const items = rows.flatMap((row, message) => candidates(row.heard.text).map((candidate) => ({ message, candidate, known: life.nearest(candidate, NEIGHBORS).map((l) => ({ pos: l.pos, text: l.text })) })))
  if (!items.length) return count
  const { state, questions } = captureQuestions(items)
  const answers = await judge(state, questions)
  if (!answers) return null
  for (const [i, { message, candidate, known }] of items.entries()) {
    const row = rows[message]!
    if (row.keep && !row.keep()) continue
    if (boolOf(answers[`c${i}_private`]) > PRIVATE_MAX) {
      count.private++
      continue
    }
    const answer = choiceOf(answers[`c${i}_card`])
    const card = answer && isCardTag(answer.choice) && answer.p >= CARD_MIN ? answer.choice : null
    // Jev scores a standing rule low on worth, so it is asked separately.
    const standing = card === "INSTRUCTION" && boolOf(answers[`c${i}_standing`]) >= WORTH_MIN
    if (!standing && boolOf(answers[`c${i}_worth`]) < WORTH_MIN) continue
    const replaced = known.filter((k) => boolOf(answers[`c${i}_replaces_${k.pos}`]) >= RELATION_MIN).map((k) => k.pos)
    if (!replaced.length && known.some((k) => boolOf(answers[`c${i}_same_${k.pos}`]) >= RELATION_MIN)) {
      count.same++
      continue
    }
    store(life, candidate, card, row.heard.at, row.ref, replaced, count)
  }
  return count
}

function store(life: Life, text: string, card: CardTag | null, at: number, ref: string, replaces: readonly number[], count: CaptureCount): void {
  const out = life.append(text, SOURCE, at, { ref, card })
  if (!out.ok) return
  const superseded = replaces.filter((pos) => life.supersede(pos, out.pos)).length
  if (superseded) count.replaced += superseded
  else if (out.duplicate) count.same++
  else count.added++
}
