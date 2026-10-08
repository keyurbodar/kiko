import { expect, test } from "bun:test"
import { AnswerWaiters } from "@kiko/agent/answers"

test("a pushed answer ends the wait at once", async () => {
  const w = new AnswerWaiters()
  const started = Date.now()
  const wait = w.wait("q1", 10_000)
  w.answer("q1", { text: "8797", tainted: false })
  expect(await wait).toEqual({ text: "8797", tainted: false })
  expect(Date.now() - started).toBeLessThan(100)
})

test("an answer pushed before the wait starts is not lost", async () => {
  const w = new AnswerWaiters()
  w.answer("q1", { text: "8797", tainted: false })
  expect(await w.wait("q1", 10_000)).toEqual({ text: "8797", tainted: false })
})

test("the human writing ends every wait with no answer", async () => {
  const w = new AnswerWaiters()
  const a = w.wait("q1", 10_000)
  const b = w.wait("q2", 10_000)
  w.interrupt()
  expect(await Promise.all([a, b])).toEqual([null, null])
  w.answer("q1", { text: "late", tainted: true })
  expect(await w.wait("q1", 10)).toEqual({ text: "late", tainted: true })
})

test("no answer within the deadline ends the wait with none", async () => {
  expect(await new AnswerWaiters().wait("q1", 20)).toBeNull()
})
