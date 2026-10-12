import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { ConversationId } from "@earendil-works/pi-durable"
import { WORKERS_STEPS, WORKERS_TAIL, Workers } from "@yuki/agent/workers"
import { sqlWith } from "./sql-shim"

const conversation = 1 as ConversationId

function store(db = new Database(":memory:")) {
  return new Workers({ sql: sqlWith([...WORKERS_STEPS, ...WORKERS_TAIL], db) } as unknown as DurableObjectStorage, { deliver: async () => {} })
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
