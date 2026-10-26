import { describe, expect, it } from "@effect/vitest"
import type { Descriptor } from "@kiko/client-runtime/connection"
import { PROTOCOL, type UpdateState } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import {
  CURRENT,
  holdOf,
  noticeOf,
  pillView,
  plan,
  runUpdate,
  skewOf,
  type UpdateBackend,
  type UpdatePhase,
} from "./update"

const at = (version: string, protocol = PROTOCOL, selfUpdate = true): Descriptor => ({
  _tag: "Current",
  kiko: 1,
  version,
  protocol,
  selfUpdate,
})
const LEGACY: Descriptor = { _tag: "Legacy", version: "0.7.8" }
const UNREACHABLE: Descriptor = { _tag: "Unreachable" }

function scripted<A>(answers: ReadonlyArray<A>) {
  let calls = 0
  return {
    next: Effect.sync(() => answers[Math.min(calls++, answers.length - 1)] as A),
    calls: () => calls,
  }
}

const backendOf = (input: {
  readonly started: UpdateState | null
  readonly states: ReadonlyArray<UpdateState | null>
  readonly descriptors: ReadonlyArray<Descriptor>
}) => {
  const started: string[] = []
  const states = scripted(input.states)
  const descriptors = scripted(input.descriptors)
  const backend: UpdateBackend = {
    start: (to) => Effect.sync(() => (started.push(to), input.started)),
    state: states.next,
    descriptor: descriptors.next,
  }
  return { backend, started, polls: descriptors.calls }
}

describe("plan", () => {
  it("starts a compatible update when the backend is on an older version of this protocol", () => {
    expect(plan(at("0.8.9"), "0.9.0")).toEqual({ _tag: "Start", to: "0.9.0", compatible: true })
  })

  it("starts an incompatible update when the backend speaks an older protocol", () => {
    expect(plan(at("0.9.0", PROTOCOL - 1), "0.9.0")).toEqual({ _tag: "Start", to: "0.9.0", compatible: false })
  })

  it("leaves an up-to-date, newer or unreachable backend alone", () => {
    expect(plan(at("0.9.0"), "0.9.0")).toEqual({ _tag: "Stay" })
    expect(plan(at("0.9.1"), "0.9.0")).toEqual({ _tag: "Stay" })
    expect(plan(at("0.9.0", PROTOCOL + 1), "0.9.0")).toEqual({ _tag: "Stay" })
    expect(plan(UNREACHABLE, "0.9.0")).toEqual({ _tag: "Stay" })
  })

  it("sends a legacy backend, or one that cannot update itself, to reconnect Cloudflare", () => {
    expect(plan(LEGACY, "0.9.0")).toEqual({ _tag: "Reconnect", reason: "legacy" })
    expect(plan(at("0.8.9", PROTOCOL, false), "0.9.0")).toEqual({ _tag: "Reconnect", reason: "no_grant" })
  })
})

describe("runUpdate", () => {
  it.effect("polls every 2 seconds and lands once the backend reports the target version", () =>
    Effect.gen(function* () {
      const { backend, started, polls } = backendOf({
        started: { stage: "uploading", to: "0.9.0" },
        states: [{ stage: "uploading", to: "0.9.0" }, { stage: "restarting", to: "0.9.0" }, { stage: "idle" }],
        descriptors: [at("0.8.9"), at("0.8.9"), at("0.9.0")],
      })
      let restarts = 0
      const fiber = yield* runUpdate(
        backend,
        "0.9.0",
        Effect.sync(() => void restarts++),
      ).pipe(Effect.forkChild)
      yield* TestClock.adjust("4 seconds")
      expect(fiber.pollUnsafe()).toBeUndefined()
      expect(polls()).toBe(2)
      yield* TestClock.adjust("2 seconds")
      expect(yield* Fiber.join(fiber)).toEqual(CURRENT)
      expect(started).toEqual(["0.9.0"])
      expect(restarts).toBe(1)
    }),
  )

  it.effect("stops at a refused grant and asks for a Cloudflare reconnect", () =>
    Effect.gen(function* () {
      const { backend, polls } = backendOf({
        started: { stage: "uploading", to: "0.9.0" },
        states: [{ stage: "failed", to: "0.9.0", error: "grant_refused", message: "Cloudflare refused." }],
        descriptors: [at("0.8.9")],
      })
      const fiber = yield* runUpdate(backend, "0.9.0", Effect.void).pipe(Effect.forkChild)
      yield* TestClock.adjust("2 seconds")
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "NeedsReconnect", reason: "grant_refused" })
      expect(polls()).toBe(0)
    }),
  )

  it.effect("keeps any other failure retryable", () =>
    Effect.gen(function* () {
      const { backend } = backendOf({
        started: { stage: "uploading", to: "0.9.0" },
        states: [{ stage: "failed", to: "0.9.0", error: "release_unavailable", message: "Try again." }],
        descriptors: [at("0.8.9")],
      })
      const fiber = yield* runUpdate(backend, "0.9.0", Effect.void).pipe(Effect.forkChild)
      yield* TestClock.adjust("2 seconds")
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Failed", to: "0.9.0", error: "release_unavailable" })
    }),
  )

  it.effect("gives up after three minutes without the new version", () =>
    Effect.gen(function* () {
      const { backend } = backendOf({
        started: { stage: "uploading", to: "0.9.0" },
        states: [{ stage: "restarting", to: "0.9.0" }],
        descriptors: [at("0.8.9")],
      })
      const fiber = yield* runUpdate(backend, "0.9.0", Effect.void).pipe(Effect.forkChild)
      yield* TestClock.adjust("179 seconds")
      expect(fiber.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(fiber)).toEqual({ _tag: "Failed", to: "0.9.0", error: "timeout" })
    }),
  )

  it.effect("fails at once, without polling, when the start never reaches the backend", () =>
    Effect.gen(function* () {
      const { backend, polls } = backendOf({ started: null, states: [null], descriptors: [at("0.8.9")] })
      expect(yield* runUpdate(backend, "0.9.0", Effect.void)).toEqual({
        _tag: "Failed",
        to: "0.9.0",
        error: "unreachable",
      })
      expect(polls()).toBe(0)
    }),
  )
})

