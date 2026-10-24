import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Connectivity from "../connection/connectivity"
import { OwnerSupervisor } from "../connection/supervisor"
import * as Wakeups from "../connection/wakeups"
import * as Cache from "../platform/cache"
import { layer } from "./runtime"

const runtime = (connect: boolean) => {
  const requests: string[] = []
  const fetch = ((input: RequestInfo | URL) => {
    requests.push(String(input))
    return Promise.reject(new Error("offline"))
  }) as typeof globalThis.fetch
  const services = layer({
    endpoint: { baseUrl: () => "https://kiko.example", token: () => null, fetch },
    connect,
    store: Cache.layerMemoryStore,
    connectivity: Connectivity.layerAlwaysOnline,
    wakeups: Wakeups.layerNone,
  })
  return { requests, services }
}

describe("owner runtime", () => {
  it.effect("stays idle when it has no backend to connect to", () =>
    Effect.gen(function* () {
      const { requests, services } = runtime(false)
      const state = yield* OwnerSupervisor.use((supervisor) => SubscriptionRef.get(supervisor.state)).pipe(
        Effect.provide(Layer.fresh(services)),
      )
      expect(state.phase).toBe("available")
      expect(state.lastFailure).toBeNull()
      expect(requests).toEqual([])
    }),
  )

  it.effect("asks for sign-in when told to connect without a token", () =>
    Effect.gen(function* () {
      const { services } = runtime(true)
      const blocked = yield* OwnerSupervisor.use((supervisor) =>
        SubscriptionRef.changes(supervisor.state).pipe(
          Stream.filter((state) => state.phase === "blocked"),
          Stream.runHead,
        ),
      ).pipe(Effect.provide(Layer.fresh(services)))
      expect(blocked._tag === "Some" && blocked.value.lastFailure?._tag).toBe("ConnectionBlockedError")
    }),
  )
})
