import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { Harness } from "@earendil-works/pi-durable"
import { JOURNAL_STEPS, JournalStorage } from "@kiko/agent/journal"
import { describe, expect, it } from "vitest"
import { Workers } from "@kiko/agent/workers"
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

function recordingRoom() {
  const errors: { runId: string; kind: string }[] = []
  const room: RoomPort = {
    post: async () => undefined,
    draft: async () => {},
    thinking: async () => {},
    note: async () => {},
    status: async () => {},
    workers: async () => {},
    endRun: async () => {},
    react: async () => undefined,
    runError: async (runId, error) => {
      errors.push({ runId, kind: error.kind })
    },
  }
  return { room, errors }
}

function talkingRoom() {
  const posts: string[] = []
  const notes: { id: string; text: string }[] = []
  const room: RoomPort = {
    post: async (_runId, _attempt, _index, block) => {
      posts.push(block)
    },
    draft: async () => {},
    thinking: async () => {},
    note: async (_runId, id, text) => {
      notes.push({ id, text })
    },
    status: async () => {},
    workers: async () => {},
    endRun: async () => {},
    react: async () => undefined,
    runError: async () => {},
  }
  return { room, posts, notes }
}

describe("Outbox", () => {
  it("reports one error row for a turn whose model is gone", async () => {
    const storage = durable()
    const journal = JournalStorage.open(storage, "room:kiko")
    const setup = fakeSetup(undefined, undefined, undefined, {
      work: new Workers(storage, { agentKey: "kiko", deliver: async () => {} }),
    })
    const harness = await Harness.open(
      journal,
      { models: setup.models, registry: setup.registry, settings: setup.settings },
      context,
    )
    const root = await harness.root(context, { agent: setup.agent })
    await root.configure({ model: { provider: "custom-gone", modelId: "missing" } }, context)
    const { room, errors } = recordingRoom()
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

  it("sends the text of a tool round as the run's note instead of a bubble", async () => {
    const storage = durable()
    const journal = JournalStorage.open(storage, "room:kiko")
    const setup = fakeSetup(undefined, undefined, undefined, {
      work: new Workers(storage, { agentKey: "kiko", deliver: async () => {} }),
    })
    const harness = await Harness.open(
      journal,
      { models: setup.models, registry: setup.registry, settings: setup.settings },
      context,
    )
    const root = await harness.root(context, { agent: setup.agent })
    await root.configure(
      { model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: setup.agent.thinkingLevel },
      context,
    )
    const { room, posts, notes } = talkingRoom()
    const outbox = new Outbox(
      storage,
      () => room,
      () => "room:kiko",
      Date.now,
      "room:kiko",
    )
    await outbox.attach(harness, root.id, journal)

    const submission = await root.submit({ type: "input", content: "[two-part] hello" }, context)
    await submission.wait(context)
    await outbox.settle(root)

    expect(notes.map((note) => note.text)).toEqual(["part one."])
    expect(posts.join("\n")).not.toContain("part one.")
    expect(posts.join("\n")).toContain("slow words")
    await harness.close(context)
  })
})
