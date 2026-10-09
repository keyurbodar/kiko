import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createRegistry, Harness, LiveDoc, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable"
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import { createStorageConformance, type StorageConformanceProvider } from "@earendil-works/pi-durable/testing"
import { createCoalescingStorage, type HoldPolicy } from "@yuki/agent/coalescing-storage"
import { openDurableObjectSqlite } from "@yuki/agent/sqlite"
import { assistantMessages, FAUX_MODEL, fauxModels, measureTurn, openDurable, streamedText } from "../src/experiments/coalescing"
import { assertions } from "./sqlite-worker"

const context = BACKGROUND_CONTEXT
const fail = (message: string): never => {
  throw new Error(message)
}

const policies: Record<string, HoldPolicy | undefined> = { default: undefined, aggressive: () => true }

const conformance = (storage: DurableObjectStorage, holds: HoldPolicy | undefined) => {
  const provider: StorageConformanceProvider = async (use) => {
    const durable = createCoalescingStorage(await SqliteStorage.open(openDurableObjectSqlite(storage)), { holds })
    try {
      await use(durable)
    } finally {
      await durable.close(context)
    }
  }
  return createStorageConformance({ assertions, withStorage: provider })
}

const CRASH_ANSWER = streamedText(6_000)
const RECOVERED = "recovered answer"
const text = (message: unknown) =>
  ((message as { content?: { type: string; text?: string }[] } | undefined)?.content ?? [])
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("")

type Body =
  | { op: "conformance"; policy: string; index?: number }
  | { op: "measure"; coalesce: boolean; ms: number }
  | { op: "crash" }
  | { op: "resume" }

export class T extends DurableObject {
  async fetch(request: Request) {
    const body = (await request.json()) as Body
    if (body.op === "conformance") {
      const cases = conformance(this.ctx.storage, policies[body.policy])
      if (body.index === undefined) return Response.json({ names: cases.map((c) => c.name) })
      const testCase = cases[body.index] ?? fail(`no case ${body.index}`)
      try {
        await testCase.run()
        return Response.json({ name: testCase.name, ok: true })
      } catch (error) {
        return Response.json({ name: testCase.name, ok: false, error: error instanceof Error ? error.stack : String(error) })
      }
    }
    if (body.op === "measure") return Response.json(await measureTurn(this.ctx.storage, body.coalesce, body.ms))
    if (body.op === "crash") return this.crash()
    return this.resume()
  }

  private async crash(): Promise<Response> {
    const { durable, coalescing } = await openDurable(this.ctx.storage, true)
    const harness = await Harness.open(durable, { models: fauxModels([CRASH_ANSWER]), registry: createRegistry() }, context)
    const root = await harness.root(context, { agent: { model: FAUX_MODEL } })
    void root.submit({ type: "input", content: "count", requestId: "crash" }, context).catch(() => {})
    const deadline = Date.now() + 10_000
    for (;;) {
      const stats = coalescing!.stats()
      if (stats.held - stats.pending > 0 && stats.pending >= 3) break
      if (Date.now() > deadline) return Response.json({ error: "no window opened", stats }, { status: 500 })
      await scheduler.wait(10)
    }
    const memory = text((await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context))?.generation?.message)
    const raw = await SqliteStorage.open(openDurableObjectSqlite(this.ctx.storage))
    const address = { kind: LiveDoc.definition.kind, scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID } } as const
    const record = (await raw.findDocument(address, "current", context)) ?? fail("no live document")
    const stored = (await raw.document(record.id, "current", context))?.value as { generation?: { message?: unknown } } | undefined
    const info = {
      pending: coalescing!.stats().pending,
      memoryChars: memory.length,
      storedChars: text(stored?.generation?.message).length,
    }
    await this.ctx.storage.put("crash", info)
    await this.ctx.storage.sync()
    this.ctx.abort("simulated crash")
    return Response.json({ error: "still alive" }, { status: 500 })
  }

  private async resume(): Promise<Response> {
    const info = await this.ctx.storage.get("crash")
    const { durable } = await openDurable(this.ctx.storage, true)
    const harness = await Harness.open(durable, { models: fauxModels([RECOVERED]), registry: createRegistry() }, context)
    harness.resume()
    await harness.waitForIdle(context)
    const messages = await assistantMessages(harness)
    await harness.close(context)
    return Response.json({ info, messages, answer: CRASH_ANSWER, recovered: RECOVERED })
  }
}

export default {
  async fetch() {
    return new Response("not found", { status: 404 })
  },
}
