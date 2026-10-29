import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { BACKGROUND_CONTEXT, awaitWithContext } from "@earendil-works/chord/context"
import { Harness } from "@earendil-works/pi-durable"
import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { AgentSetup } from "@kiko/agent/host"
import { AgentHost } from "@kiko/agent/host"
import type { ClockPort } from "@kiko/durable/clock-port"
import { describe, expect, it } from "vitest"
import { declareEffect } from "@kiko/agent/effects"
import { fakeSetup } from "./dev-fake"
import { INITIAL_AGENT_STEPS } from "./schema"

const context = BACKGROUND_CONTEXT

function state() {
  const db = new DatabaseSync(":memory:")
  for (const step of INITIAL_AGENT_STEPS) db.exec(step as string)
  const values = new Map<string, unknown>()
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() }
      }
      statement.run(...bindings)
      return { toArray: () => [], one: () => undefined }
    },
  }
  let depth = 0
  const storage = {
    sql,
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => {
      values.set(key, value)
    },
    delete: async (key: string | string[]) => {
      for (const one of Array.isArray(key) ? key : [key]) values.delete(one)
    },
    transactionSync: <T>(operation: () => T): T => {
      if (depth++ > 0) {
        try {
          return operation()
        } finally {
          depth--
        }
      }
      db.exec("BEGIN")
      try {
        const out = operation()
        db.exec("COMMIT")
        return out
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      } finally {
        depth--
      }
    },
  }
  return { storage, ctx: { storage, abort: () => {} } as unknown as DurableObjectState }
}

function clock(): ClockPort {
  const wakeups = new Map<string, number>()
  return {
    setWakeup: async (key, at) => {
      wakeups.set(key, at)
    },
    clearWakeup: async (key) => {
      wakeups.delete(key)
    },
    dueWakeups: async (now) => [...wakeups].filter(([, at]) => at <= now).map(([key]) => key),
    deadline: (key) => wakeups.get(key),
  }
}

function hold(started: () => void, release: Promise<void>): Extension {
  return defineExtension({
    name: "test-hold",
    tools: [
      declareEffect(
        "read",
        defineTool({
          name: "hold",
          description: "waits until the test releases it.",
          parameters: Type.Object({}),
          execute: async (_args, _api, running) => {
            started()
            await awaitWithContext(release, running)
            return { output: [{ type: "text" as const, text: "released" }] }
          },
        }),
      ),
    ],
  })
}

function hostFor(setup: AgentSetup, onIdle: () => void) {
  const { ctx } = state()
  const runs: Promise<"done" | "continue">[] = []
  let host: AgentHost | undefined
  host = new AgentHost(ctx, {
    agentKey: "juno",
    clock: clock(),
    requestRun: () => {
      runs.push(host!.runInvocation(() => false))
    },
    projectTasks: () => ({ next: undefined, resume: [] }),
    setup: () => setup,
    openHarness: (storage, planned) =>
      Harness.open(
        storage,
        { models: planned.models, registry: planned.registry, settings: planned.settings },
        context,
      ),
    onIdle,
    waitUntil: () => {},
  })
  return { host, runs }
}

const message = (seq: number, body: string) => ({
  id: `human:${seq}.abcdef`,
  from: { kind: "human" as const },
  body,
  hop: 0,
  rootId: "root",
  seq,
})

describe("agent stop", () => {
  it("skips the idle pipeline when a stop ended the turn", async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const idled: string[] = []
    const { host, runs } = hostFor(
      fakeSetup(undefined, undefined, undefined, { testExtensions: [hold(() => started.resolve(), release.promise)] }),
      () => idled.push("idle"),
    )

    await host.receive([message(1, "[ws hold {}]")], "")
    await started.promise
    await host.stop()
    release.resolve()
    await Promise.all(runs)

    expect(idled).toEqual([])
  })

  it("runs the idle pipeline when the turn ends on its own", async () => {
    const idled = Promise.withResolvers<void>()
    const { host, runs } = hostFor(fakeSetup(), () => idled.resolve())

    await host.receive([message(1, "hello")], "")
    await idled.promise
    await Promise.all(runs)

    expect(runs).toHaveLength(1)
  })
})
