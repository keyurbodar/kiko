import { DurableObject } from "cloudflare:workers"
import { Agent } from "../src/agent/agent-do"
import type { Env } from "../src/index"
import { initializeSchema } from "../src/owner/schema"
import { metadata } from "../src/owner/context"
import { createServiceClock } from "../src/owner/clock"
import type { ClockPort } from "@kiko/durable/clock-port"
import type { OwnerServices } from "../src/owner/services"

const services = new Proxy({ trimAgents: async () => {}, afterRun: async () => {}, cancelRun: async () => {} }, {
  get(target, key) {
    if (key === "trimAgents") return target.trimAgents
    if (key === "afterRun") return target.afterRun
    if (key === "cancelRun") return target.cancelRun
    return () => { throw new Error(`unexpected service in agent probe: ${String(key)}`) }
  },
}) as OwnerServices

export const PROBE_ROOM = "01J00000000000000000000000"
export const PROBE_KEY = `${PROBE_ROOM}:probe`

export class AgentProbe extends Agent {
  protected readonly fixtureClock: ClockPort
  protected readonly probeServices: OwnerServices
  private invoking?: Promise<void>
  constructor(ctx: DurableObjectState, env: Env, options: { services?: OwnerServices; identity?: { ownerId: string; roomId: string; slug: string } } = {}) {
    initializeSchema(ctx.storage)
    const identity = options.identity ?? { ownerId: "alice", roomId: PROBE_ROOM, slug: "probe" }
    const meta = metadata(ctx.storage, `agent:${identity.roomId}:${identity.slug}`)
    const clock = createServiceClock({ metadata: meta, publish: async (at, persist) => {
      ctx.storage.transactionSync(persist)
      const previous = await ctx.storage.getAlarm()
      if (at === undefined) { if (previous !== null) await ctx.storage.deleteAlarm() }
      else if (previous !== at) await ctx.storage.setAlarm(at)
    } })
    let invoke: () => Promise<void>
    super({ ctx, env, services: options.services ?? services, sql: ctx.storage.sql, broadcast: () => {},
      identity, metadata: meta, clock,
      recoveryDeadline: async (at) => at === undefined ? clock.clearWakeup("recovery") : clock.setWakeup("recovery", at),
      requestRun: () => { ctx.waitUntil(invoke()) },
    })
    this.fixtureClock = clock
    this.probeServices = options.services ?? services
    invoke = () => this.invoke()
    void ctx.blockConcurrencyWhile(async () => { await this.wake() })
  }
  private invoke(): Promise<void> {
    return this.invoking ??= this.runInvocation(() => false).then(() => {}).finally(() => { this.invoking = undefined })
  }
  override async alarm(): Promise<void> { await this.invoke() }
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
