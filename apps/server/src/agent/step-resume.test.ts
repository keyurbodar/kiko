import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { BACKGROUND_CONTEXT, awaitWithContext } from "@earendil-works/chord/context"
import { Harness, defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import { Type } from "@earendil-works/pi-ai"
import { AgentHost, type AgentSetup } from "@kiko/agent/host"
import { declareEffect } from "@kiko/agent/effects"
import type { ClockPort } from "@kiko/durable/clock-port"
import type { AgentSlug, RunStep } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { RunSteps } from "../room/steps"
import { fakeSetup } from "./dev-fake"
import { INITIAL_AGENT_STEPS } from "./schema"
import { resumedSteps } from "./step-log"
import type { StepItem, StepsPort } from "./extensions/presence"

const context = BACKGROUND_CONTEXT
const ROOM = "room"
const KIKO = "kiko" as AgentSlug

type State = ReturnType<typeof state>

function state(db = new DatabaseSync(":memory:")): {
  db: DatabaseSync
  storage: DurableObjectStorage
  ctx: DurableObjectState
} {
  if (Number(db.prepare("SELECT count(*) AS n FROM sqlite_master").get()?.["n"] ?? 0) === 0)
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
  return {
    db,
    storage: storage as unknown as DurableObjectStorage,
    ctx: { storage, abort: () => {} } as unknown as DurableObjectState,
  }
}

function clone(from: State): State {
  const next = new DatabaseSync(":memory:")
  for (const step of INITIAL_AGENT_STEPS) next.exec(step as string)
  const tables = from.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  for (const { name } of tables) {
    const rows = from.db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, SQLInputValue>[]
    for (const row of rows) {
      const keys = Object.keys(row)
      next
        .prepare(
          `INSERT OR IGNORE INTO "${name}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
        )
        .run(...keys.map((k) => row[k] as SQLInputValue))
    }
  }
  return state(next)
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

function hostFor(current: State, setup: AgentSetup) {
  const runs: Promise<"done" | "continue">[] = []
  let host: AgentHost | undefined
  host = new AgentHost(current.ctx, {
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
    onIdle: async () => {},
    waitUntil: () => {},
  })
  return { host, runs }
}

function into(cards: RunSteps): StepsPort {
  return {
    scope: () => ({ runId: "run:1" }),
    push: (item: StepItem) => {
      const heard = { ...item.step, slug: KIKO }
      if (heard.status === "running") cards.start(heard, 0)
      else cards.finish(heard, 0)
    },
  }
}

const message = (seq: number, body: string) => ({
  id: `human:${seq}.abcdef`,
  from: { kind: "human" as const },
  body,
  hop: 0,
  rootId: "root",
  seq,
})

const shown = (cards: RunSteps) => cards.live(KIKO, 0).map((s: RunStep) => [s.id, s.status])

describe("steps after an eviction", () => {
  it("rebuilds a window's finished cards from the journal, once, when the run was cut before its reply", async () => {
    const first = state()
    const seen: RunStep[] = []
    const one = hostFor(
      first,
      fakeSetup(undefined, undefined, undefined, {
        presence: {
          scope: () => ({ runId: "run:1" }),
          push: (item) => seen.push({ ...item.step, slug: KIKO, after: 0 }),
        },
      }),
    )
    await one.host.receive([message(1, "[fetch] a page")], "")
    await Promise.all(one.runs)
    const broadcast = seen.filter((s) => s.status === "done").map((s) => s.id)
    expect(broadcast).toHaveLength(1)

    const second = clone(first)
    const cards = new RunSteps(second.storage, ROOM, () => 9_000)
    const two = hostFor(second, fakeSetup())
    const opened = await two.host.open()
    const view = await opened.root.context(context)
    const input = view.entries.findLast((entry) => entry.kind === "kiko.input")?.id ?? 0
    const port = into(cards)
    const items = await resumedSteps(opened.harness, opened.root, { input }, [], port.scope)
    for (const item of items) port.push(item)
    for (const item of items) port.push(item)

    expect(shown(cards)).toEqual([[broadcast[0], "done"]])
  })

  it("keeps the card the owner already saw when the run resumes, without duplicates", async () => {
    const first = state()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const cards = new RunSteps(first.storage, ROOM, () => 9_000)
    const one = hostFor(
      first,
      fakeSetup(undefined, undefined, undefined, {
        presence: into(cards),
        testExtensions: [hold(() => started.resolve(), release.promise)],
      }),
    )
    await one.host.receive([message(1, "[tool hold {}]")], "")
    await started.promise
    const [before] = shown(cards)
    expect(before?.[1]).toBe("running")

    const second = clone(first)
    release.resolve()
    await Promise.all(one.runs)

    const resumed = new RunSteps(second.storage, ROOM, () => 9_000)
    const two = hostFor(
      second,
      fakeSetup(undefined, undefined, undefined, {
        presence: into(resumed),
        testExtensions: [hold(() => {}, Promise.resolve())],
      }),
    )
    await two.host.runInvocation(() => false)

    expect(shown(resumed)).toEqual([[before?.[0], "done"]])
  })
})
