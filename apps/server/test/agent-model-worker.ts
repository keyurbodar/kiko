import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import type { AgentSetup } from "@kiko/agent/host"
import type { Envelope } from "@kiko/protocol"
import { Agent } from "../src/agent/agent-do"
import { buildAgent } from "../src/agent/factory"
import type { RoomPort } from "../src/agent/outbox"
import type { Env } from "../src/index"
import type { OwnerServices } from "../src/owner/services"

const faux = fauxProvider({ provider: "openai", models: [{ id: "before" }, { id: "after" }], tokensPerSecond: 10000 })
faux.setResponses(Array.from({ length: 20 }, () => (_request, _options, _state, model) => fauxAssistantMessage(model.id)))

class ModelAgent extends Agent {
  protected override home() { return { userId: "owner", roomId: "01J00000000000000000000000", slug: "kiko" } as const }
  protected override roomPort(): RoomPort {
    return { post: async () => {}, draft: async () => {}, note: async () => {}, status: async () => {}, workers: async () => {}, endRun: async () => {}, react: async () => {}, runError: async () => {} }
  }
  protected override async setup(): Promise<AgentSetup> {
    const models = createModels()
    models.setProvider(faux.provider)
    return { models, ...buildAgent({ role: "", lead: true, model: { provider: "openai", modelId: "before" } }), beginRun: (batch, root) => this.beginRun(batch, root) }
  }
  async turn(n: number) {
    const envelope: Envelope = { id: `human:${n}`, from: { kind: "human" }, body: "hello", hop: 0, rootId: String(n), seq: n }
    await this.receive([envelope], "")
    const { harness, root } = await this.host.open()
    await harness.waitForIdle(BACKGROUND_CONTEXT)
    return (await root.context(BACKGROUND_CONTEXT)).messages.filter((message) => message.role === "assistant").at(-1)
  }
}

export class T extends DurableObject<Env> {
  private readonly agent: ModelAgent
  private model = "before"
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const services = {
      user: () => ({ agentTurn: async () => ({ provider: "openai", model: `openai/${this.model}`, auth: { type: "api_key", apiKey: "faux" }, timezone: "UTC", captures: false, thinking: "off", catalog: { models: faux.models } }) }),
      room: () => ({ restoreChain: () => {} }), trimAgents: async () => {}, afterRun: async () => {},
    } as unknown as OwnerServices
    this.agent = new ModelAgent({ ctx, env, services, sql: ctx.storage.sql, broadcast: () => {} })
    void ctx.blockConcurrencyWhile(() => this.agent.initialize())
  }
  override async fetch(request: Request) {
    this.model = new URL(request.url).searchParams.get("model") ?? "before"
    return Response.json(await this.agent.turn(this.model === "before" ? 1 : 2))
  }
  override alarm() { return this.agent.alarm() }
}
export default { fetch: () => new Response("not found", { status: 404 }) }
