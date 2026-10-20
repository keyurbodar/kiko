import { DurableObject } from "cloudflare:workers"
import { Agent } from "../src/agent/agent-do"
import type { Env } from "../src/index"
import type { OwnerServices } from "../src/owner/services"

// These probes override setup and roomPort and exercise the real shared-storage agent service.
const services = new Proxy({ trimAgents: async () => {}, afterRun: async () => {} }, {
  get(target, key) {
    if (key === "trimAgents") return target.trimAgents
    if (key === "afterRun") return target.afterRun
    return () => { throw new Error(`unexpected service in agent probe: ${String(key)}`) }
  },
}) as OwnerServices

export class AgentProbe extends Agent {
  constructor(ctx: DurableObjectState, env: Env) {
    super({ ctx, env, services, sql: ctx.storage.sql, broadcast: () => {} })
    void ctx.blockConcurrencyWhile(async () => {
      await this.initialize()
      await this.wake()
    })
  }
  async fetch(_request: Request): Promise<Response> { return new Response("not found", { status: 404 }) }
}

export function agentObject(Service: new (ctx: DurableObjectState, env: Env) => AgentProbe) {
  return class extends DurableObject<Env> {
    private readonly agent: AgentProbe
    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env)
      this.agent = new Service(ctx, env)
    }
    override fetch(request: Request): Promise<Response> { return this.agent.fetch(request) }
    override alarm(): Promise<void> { return this.agent.alarm() }
  }
}
