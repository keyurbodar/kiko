import { expect, test } from "bun:test"
import { Outbox, type RoomPort } from "../src/agent/outbox"
import { AGENT_STEPS } from "../src/agent/schema"
import { sqlWith } from "./sql-shim"

test("a 429 leaves no bubble, not even from text the failed turn carried, and reports one error when the run ends", async () => {
  const posts: string[] = []
  const errors: unknown[] = []
  const room = {
    post: async (_r: string, _a: number, _i: number, block: string) => void posts.push(block),
    status: async () => {},
    draft: async () => {},
    note: async () => {},
    workers: async () => {},
    endRun: async () => {},
    react: async () => {},
    runError: async (_r: string, error: unknown) => void errors.push(error),
  } satisfies RoomPort
  const outbox = new Outbox({ sql: sqlWith(AGENT_STEPS) } as unknown as DurableObjectStorage, () => room, () => "run")
  const inner = outbox as unknown as { start(id: string, cursor: number): Promise<void>; entry(e: unknown): Promise<void>; end(id: string): Promise<void> }
  await inner.start("run-1", 0)
  const failed = { role: "assistant", stopReason: "error", errorMessage: "429 rate limit exceeded", provider: "openai", content: [{ type: "text", text: "Wait a minute, then retry." }] }
  await inner.entry({ id: 1, kind: "pi.message", model: [failed] })
  expect(posts).toEqual([])
  // pi-durable may still retry it, so nothing is reported until the run ends.
  expect(errors).toEqual([])
  await inner.end("run-1")
  expect(errors).toEqual([{ kind: "rate_limit", provider: "openai", detail: "429 rate limit exceeded" }])
})
