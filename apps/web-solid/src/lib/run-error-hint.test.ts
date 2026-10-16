import { expect, test } from "bun:test"
import { hintCoversRunError } from "./run-error"

const frame = (kind: "no_key" | "rate_limit") => ({ t: "run_error" as const, kind, provider: "anthropic" }) as Parameters<typeof hintCoversRunError>[0]

test("the inline hint covers a no-key error only while no key is saved", () => {
  expect(hintCoversRunError(frame("no_key"), true)).toBe(true)
  expect(hintCoversRunError(frame("no_key"), false)).toBe(false)
})

test("every other error still shows its toast", () => {
  expect(hintCoversRunError(frame("rate_limit"), true)).toBe(false)
})
