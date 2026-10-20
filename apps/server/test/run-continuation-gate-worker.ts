import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { createRegistry, defineExtension, defineTool, Harness, type HarnessSettings } from "@earendil-works/pi-durable"
import { continueAtBoundary } from "@kiko/agent/continuation"
import { JournalStorage, JOURNAL_STEPS } from "@kiko/agent/journal"

const context = BACKGROUND_CONTEXT
const FAUX = { provider: "faux", modelId: "faux-1" }
const PROMPT = "Do 60 steps"
// PR 5's budget: 40 outgoing calls per invocation, counted at the model request and at the tool run.
export const LIMIT = 40
const MAX_INVOCATIONS = 12

type Message = { role?: string; [key: string]: unknown }
type Part = Record<string, unknown>

export type RunResult = {
  transcript: unknown[]
  effects: number[]
  invocations: number
  peak: number
  continuations: number
  journalRows: number
  journalBytes: number
  segmentRows: number[]
  continuationRows: number[]
  modelRequests: number
  toolRequests: number
  errors: string[]
}

type Segment = {
  rows: number
  closeRows: number
  modelRequests: number
  toolRequests: number
} & ({ kind: "continue" } | { kind: "done"; transcript: unknown[]; journalRows: number; journalBytes: number; errors: string[] })

export type Body =
  | { op: "reset" }
  | { op: "run"; key: string; calls: number; split: boolean; limit?: number }

/** Drops only the fields a clock or a provider fills in. Every semantic field stays exact. */
export function normalize(messages: readonly Message[]): unknown[] {
  return messages.map((message) => {
    const copy: Message = { ...message }
    delete copy.timestamp
    delete copy.durationMs
    if (copy.role === "assistant") {
      delete copy.api
      delete copy.usage
    }
    if (Array.isArray(copy.content)) {
      copy.content = (copy.content as Part[]).map((part) => {
        const clean: Part = { ...part }
        delete clean.timestamp
        delete clean.durationMs
        return clean
      })
    }
    return copy
  })
}

export class T extends DurableObject {
  private readonly effects = new Map<string, number[]>()

  declare env: { T: DurableObjectNamespace<T> }

  constructor(ctx: DurableObjectState, env: { T: DurableObjectNamespace<T> }) {
    super(ctx, env)
    for (const step of JOURNAL_STEPS) {
      if (typeof step === "string") this.ctx.storage.sql.exec(step)
      else step(this.ctx.storage.sql)
    }
  }

