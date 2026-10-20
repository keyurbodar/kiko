import { createServiceClock, projectRecovery } from "../src/owner/clock"
import { scheduledDeadline } from "../src/owner/schedules"
import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Type } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux"
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable"
import { AgentHost, HOST_STEPS, HOST_TAIL } from "@kiko/agent/host"
import { JOURNAL_STEPS } from "@kiko/agent/journal"
import type { Envelope } from "@kiko/agent/envelope"
import { migrate } from "@kiko/durable/migrate"

export class T extends DurableObject {
  private calls = 0
  private setups = 0
  private effects: number[] = []
  private errors: string[] = []
  private requested: string[] = []
  private readonly host: AgentHost

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env)
    migrate(ctx.storage, [...HOST_STEPS, ...JOURNAL_STEPS, ...HOST_TAIL])
    this.host = new AgentHost(ctx, {
      clock: createServiceClock(ctx),
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
        return { models, registry, agent: { model: { provider: "faux", modelId: "faux-1" }, extensions: [extension] }, settings: { retry: { maxRetries: 0 } } }
      },
    })
  }

  async alarm(): Promise<void> { await this.host.alarm() }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/start") {
      const envelope: Envelope = { id: "human:input", from: { kind: "human" }, body: "Do 60 steps", hop: 0, rootId: "input", seq: 1 }
      await this.host.receive([envelope], "")
      return Response.json({ calls: this.calls, effects: this.effects, requested: this.requested, busy: await this.host.busy() })
    }
    this.calls = 0
    const outcome = await this.host.runInvocation(() => this.calls >= 40)
    let messages: unknown[] = []
    if (outcome === "done") {
      const { root } = await this.host.open()
      messages = [...(await root.context(BACKGROUND_CONTEXT)).messages]
    }
    return Response.json({ outcome, calls: this.calls, setups: this.setups, effects: this.effects, errors: this.errors,
      resumes: await this.ctx.storage.get("crash:resumes") ?? null, messages })
  }
}

export default { fetch: () => new Response("not found", { status: 404 }) }
