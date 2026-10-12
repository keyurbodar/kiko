import { expect, test } from "bun:test"
import type { Answer, Judge, Question } from "@yuki/memory/judge"
import { Life } from "@yuki/memory/life"
import { MemoryCapture } from "../src/user/memory-capture"
import { migrate } from "../src/user/schema"
import { sqlStorage } from "./sql-shim"

const ROOM = "01J0000000000000000000000B"
// A judge request above this many questions gets no answer, as a model would time out on a long list.
const MAX_QUESTIONS = 40

const batch = (n: number) => Array.from({ length: n }, (_, i) => ({ messageId: `m${i}`, text: `The weather report for day ${i} is mild.`, at: i + 1 }))
const queued = (sql: SqlStorage) => sql.exec<{ message_id: string }>("SELECT message_id FROM capture_queue ORDER BY at").toArray().map((r) => r.message_id)

// Every candidate is judged not worth keeping, so each row costs four questions and no fact is stored.
const answer = (key: string, q: Question): Answer =>
  q.type === "choice" ? { type: "choice", choice: "not_card", confidence: 0.9, probabilities: { not_card: 0.9 } } : { type: "bool", probability: key.endsWith("_worth") ? 0.1 : 0.05 }

function setup(refuse?: string) {
  const sql = sqlStorage()
  migrate(sql)
  sql.exec("INSERT INTO chats (room_id, title, updated_at) VALUES (?, 'plans', 0)", ROOM)
  const settings = new Map<string, string>()
  const life = new Life(sql, (fn) => fn(), { get: (k) => settings.get(k) ?? null, set: (k, v) => void settings.set(k, v) })
  const judge = (async (state: { candidates: { text: string }[] }, questions: Record<string, Question>) => {
    const asked = Object.keys(questions)
    if (asked.length > MAX_QUESTIONS || (refuse && state.candidates.some((c) => c.text.includes(refuse)))) return null
    return Object.fromEntries(asked.map((k) => [k, answer(k, questions[k]!)]))
  }) as unknown as Judge
  const mem = new MemoryCapture({
    sql,
    life,
    alarms: { setWakeup: async () => {}, clearWakeup: async () => {} } as never,
    label: "test",
    credentials: () => ({}) as never,
    turn: async () => ({}) as never,
    loops: () => ({}) as never,
  })
  mem.judgeKey = () => ({ key: {} as never, model: null })
  mem.judge = () => judge
  return { sql, mem }
}

test("a 24-row queue drains even though the judge answers only short requests", async () => {
  const { sql, mem } = setup()
  await mem.captureHuman(ROOM, batch(24))
  expect(queued(sql)).toHaveLength(24)
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
