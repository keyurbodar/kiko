import { expect, test } from "bun:test"
import type { Answer, Judge, Question } from "@kiko/memory/judge"
import { Life } from "@kiko/memory/life"
import { MemoryCapture } from "../src/user/memory-capture"
import { OWNER_STEPS } from "../src/owner/schema"
import { sqlWith } from "./sql-shim"

const ROOM = "01J0000000000000000000000B"
// A judge request above this many questions gets no answer, as a model would time out on a long list.
const MAX_QUESTIONS = 40

const batch = (n: number) => Array.from({ length: n }, (_, i) => ({ messageId: `m${i}`, text: `The weather report for day ${i} is mild.`, at: i + 1 }))
const queued = (sql: SqlStorage) => sql.exec<{ message_id: string }>("SELECT message_id FROM capture_queue ORDER BY at").toArray().map((r) => r.message_id)

// Every candidate is judged not worth keeping, so each row costs four questions and no fact is stored.
const answer = (key: string, q: Question): Answer =>
  q.type === "choice" ? { type: "choice", choice: "not_card", confidence: 0.9, probabilities: { not_card: 0.9 } } : { type: "bool", probability: key.endsWith("_worth") ? 0.1 : 0.05 }

function setup(refuse?: string) {
  const sql = sqlWith(OWNER_STEPS)
  const settings = new Map<string, string>()
  const life = new Life(sql, (fn) => fn(), { get: (k) => settings.get(k) ?? null, set: (k, v) => void settings.set(k, v) })
  const calls: number[] = []
  const judge = (async (state: { candidates: { text: string }[] }, questions: Record<string, Question>) => {
    const asked = Object.keys(questions)
    calls.push(asked.length)
    if (asked.length > MAX_QUESTIONS || (refuse && state.candidates.some((c) => c.text.includes(refuse)))) return null
    return Object.fromEntries(asked.map((k) => [k, answer(k, questions[k]!)]))
  }) as unknown as Judge
  const mem = new MemoryCapture({
    sql,
    life,
    chat: (roomId) => roomId === ROOM ? { roomId, title: "plans", pinned: false, muted: false, lastSeq: 0, lastPreview: "", unread: 0, updatedAt: 0 } : null,
    fetch: async () => { throw new Error("unexpected transport in judge fixture") },
    countOutgoing: () => {},
    label: "test",
    credentials: () => ({}) as never,
    turn: async () => ({}) as never,
  })
  mem.judgeKey = () => ({}) as never
  mem.judge = () => judge
  return { sql, mem, calls }
}

test("a 24-row queue drains even though the judge answers only short requests", async () => {
  const { sql, mem, calls } = setup()
  // A human run writes down its own burst, so the queue is empty once it returns.
  await mem.captureHuman(ROOM, batch(24))
  expect(queued(sql)).toEqual([])
  // All 24 rows were judged in chunks of four, so no request held more questions than a model answers.
  expect(calls).toHaveLength(6)
  expect(Math.max(...calls)).toBeLessThanOrEqual(MAX_QUESTIONS)
  await mem.captureNow()
  expect(queued(sql)).toEqual([])
})

test("a chunk the judge cannot answer stays queued and the chunks around it drain", async () => {
  const { sql, mem } = setup("slow")
  const rows = batch(24).map((r) => (r.messageId === "m5" ? { ...r, text: "The weather report for day 5 is slow." } : r))
  await mem.captureHuman(ROOM, rows)
  await mem.captureNow()
  expect(queued(sql)).toEqual(["m4", "m5", "m6", "m7"])
})
