import { beforeEach, expect, mock, test } from "bun:test"

let noKey = true
const toasts: unknown[] = []
mock.module("../settings/connected", () => ({ noModelKey: () => noKey }))
mock.module("@kiko/ui/v2/toast-v2", () => ({ showToastV2: (options: unknown) => void toasts.push(options) }))
const { showRunError } = await import("./run-error")

beforeEach(() => {
  toasts.length = 0
})

test("the no-key toast stays away while the composer's inline hint is showing", async () => {
  noKey = true
  await showRunError({ t: "run_error", kind: "no_key", provider: "anthropic" } as never, "Kiko")
  expect(toasts).toEqual([])
})

test("the no-key toast shows when a key is saved, and other errors always show", async () => {
  noKey = false
  await showRunError({ t: "run_error", kind: "no_key", provider: "anthropic" } as never, "Kiko")
  noKey = true
  await showRunError({ t: "run_error", kind: "rate_limit", provider: "anthropic" } as never, "Kiko")
  expect(toasts).toHaveLength(2)
})
