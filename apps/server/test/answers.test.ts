import { expect, test } from "bun:test"
import { AnswerWaiters } from "../src/agent/answers"

test("a pushed answer ends the wait at once", async () => {
  const w = new AnswerWaiters()
  const started = Date.now()
  const wait = w.wait("q1", 10_000)
  w.answer("q1", "8797")
  expect(await wait).toBe("8797")
  expect(Date.now() - started).toBeLessThan(100)
})

test("an answer pushed before the wait starts is not lost", async () => {
  const w = new AnswerWaiters()
  w.answer("q1", "8797")
  expect(await w.wait("q1", 10_000)).toBe("8797")
})

test("the human writing ends every wait with no answer", async () => {
  const w = new AnswerWaiters()
  const a = w.wait("q1", 10_000)
  const b = w.wait("q2", 10_000)
  w.interrupt()
  expect(await Promise.all([a, b])).toEqual([null, null])
  // A late answer after the interrupt waits for a replayed call, and never reaches the old one.
  w.answer("q1", "late")
  expect(await w.wait("q1", 10)).toBe("late")
})

test("no answer within the deadline ends the wait with none", async () => {
  expect(await new AnswerWaiters().wait("q1", 20)).toBeNull()
})
