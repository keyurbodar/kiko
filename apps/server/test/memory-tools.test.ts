import { describe, expect, test } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { Harness, MemoryStorage } from "@earendil-works/pi-durable"
import type { MemoryOp, MemoryResult } from "@kiko/protocol"
import { capProfile, MEMORY_RULE, type MemoryPort, memoryContext } from "../src/agent/extensions/memory"
import { buildAgent } from "../src/agent/factory"
import { renderInput } from "../src/agent/inbox"

// P5-02, architecture section 13.2. A real harness on the faux model with a counting memory port.

const context = BACKGROUND_CONTEXT
const FAUX = { provider: "faux", modelId: "faux-1" }
const MEMORY = { profile: "- 2026-10-01: likes short answers (kiko)", now: "- 2026-10-02: moving house (kiko)", todo: "" }

type Reply = Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0][number]

async function run(replies: Reply[]) {
  const calls = { context: 0, ops: [] as MemoryOp[] }
  const port: MemoryPort = {
    author: "kiko",
    context: async () => {
      calls.context++
      return MEMORY
    },
    op: async (op): Promise<MemoryResult> => {
      calls.ops.push(op)
      return { ok: true, record: { id: "profile", type: "profile", title: "profile", aliases: [], body: "", pinned: false, archived: false, uses: 0, lastUsedAt: 0, createdAt: 0, updatedAt: 0, version: 2 } }
    },
  }
  const built = buildAgent({ role: "", lead: true, model: FAUX, memory: port })
  const systems: string[] = []
  const faux = fauxProvider()
  faux.setResponses(
    replies.map((reply) => (request: unknown, ...rest: unknown[]) => {
      type System = { role: string; content?: string; sections?: Record<string, string | null> }
      const messages = (request as { messages: System[] }).messages
      systems.push(messages.filter((m) => m.role === "system").flatMap((m) => [m.content ?? "", ...Object.values(m.sections ?? {}).map((s) => s ?? "")]).join("\n"))
      return typeof reply === "function" ? (reply as (...a: unknown[]) => unknown)(request, ...rest) : reply
    }) as never,
  )
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  const root = await harness.root(context, { agent: built.agent })
  const settled = await (await root.submit({ type: "input", content: "hi" }, context)).wait(context)
  expect(settled.status).toBe("done")
  await harness.close(context)
  return { calls, systems }
}

describe("memory extension", () => {
  test("a run without a memory tool reads memory only through the turn context", async () => {
    const { calls, systems } = await run([fauxAssistantMessage("ok")])
    expect(calls.ops).toEqual([])
    expect(calls.context).toBeGreaterThan(0)
    expect(systems[0]).toContain("<profile>")
    expect(systems[0]).toContain("likes short answers")
    expect(systems[0]).toContain(MEMORY_RULE.split("\n")[0]!)
    // `now` changes often, so it stays out of the system prompt.
    expect(systems[0]).not.toContain("moving house")
  })

  test("memory_write appends one fact with the agent as author", async () => {
    const { calls } = await run([fauxAssistantMessage(fauxToolCall("memory_write", { id: "profile", fact: "sister is ana" }), { stopReason: "toolUse" }), fauxAssistantMessage("saved")])
    expect(calls.ops).toEqual([{ op: "append", id: "profile", fact: "sister is ana", provenance: { author: "kiko" } }])
  })

  test("now and todo go into the input's context block", () => {
    const extra = memoryContext(MEMORY)!
    expect(extra).toContain("moving house")
    expect(extra).not.toContain("todo list")
    expect(memoryContext({ profile: "x", now: " ", todo: "" })).toBeUndefined()
    expect(renderInput({ envelopes: [], briefs: ["room", extra] })).toContain(`<context>\n${extra}\n</context>`)
  })

  test("the profile is capped and keeps its newest lines", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `- 2026-01-01: fact number ${i} (kiko)`)
    const capped = capProfile(lines.join("\n"))
    expect(capped.length).toBeLessThanOrEqual(6000)
    expect(capped.endsWith("fact number 999 (kiko)")).toBe(true)
    expect(capped.startsWith("- 2026")).toBe(true)
  })
})