  async fetch(request: Request): Promise<Response> {
    const body: Body = await request.json()
    try {
      if (body.op === "reset") {
        this.ctx.storage.sql.exec("DELETE FROM journal").toArray()
        this.effects.clear()
        return Response.json({ ok: true })
      }
      return Response.json({ ok: true, value: await this.run(body.key, body.calls, body.split, body.limit ?? LIMIT) })
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.stack : String(error) })
    }
  }

  private rows(key: string): number {
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM journal WHERE agent = ?", key).one().n
  }

  private async run(key: string, calls: number, split: boolean, limit: number): Promise<RunResult> {
    this.effects.set(key, [])
    const segments: Segment[] = []
    for (let invocation = 1; invocation <= MAX_INVOCATIONS; invocation++) {
      // This crosses the runtime RPC boundary; reopening in a JS loop inside one RPC would not.
      const segment = await this.env.T.get(this.ctx.id).runSegment(key, calls, split, limit, invocation)
      segments.push(segment)
      if (segment.kind === "continue") continue
      return {
        transcript: segment.transcript,
        effects: this.effects.get(key) ?? [],
        invocations: segments.length,
        peak: Math.max(...segments.map((part) => part.modelRequests + part.toolRequests)),
        continuations: segments.length - 1,
        segmentRows: segments.map((part) => part.rows),
        continuationRows: segments.filter((part) => part.kind === "continue").map((part) => part.closeRows),
        modelRequests: segments.reduce((sum, part) => sum + part.modelRequests, 0),
        toolRequests: segments.reduce((sum, part) => sum + part.toolRequests, 0),
        journalRows: segment.journalRows,
        journalBytes: segment.journalBytes,
        errors: segment.errors,
      }
    }
    throw new Error(`continuation made no progress after ${MAX_INVOCATIONS} invocations`)
  }

  async runSegment(key: string, calls: number, split: boolean, limit: number, invocation: number): Promise<Segment> {
    const effects = this.effects.get(key)
    if (!effects) throw new Error("Run was not initialized")
    const errors: string[] = []
    const before = this.rows(key)
    const budget = { calls: 0, modelRequests: 0, toolRequests: 0 }
    const settings: HarnessSettings = { retry: { maxRetries: 0 } }
    const extension = defineExtension({
      name: "continuation-gate",
      tools: [
        defineTool({
          name: "step",
          description: "Record one tool effect.",
          parameters: Type.Object({ n: Type.Number() }),
          replay: "safe",
          execute: async ({ n }: { n: number }) => {
            budget.calls++
            budget.toolRequests++
            effects.push(n)
            return { output: [{ type: "text" as const, text: `receipt ${n}` }] }
          },
        }),
      ],
    })
      const faux = fauxProvider({ tokensPerSecond: 1_000_000 })
      faux.setResponses(Array.from({ length: calls * 4 + 10 }, () => (request: { messages: readonly { role?: string }[] }) => {
        budget.calls++
        budget.modelRequests++
        const done = request.messages.filter((message) => message.role === "toolResult").length
        return done < calls
          ? fauxAssistantMessage(fauxToolCall("step", { n: done }, { id: `step-${done}` }), { stopReason: "toolUse" })
          : fauxAssistantMessage(`Finished all ${calls} calls.`)
      }))
      const models = createModels()
      models.setProvider(faux.provider)
      const registry = createRegistry()
      registry.install(extension)
      // The real journal: the same SQL rows the Durable Object keeps, read back on reopen.
      const storage = JournalStorage.open(this.ctx.storage, key)
      const harness = await Harness.open(storage, { models, registry, settings }, context)
      const root = await harness.root(context, { agent: { model: FAUX, extensions: [extension] } })
      const continuation = await continueAtBoundary(harness, () => split && budget.calls >= limit)
      if (invocation === 1) await root.submit({ type: "input", content: PROMPT, requestId: "gate-input" }, context)
      harness.resume()
      const outcome = await Promise.race([
        harness.waitForIdle(context).then(
          () => "done" as const,
          (error: unknown) => {
            if (!continuation.continuing()) throw error
            return "continue" as const
          },
        ),
        continuation.closed.then(() => "continue" as const),
      ])
      if (outcome === "continue") {
        const beforeClose = this.rows(key)
        await continuation.closed
        continuation.dispose()
        return { kind: "continue", rows: this.rows(key) - before, closeRows: this.rows(key) - beforeClose, modelRequests: budget.modelRequests, toolRequests: budget.toolRequests }
      }
      const view = await root.context(context)
      for (const entry of view.entries) {
        const model = entry.model?.[0] as { stopReason?: string; isError?: boolean } | undefined
        if (model?.stopReason === "error" || model?.isError) errors.push(entry.kind)
      }
      const transcript = normalize(view.messages as Message[])
      continuation.dispose()
      await harness.close(context)
      const row = this.ctx.storage.sql.exec<{ rows: number; bytes: number }>(
        "SELECT count(*) AS rows, coalesce(sum(length(data)), 0) AS bytes FROM journal WHERE agent = ?", key,
      ).one()
      return {
        kind: "done",
        transcript,
        rows: this.rows(key) - before,
        closeRows: 0,
        modelRequests: budget.modelRequests,
        toolRequests: budget.toolRequests,
        journalRows: row.rows,
        journalBytes: row.bytes,
        errors,
      }
  }
}

export default { fetch: () => new Response("not found", { status: 404 }) }
