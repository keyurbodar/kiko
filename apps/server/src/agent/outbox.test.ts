import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Harness } from "@earendil-works/pi-durable"
import { JOURNAL_STEPS, JournalStorage } from "@kiko/agent/journal"
import { describe, expect, it } from "vitest"
import { fakeSetup } from "./dev-fake"
import { Outbox, type RoomPort } from "./outbox"

const context = BACKGROUND_CONTEXT

function durable(): DurableObjectStorage {
  const db = new DatabaseSync(":memory:")
  for (const step of JOURNAL_STEPS) db.exec(step as string)
  db.exec("CREATE TABLE messages (room_id TEXT, run_id TEXT, run_attempt INTEGER, run_index INTEGER)")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      const reads = statement.columns().length > 0
      const rows = reads ? statement.all(...bindings) : []
      const rowsWritten = reads ? 0 : Number(statement.run(...bindings).changes)
      return { toArray: () => rows, one: () => rows[0], rowsWritten, [Symbol.iterator]: () => rows.values() }
    },
  }
  return { sql, transactionSync: <T>(run: () => T) => run() } as unknown as DurableObjectStorage
}

function recordingRoom(storage: DurableObjectStorage, agent = "room:kiko") {
  const roomId = agent.split(":")[0]!
  const errors: { runId: string; kind: string }[] = []
  const ended: string[] = []
  const posted: string[] = []
  const room: RoomPort = {
    post: async (runId, attempt, index) => {
      posted.push(`${runId}:${index}`)
      storage.sql.exec(
        "INSERT INTO messages (room_id, run_id, run_attempt, run_index) VALUES (?, ?, ?, ?)",
        roomId,
        runId,
        attempt,
        index,
      )
    },
    thinking: async () => {},
    note: async () => {},
    status: async () => {},
    workers: async () => {},
    endRun: async (runId) => {
      ended.push(runId)
    },
    react: async () => undefined,
    runError: async (runId, error) => {
      errors.push({ runId, kind: error.kind })
    },
  }
  return { room, errors, ended, posted }
}

async function opened() {
  const storage = durable()
  const journal = JournalStorage.open(storage, "room:kiko")
  const setup = fakeSetup()
  const harness = await Harness.open(
    journal,
    { models: setup.models, registry: setup.registry, settings: setup.settings },
    context,
  )
  harness.resume()
  const root = await harness.root(context, { agent: setup.agent })
  await setup.beginRun({ requestId: "first", envelopes: [], briefs: [] }, root)
  return { storage, journal, harness, root }
}

describe("Outbox", () => {
  it("reports one error row for a turn whose model is gone", async () => {
    const storage = durable()
    const journal = JournalStorage.open(storage, "room:kiko")
    const setup = fakeSetup()
    const harness = await Harness.open(
      journal,
      { models: setup.models, registry: setup.registry, settings: setup.settings },
      context,
    )
    const root = await harness.root(context, { agent: setup.agent })
    await root.configure({ model: { provider: "custom-gone", modelId: "missing" } }, context)
    const { room, errors } = recordingRoom(storage)
    const outbox = new Outbox(
      storage,
      () => room,
      () => "room:kiko",
      Date.now,
      "room:kiko",
    )
    await outbox.attach(harness, root.id, journal)

    const submission = await root.submit({ type: "input", content: "ping" }, context)
    expect(await submission.wait(context)).toMatchObject({ status: "unanswered", reason: "no_model" })
    await outbox.settle(root)

    expect(errors).toEqual([{ runId: `room:kiko:${submission.id}`, kind: "model_not_found" }])
    await harness.close(context)
  })

  it("ends only the newest finished run and reposts nothing when a conversation reopens", async () => {
    const { storage, journal, harness, root } = await opened()
    const live = recordingRoom(storage)
    const outbox = new Outbox(
      storage,
      () => live.room,
      () => "room:kiko",
      Date.now,
      "room:kiko",
    )
    await outbox.attach(harness, root.id, journal)

    const one = await root.submit({ type: "input", content: "one" }, context)
    expect(await one.wait(context)).toMatchObject({ status: "done" })
    const two = await root.submit({ type: "input", content: "two" }, context)
    expect(await two.wait(context)).toMatchObject({ status: "done" })
    await outbox.settle(root)
    expect(live.ended).toEqual([`room:kiko:${one.id}`, `room:kiko:${two.id}`])

    const reopened = recordingRoom(storage)
    const after = new Outbox(
      storage,
      () => reopened.room,
      () => "room:kiko",
      Date.now,
      "room:kiko",
    )
    await after.attach(harness, root.id, journal)

    expect(reopened.ended).toEqual([`room:kiko:${two.id}`])
    expect(reopened.posted).toEqual([])
    await harness.close(context)
  })

  it("settles from the newest entry instead of reading the whole context", async () => {
    const { storage, journal, harness, root } = await opened()
    const { room } = recordingRoom(storage)
    const outbox = new Outbox(
      storage,
      () => room,
      () => "room:kiko",
      Date.now,
      "room:kiko",
    )
    await outbox.attach(harness, root.id, journal)
    const submission = await root.submit({ type: "input", content: "ping" }, context)
    expect(await submission.wait(context)).toMatchObject({ status: "done" })
    await outbox.settle(root)

    const calls: string[] = []
    const watched = new Proxy(root, {
      get(target, key) {
        const value = Reflect.get(target, key, target)
        if (typeof value !== "function") return value
        return (...args: unknown[]) => {
          if (key === "entries" || key === "context") calls.push(String(key))
          return (value as (...rest: unknown[]) => unknown).apply(target, args)
        }
      },
    })

    await outbox.settle(watched)
    expect(calls).toEqual(["entries"])
    await harness.close(context)
  })
})
