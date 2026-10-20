import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { ConversationId } from "@earendil-works/pi-durable"
import { ended, transition, INITIAL_WORKERS_STEPS, Workers } from "@kiko/agent/workers"
import { sqlWith } from "./sql-shim"

const conversation = 1 as ConversationId

function store(db = new Database(":memory:")) {
  return new Workers({ sql: sqlWith(INITIAL_WORKERS_STEPS, db) } as unknown as DurableObjectStorage, { agentKey: "agent", deliver: async () => {} })
}

test("a worker names its first 20 changed paths and how many more; a path it changes again counts once", () => {
  const workers = store()
  const work = workers.reserve("task-1", "tidy the folder")!
  workers.placed(work.id, conversation)
  const paths = Array.from({ length: 25 }, (_, i) => `/f${i}.txt`)
  workers.touched(conversation, paths)
  workers.touched(conversation, [paths[0]!, paths[24]!])
  expect(workers.note()).toBe(`your workers:\n- w1 (running, 0 steps): tidy the folder. changed: ${paths.slice(0, 20).join(", ")} and 5 more.`)
})

test("a replayed tool result adds no path", () => {
  const workers = store()
  const work = workers.reserve("task-1", "tidy the folder")!
  workers.placed(work.id, conversation)
  workers.touched(conversation, ["/a.txt", "/b.txt"])
  workers.touched(conversation, ["/a.txt"])
  expect(workers.note()).toBe("your workers:\n- w1 (running, 0 steps): tidy the folder. changed: /a.txt, /b.txt.")
})

test("two agents keep independent worker ids and changed paths in one database", () => {
  const db = new Database(":memory:")
  try {
    const sql = sqlWith(INITIAL_WORKERS_STEPS, db)
    const storage = { sql } as unknown as DurableObjectStorage
    const first = new Workers(storage, { agentKey: "one", deliver: async () => {} })
    const second = new Workers(storage, { agentKey: "two", deliver: async () => {} })
    const one = first.reserve("task", "first")!
    const two = second.reserve("task", "second")!
    expect(one.id).toBe("w1")
    expect(two.id).toBe("w1")
    first.placed(one.id, conversation)
    second.placed(two.id, conversation)
    first.touched(conversation, ["/one.txt"])
    second.touched(conversation, ["/two.txt"])
    expect(first.note()).toContain("/one.txt")
    expect(first.note()).not.toContain("/two.txt")
    expect(second.note()).toContain("/two.txt")
  } finally { db.close() }
})

test("a worker's report loses the harness's own diagnostics", async () => {
  const { plainReport } = await import("@kiko/agent/workers")
  expect(plainReport("<harness>\n[error] Tool mkdir is not available\n</harness>")).toBe("")
  expect(plainReport("Listed 3 files.\n<harness>\n[error] Tool x is not available\n</harness>\nDone.")).toBe("Listed 3 files.\n\nDone.")
})

test("a worker holds its slot from the moment it is reserved, so a fourth is refused before any runs", () => {
  const workers = store()
  for (const task of ["one", "two", "three"]) expect(workers.reserve(`task-${task}`, task)).not.toBeNull()
  expect(workers.reserve("task-four", "four")).toBeNull()
  expect(workers.list().map((w) => w.status)).toEqual(["pending", "pending", "pending"])
})

test("an ended worker takes no event but a submit, so a late report cannot reopen it", () => {
  expect(transition("done", "stop")).toBe("done")
  expect(transition("done", "lose")).toBe("done")
  expect(transition("stopped", "done")).toBe("stopped")
  expect(transition("failed", "stop")).toBe("failed")
  expect(transition("done", "submit")).toBe("running")
  expect(ended("pending")).toBe(false)
  expect(ended("running")).toBe(false)
  for (const status of ["done", "failed", "stopped"] as const) expect(ended(status)).toBe(true)
})

test("a reserved worker that is stopped before it is placed never runs", async () => {
  const workers = store()
  const work = workers.reserve("task-1", "tidy the folder")!
  expect((await workers.stop(work.id))?.status).toBe("stopped")
  expect(await workers.stop(work.id)).toMatchObject({ status: "stopped" })
  workers.placed(work.id, conversation)
  expect(workers.get(work.id)?.status).toBe("stopped")
})
