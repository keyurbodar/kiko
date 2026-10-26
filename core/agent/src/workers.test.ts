import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { ConversationId, SubmissionId } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { INITIAL_WORKERS_STEPS, MAX_WORKER_STEPS, Workers } from "./workers"

function storage() {
  const db = new DatabaseSync(":memory:")
  for (const step of INITIAL_WORKERS_STEPS) db.exec(step as string)
  const state = { written: 0 }
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }
      }
      const changes = Number(statement.run(...bindings).changes)
      state.written += changes
      return { toArray: () => [], one: () => undefined, rowsWritten: changes }
    },
  }
  return { store: { sql } as unknown as DurableObjectStorage, state }
}

const CHILD = 7 as ConversationId

function running() {
  const db = storage()
  const workers = new Workers(db.store, { deliver: async () => {}, agentKey: "juno" })
  const work = workers.reserve("task-1", "map every radar station")
  if (!work) throw new Error("no worker")
  workers.placed(work.id, CHILD)
  workers.follow(work.id, 1 as SubmissionId)
  return { workers, work, db }
}

describe("worker steps", () => {
  it("counts a worker's tool calls without writing a row per call", () => {
    const { workers, work, db } = running()
    const before = db.state.written

    expect(workers.step(CHILD, "fetch_page radar.gov")).toBe("worker")
    expect(workers.step(CHILD, "bash ls")).toBe("worker")
    expect(workers.step(99 as ConversationId, "read_file chat.md")).toBe("talker")

    expect(db.state.written).toBe(before)
    expect([workers.get(work.id)?.steps, workers.get(work.id)?.step]).toEqual([2, "bash ls"])
    expect(workers.note()).toContain("(running, 2 steps)")
    expect(workers.note()).toContain("last step: bash ls")
  })

  it("stops a worker's tool calls after the step limit", () => {
    const { workers } = running()

    const taken = Array.from({ length: MAX_WORKER_STEPS + 2 }, (_, i) => workers.step(CHILD, `step ${i}`))

    expect(MAX_WORKER_STEPS).toBe(60)
    expect(taken.filter((t) => t === "worker")).toHaveLength(MAX_WORKER_STEPS)
    expect(taken.slice(MAX_WORKER_STEPS)).toEqual(["spent", "spent"])
  })
})
