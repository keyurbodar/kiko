import { expect, test } from "bun:test"
import type { Effect } from "@yuki/agent/effects"
import { stoppable } from "../src/agent/factory"

const effects = new Map<string, Effect>([
  ["fake_fetch", "read"],
  ["bash", "write"],
  ["ask", "message"],
  ["fake_note", "write"],
  ["send_message", "message"],
  ["fake_send", "external"],
])

test("a read, bash, and ask may be stopped mid-call", () => {
  for (const tool of ["fake_fetch", "bash", "ask"]) expect(stoppable(effects, tool)).toBe(true)
})

test("a write, a message, and an outside call run to their end", () => {
  for (const tool of ["fake_note", "send_message", "fake_send"]) expect(stoppable(effects, tool)).toBe(false)
})

test("a tool with no declared effect is not stopped", () => {
  expect(stoppable(effects, "unknown_tool")).toBe(false)
})
