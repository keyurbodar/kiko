import { createServiceClock, projectRecovery } from "../src/owner/clock"
import { scheduledDeadline } from "../src/owner/schedules"
import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable"
import { AgentHost, INITIAL_HOST_STEPS } from "@kiko/agent/host"
import { JOURNAL_STEPS } from "@kiko/agent/journal"
import type { Envelope } from "@kiko/agent/envelope"
import { migrate } from "@kiko/durable/migrate"

export class T extends DurableObject {
  private calls = 0
  private setups = 0
  private effects: number[] = []
  private errors: string[] = []
  private requested: string[] = []
  private compactedMessages: unknown[] | undefined
  private readonly host: AgentHost

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    migrate(ctx.storage, [...INITIAL_HOST_STEPS, ...JOURNAL_STEPS])
    this.host = new AgentHost(ctx, {
      agentKey: "test-agent",
      clock: createServiceClock({
        metadata: {
          get: (key) => ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null,
          set: (key, value) => { ctx.storage.sql.exec("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value) },
          delete: (key) => { ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", key) },
        },
        publish: async (at, persist) => {
          ctx.storage.transactionSync(persist)
          if (at === undefined) await ctx.storage.deleteAlarm()
          else await ctx.storage.setAlarm(at)
        },
      }),
      projectTasks: (tasks, watches, current) => projectRecovery(tasks, watches, current, Date.now(), scheduledDeadline),
      requestRun: (id) => { this.requested.push(id) },
      waitUntil: (work) => ctx.waitUntil(work),
      onError: async (error) => { this.errors.push(String(error)) },
      setup: () => {
        this.setups++
        const tool = defineTool({ name: "step", description: "Record a tool effect", parameters: Type.Object({ n: Type.Number() }), replay: "safe",
          execute: async ({ n }) => { this.calls++; this.effects.push(n); return { output: [{ type: "text", text: `receipt ${n}` }] } },
        })
        const extension = defineExtension({ name: "host-continuation", tools: [tool] })
        const registry = createRegistry()
        registry.install(extension)
        const faux = fauxProvider({ tokensPerSecond: 1_000_000 })
        faux.setResponses(Array.from({ length: 61 }, () => (request) => {
          this.calls++
          const n = request.messages.filter((message) => message.role === "toolResult").length
          return n < 60
            ? fauxAssistantMessage(fauxToolCall("step", { n }, { id: `step-${n}` }), { stopReason: "toolUse" })
            : fauxAssistantMessage("Finished all 60 calls.")
        }))
        const models = createModels()
        models.setProvider(faux.provider)
        return { beforeCompact: async () => { const { root } = await this.host.open(); this.compactedMessages = [...(await root.context(BACKGROUND_CONTEXT)).messages] }, models, registry, agent: { model: { provider: "faux", modelId: "faux-1" }, extensions: [extension] }, settings: { retry: { maxRetries: 0 } } }
      },
    })
  }

  async alarm(): Promise<void> { await this.host.alarm() }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/start") {
      const envelope: Envelope = { id: "human:input", from: { kind: "human" }, body: "Do 60 steps", hop: 0, rootId: "input", seq: 1 }
      await this.host.receive([envelope], "")
      return Response.json({ calls: this.calls, effects: this.effects, requested: this.requested, busy: await this.host.busy(), alarmAt: await this.ctx.storage.getAlarm() })
    }
    this.calls = 0
    const outcome = await this.host.runInvocation(() => this.calls >= 40)
    const setups = this.setups
    let messages: unknown[] = []
    if (outcome === "done") {
      const { root } = await this.host.open()
      messages = this.compactedMessages ?? [...(await root.context(BACKGROUND_CONTEXT)).messages]
    }
    return Response.json({ outcome, calls: this.calls, setups, effects: this.effects, errors: this.errors,
      resumes: await this.ctx.storage.get("crash:resumes") ?? null, messages })
  }
}

export default { fetch: () => new Response("not found", { status: 404 }) }