describe("holdOf", () => {
  it("holds the chats while the connection is blocked by the backend's version", () => {
    expect(holdOf({ connected: false, blocked: "backend-behind", descriptor: undefined })).toBe("backend-behind")
    expect(holdOf({ connected: false, blocked: "app-behind", descriptor: at("0.9.0") })).toBe("app-behind")
  })

  it("keeps holding through a dropped connection while the descriptor is incompatible", () => {
    expect(holdOf({ connected: false, blocked: null, descriptor: LEGACY })).toBe("backend-behind")
    expect(holdOf({ connected: false, blocked: null, descriptor: at("0.9.0", PROTOCOL - 1) })).toBe("backend-behind")
    expect(holdOf({ connected: false, blocked: null, descriptor: at("0.9.0", PROTOCOL + 1) })).toBe("app-behind")
  })

  it("never holds a connected app, a compatible backend or an unknown one", () => {
    expect(holdOf({ connected: true, blocked: null, descriptor: LEGACY })).toBeNull()
    expect(holdOf({ connected: false, blocked: null, descriptor: at("0.8.9") })).toBeNull()
    expect(holdOf({ connected: false, blocked: null, descriptor: UNREACHABLE })).toBeNull()
    expect(holdOf({ connected: false, blocked: null, descriptor: undefined })).toBeNull()
  })
})

describe("noticeOf", () => {
  const updating: UpdatePhase = { _tag: "Updating", to: "0.9.0", stage: "uploading", compatible: false }

  it("says nothing unless the chats are held", () => {
    expect(noticeOf(null, updating)).toBeNull()
  })

  it("asks for a reload when the app is the one behind", () => {
    expect(noticeOf("app-behind", updating)).toEqual({ kind: "reload" })
  })

  it("follows the update while the backend is behind", () => {
    expect(noticeOf("backend-behind", CURRENT)).toEqual({ kind: "checking" })
    expect(noticeOf("backend-behind", updating)).toEqual({ kind: "updating" })
    expect(noticeOf("backend-behind", { _tag: "NeedsReconnect", reason: "legacy" })).toEqual({
      kind: "reconnect",
      reason: "legacy",
    })
    expect(noticeOf("backend-behind", { _tag: "Failed", to: "0.9.0", error: "timeout" })).toEqual({ kind: "retry" })
  })
})

describe("pillView", () => {
  const restarting: UpdatePhase = { _tag: "Updating", to: "0.9.0", stage: "restarting", compatible: true }
  const failed: UpdatePhase = { _tag: "Failed", to: "0.9.0", error: "cloudflare_error" }
  const reconnect: UpdatePhase = { _tag: "NeedsReconnect", reason: "no_grant" }

  it("shows a running update even while the chats are held", () => {
    expect(pillView(restarting, true, false)).toEqual({ kind: "busy", text: "Restarting" })
  })

  it("leaves actions to the composer line while the chats are held", () => {
    expect(pillView(failed, true, true)).toEqual({ kind: "none" })
    expect(pillView(reconnect, true, true)).toEqual({ kind: "none" })
    expect(pillView(CURRENT, true, true)).toEqual({ kind: "none" })
  })

  it("offers the next step while connected", () => {
    expect(pillView(failed, false, false)).toEqual({ kind: "failed" })
    expect(pillView(reconnect, false, false)).toEqual({ kind: "reconnect" })
    expect(pillView(CURRENT, false, true)).toEqual({ kind: "update" })
    expect(pillView(CURRENT, false, false)).toEqual({ kind: "none" })
  })
})

describe("skewOf", () => {
  it("reads what the descriptor says about this app's version", () => {
    expect(skewOf(at("0.9.0"), "0.9.0")).toBe("ok")
    expect(skewOf(at("0.8.9"), "0.9.0")).toBe("update")
    expect(skewOf(at("0.9.0", PROTOCOL - 1), "0.9.0")).toBe("blocked")
    expect(skewOf(LEGACY, "0.9.0")).toBe("blocked")
    expect(skewOf(UNREACHABLE, "0.9.0")).toBeUndefined()
    expect(skewOf(undefined, "0.9.0")).toBeUndefined()
  })
})
