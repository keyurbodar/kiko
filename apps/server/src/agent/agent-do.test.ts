import { describe, expect, it } from "vitest"
import type { ClockPort } from "@kiko/durable/clock-port"
import type { Env } from "../index"
import type { OwnerServices, ServiceOptions } from "../owner/services"
import { Agent } from "./agent-do"

type Egress = Parameters<Agent["egress"]>[0]

const clock: ClockPort = {
  setWakeup: async () => {},
  clearWakeup: async () => {},
  dueWakeups: async () => [],
  deadline: () => undefined,
}

function agentWith(egress: (request: Egress) => Promise<Response>): Agent {
  return new Agent({
    ctx: { storage: {} } as unknown as DurableObjectState,
    env: {} as Env,
    services: { egress } as unknown as OwnerServices,
    sql: {} as ServiceOptions["sql"],
    computers: {} as ServiceOptions["computers"],
    broadcast: () => {},
    requestRun: () => {},
    identity: { ownerId: "owner", roomId: "room", slug: "agent" },
    clock,
    metadata: { get: () => null, set: () => {}, delete: () => {} },
  })
}

function modelFetch(agent: Agent): typeof fetch {
  return (agent as unknown as { egressFetch(spare?: boolean): typeof fetch }).egressFetch()
}

describe("agent model egress", () => {
  it("hands the abort signal to the model request", async () => {
    const seen: (AbortSignal | undefined)[] = []
    const agent = agentWith(async (request) => {
      seen.push(request.signal)
      return new Response("{}")
    })
    const controller = new AbortController()

    const response = await modelFetch(agent)("https://models.test/chat", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    })

    expect(seen).toEqual([controller.signal])
    expect(await response.text()).toBe("{}")
  })

  it("stops waiting for the provider when the run aborts", async () => {
    const started = Promise.withResolvers<AbortSignal | undefined>()
    const agent = agentWith(
      (request) =>
        new Promise<Response>((_, reject) => {
          started.resolve(request.signal)
          request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true })
        }),
    )
    const controller = new AbortController()

    const call = modelFetch(agent)("https://models.test/chat", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    })

    expect(await started.promise).toBe(controller.signal)
    const reason = new Error("stopped")
    controller.abort(reason)
    await expect(call).rejects.toBe(reason)
  })
})
