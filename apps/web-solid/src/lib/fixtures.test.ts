import { expect, test } from "bun:test"
import { MESSAGES } from "./fixtures"

test("every fixture message id is unique", () => {
  const seen = new Set<string>()
  const duplicates = MESSAGES.filter((message) => {
    const repeated = seen.has(message.id)
    seen.add(message.id)
    return repeated
  }).map((message) => message.id)
  expect(duplicates).toEqual([])
})

test("every reply points at a message that exists", () => {
  const ids = new Set(MESSAGES.map((message) => message.id))
  const dangling = MESSAGES.filter(
    (message) => message.replyToId !== undefined && !ids.has(message.replyToId),
  ).map((message) => message.id)
  expect(dangling).toEqual([])
})
