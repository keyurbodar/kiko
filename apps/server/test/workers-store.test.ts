import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { ConversationId } from "@earendil-works/pi-durable"
import { ended, transition, WORKERS_RUN, WORKERS_STEPS, WORKERS_TAIL, Workers } from "@kiko/agent/workers"
import { sqlWith } from "./sql-shim"

const conversation = 1 as ConversationId

function store(db = new Database(":memory:")) {
  return new Workers({ sql: sqlWith([...WORKERS_STEPS, ...WORKERS_TAIL, ...WORKERS_RUN], db) } as unknown as DurableObjectStorage, { deliver: async () => {} })
}

// The workers table as core/agent created it before the changed list and the step count.
const BEFORE_U51 = `CREATE TABLE IF NOT EXISTS workers (
  n INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL UNIQUE,
  task TEXT NOT NULL,
  conversation_id INTEGER,
  submission_id INTEGER,
  status TEXT NOT NULL,
  step TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resumes INTEGER NOT NULL DEFAULT 0
) STRICT`

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

test("a workers table from before this change reads and writes after the upgrade", () => {
  const db = new Database(":memory:")
  db.exec(BEFORE_U51)
  db.exec("INSERT INTO workers (n, id, task_id, task, conversation_id, status, delivered, origin, started_at, updated_at) VALUES (1, 'w1', 'old-task', 'older work', 1, 'done', 1, 'human', 0, 0)")
  const workers = store(db)
  const work = workers.reserve("task-2", "tidy the folder")!
  expect(work.id).toBe("w2")
  workers.placed(work.id, 2 as ConversationId)
  workers.step(2 as ConversationId, "write /a.txt")
  workers.touched(2 as ConversationId, ["/a.txt"])
  expect(workers.note()).toBe("your workers:\n- w2 (running, 1 step): tidy the folder. changed: /a.txt. last step: write /a.txt")
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
