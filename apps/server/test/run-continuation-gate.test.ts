import { expect, test } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { createRegistry, defineExtension, defineTool, Harness, type StorageWrite } from "@earendil-works/pi-durable"
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory"
import { continueAtBoundary } from "@kiko/agent/continuation"
import { RunBudget } from "../src/owner/runs"

const context = BACKGROUND_CONTEXT

class ReplayStorage extends MemoryStorage {
  constructor(private readonly journal: StorageWrite[][]) {
    super()
    for (const writes of journal) this.prepareCommit(writes).apply()
  }
  override async commit(writes: readonly StorageWrite[]) {
    const prepared = this.prepareCommit(writes)
    this.journal.push(structuredClone([...prepared.writes]))
    return prepared.apply()
  }
}

async function fakeRun(split: boolean) {
  const journal: StorageWrite[][] = []
  const effects: number[] = []
  let calls = 0
  let invocations = 0
  let peak = 0
  for (;;) {
    invocations++
    calls = 0
    const tool = defineTool({ name: "step", description: "Record one tool effect", parameters: Type.Object({ n: Type.Number() }), replay: "safe",
      execute: async ({ n }) => { calls++; effects.push(n); return { output: [{ type: "text", text: `receipt ${n}` }] } },
    })
    const extension = defineExtension({ name: "continuation-test", tools: [tool] })
    const registry = createRegistry()
    registry.install(extension)
    const faux = fauxProvider({ tokensPerSecond: 1_000_000 })
    faux.setResponses(Array.from({ length: 61 }, () => (request) => {
      calls++
      const n = request.messages.filter((message) => message.role === "toolResult").length
      return n < 60
        ? fauxAssistantMessage(fauxToolCall("step", { n }, { id: `step-${n}` }), { stopReason: "toolUse" })
        : fauxAssistantMessage("Finished all 60 calls.")
    }))
    const models = createModels()
    models.setProvider(faux.provider)
    const harness = await Harness.open(new ReplayStorage(journal), { models, registry, settings: { retry: { maxRetries: 0 } } }, context)
    const continuation = await continueAtBoundary(harness, () => split && calls >= 40)
    const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" }, extensions: [extension] } })
    if (invocations === 1) await root.submit({ type: "input", content: "Do 60 steps", requestId: "same-input" }, context)
    const outcome = await Promise.race([
      harness.waitForIdle(context).then(() => "done" as const, (error: unknown) => {
        if (!continuation.continuing()) throw error
        return "continue" as const
      }),
      continuation.closed.then(() => "continue" as const),
    ])
    peak = Math.max(peak, calls)
    if (outcome === "continue") {
      await continuation.closed
      continuation.dispose()
      if (invocations > 10) throw new Error("Continuation made no progress")
      continue
    }
    const transcript = (await root.context(context)).messages.map((message) => {
      const copy = { ...message }
      delete copy.timestamp
      if (copy.role === "assistant" || copy.role === "toolResult") delete copy.durationMs
      if (copy.role === "assistant") {
        delete copy.api
        delete copy.usage
      }
      return copy
    })
    continuation.dispose()
    await harness.close(context)
    return { transcript, effects, invocations, peak }
  }
}

test("20 concurrent split runs match one unsplit reference in local transcript and effect isolation, not Cloudflare quotas", async () => {
  const baseline = await fakeRun(false)
  const splits = await Promise.all(Array.from({ length: 20 }, () => fakeRun(true)))
  for (const split of splits) {
    expect(split.invocations).toBeGreaterThan(1)
    expect(split.peak).toBeLessThanOrEqual(40)
    expect(split.effects).toEqual(Array.from({ length: 60 }, (_, n) => n))
    expect(split.transcript).toEqual(baseline.transcript)
  }
}, 120_000)

for (const shape of ["parallel round", "multi-fetch tool"] as const) {
  test(`${shape} stops before its 41st network admission without replaying completed effects`, async () => {
    const budget = new RunBudget()
    const effects: number[] = []
    const tool = defineTool({
      name: "external", description: "Record a network effect", parameters: Type.Object({ n: Type.Number() }), replay: "safe",
      execute: async ({ n }) => {
        const attempts = shape === "parallel round" ? [n] : Array.from({ length: 60 }, (_, i) => i)
        for (const attempt of attempts) {
          budget.count()
          effects.push(attempt)
          await Promise.resolve()
        }
        return { output: [{ type: "text", text: "Effect completed" }] }
      },
    })
    const extension = defineExtension({ name: "budget-test", tools: [tool] })
    const registry = createRegistry()
    registry.install(extension)
    const faux = fauxProvider({ tokensPerSecond: 1_000_000 })
    faux.setResponses([() => {
      budget.count()
      const calls = shape === "parallel round" ? Array.from({ length: 60 }, (_, n) => fauxToolCall("external", { n }, { id: `effect-${n}` })) : [fauxToolCall("external", { n: 0 }, { id: "multi" })]
      return fauxAssistantMessage(calls, { stopReason: "toolUse" })
    }, () => {
      budget.count()
      return fauxAssistantMessage("Done")
    }])
    const models = createModels()
    models.setProvider(faux.provider)
    const harness = await Harness.open(new MemoryStorage(), { models, registry, settings: { toolExecution: "parallel", retry: { maxRetries: 0 } } }, context)
    const boundary = await continueAtBoundary(harness, () => budget.due())
    try {
      const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" }, extensions: [extension] } })
      await root.submit({ type: "input", content: "Run external effects", requestId: "budget-input" }, context)
      await harness.waitForIdle(context)
      expect(budget.calls).toBe(40)
      expect(effects).toHaveLength(39)
      expect(new Set(effects).size).toBe(39)
      expect(boundary.continuing()).toBe(false)
      expect(JSON.stringify((await root.context(context)).messages)).toContain("Completed actions were kept")
    } finally {
      boundary.dispose()
      await harness.close(context)
    }
  }, 30_000)
}
