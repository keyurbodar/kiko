import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { ConversationId, EntryId, StorageWrite, SubmissionId, TaskId } from "@earendil-works/pi-durable"
import type { ClockPort } from "@kiko/durable/clock-port"
import { describe, expect, it } from "vitest"
import { AgentHost, INITIAL_HOST_STEPS, type AgentSetup } from "./host"
import { JOURNAL_STEPS, JournalStorage } from "./journal"

const context = BACKGROUND_CONTEXT
const AGENT = "room:kiko"
const CONVERSATION = 1 as ConversationId
const TASK = 3 as TaskId
const SUBMISSION = 4 as SubmissionId
const REPLAY = "SELECT seq, part, parts, bytes, data FROM journal WHERE agent = ?"

function state() {
  const db = new DatabaseSync(":memory:")
  for (const step of [...INITIAL_HOST_STEPS, ...JOURNAL_STEPS]) db.exec(step as string)
  const queries: string[] = []
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      queries.push(query)
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0], [Symbol.iterator]: () => rows[Symbol.iterator]() }
      }
      statement.run(...bindings)
      return { toArray: () => [], one: () => undefined, [Symbol.iterator]: () => [][Symbol.iterator]() }
    },
  }
  const storage = { sql, transactionSync: <T>(operation: () => T): T => operation() } as unknown as DurableObjectStorage
  return { storage, replays: () => queries.filter((query) => query.startsWith(REPLAY)).length }
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

function host(storage: DurableObjectStorage): AgentHost {
  return new AgentHost({ storage, abort: () => {} } as unknown as DurableObjectState, {
    agentKey: AGENT,
    clock: clock(),
    requestRun: () => {},
    projectTasks: () => ({ next: undefined, resume: [] }),
    setup: () => ({}) as unknown as AgentSetup,
    waitUntil: () => {},
  })
}

async function seed(storage: DurableObjectStorage, writes: readonly StorageWrite[]): Promise<void> {
  const journal = JournalStorage.open(storage, AGENT)
  await journal.commit(writes, context)
  await journal.close(context)
}

function task(status: "pending" | "terminal"): StorageWrite {
  return {
    type: "task",
    value: {
      id: TASK,
      conversationId: CONVERSATION,
      kind: "test",
      version: 1,
      input: null,
      background: false,
      abortRequested: false,
      state:
        status === "pending"
          ? { status, checkpoint: null }
          : { status, outcome: { status: "completed", result: null } },
    },
  } as unknown as StorageWrite
}

function submission(status: "queued" | "done"): StorageWrite {
  return {
    type: "submission",
    value:
      status === "queued"
        ? { id: SUBMISSION, conversationId: CONVERSATION, type: "input", status, requestId: "req" }
        : {
            id: SUBMISSION,
            conversationId: CONVERSATION,
            type: "input",
            status,
            requestId: "req",
            entry: 5 as EntryId,
            answer: 6 as EntryId,
          },
  } as unknown as StorageWrite
}

describe("agent host recovery", () => {
  it("finds an unfinished run from a fresh instance", async () => {
    const { storage } = state()
    await seed(storage, [task("pending")])
    expect(await host(storage).unfinished()).toBe(true)
  })

  it("finds a pending burst from a fresh instance", async () => {
    const { storage } = state()
    await seed(storage, [submission("queued")])
    expect(await host(storage).unfinished()).toBe(true)
  })

  it("reports a settled journal as finished from a fresh instance", async () => {
    const { storage } = state()
    await seed(storage, [task("terminal"), submission("done")])
    expect(await host(storage).unfinished()).toBe(false)
  })

  it("replays the journal once for repeated probes", async () => {
    const { storage, replays } = state()
    await seed(storage, [task("pending")])
    const before = replays()
    const probe = host(storage)
    expect(await probe.unfinished()).toBe(true)
    expect(await probe.unfinished()).toBe(true)
    expect(await probe.unfinished()).toBe(true)
    expect(replays() - before).toBe(1)
  })

  it("keeps a shared journal usable after a harness closes it", async () => {
    const { storage } = state()
    const journal = JournalStorage.open(storage, AGENT, true)
    await journal.commit([task("pending")], context)
    await journal.close(context)
    await journal.commit([submission("queued")], context)
    expect((await journal.scanSubmissions({ status: "queued" }, 10, undefined, context)).items).toHaveLength(1)
    await journal.close(context)
    const fresh = JournalStorage.open(storage, AGENT)
    expect((await fresh.scanTasks({ status: "pending" }, 10, undefined, context)).items).toHaveLength(1)
    expect((await fresh.scanSubmissions({ status: "queued" }, 10, undefined, context)).items).toHaveLength(1)
  })
})
