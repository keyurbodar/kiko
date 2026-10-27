import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug, WorkerRow } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { RoomLog } from "./log"
import type { HeardStep } from "./steps"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug
const WORKER = { id: "w1", task: "map every radar station" }

function room() {
  const db = new DatabaseSync(":memory:")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, one: () => rows[0], rowsWritten: 0 }
      }
      const changes = Number(statement.run(...bindings).changes)
      return { toArray: () => [], one: () => undefined, rowsWritten: changes }
    },
  } as unknown as SqlStorage
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  initializeSchema(storage)
  return new RoomLog(storage, ROOM, () => 9_000)
}

const step = (over: Partial<HeardStep> & Pick<HeardStep, "id">): HeardStep => ({
  runId: "r1",
  slug: KIKO,
  tool: "run",
  name: "bash",
  label: "Ran ls",
  status: "running",
  startedAt: 1_000,
  ...over,
})

const row = (status: WorkerRow["status"]): WorkerRow => ({
  id: WORKER.id,
  task: WORKER.task,
  status,
  step: null,
  steps: 2,
  startedAt: 1_000,
})

const statuses = (log: RoomLog) =>
  log.steps
    .window(KIKO, 0)
    .map((s) => [s.id, s.status])
    .sort(([a], [b]) => (a! < b! ? -1 : 1))

describe("a worker's steps", () => {
  it("outlive the talker's run, then end with the worker", () => {
    const log = room()
    log.hearStep(step({ id: "c1", worker: WORKER }))
    log.hearStep(step({ id: "c2", worker: WORKER, startedAt: 2_000 }))
    log.hearStep(step({ id: "t1" }))

    expect(log.steps.abandon("r1").map((s) => s.id)).toEqual(["t1"])
    expect(statuses(log)).toEqual([
      ["c1", "running"],
      ["c2", "running"],
      ["t1", "failed"],
    ])
    expect(log.endWorkers(KIKO, [row("done")]).map((s) => [s.id, s.status, s.endedAt])).toEqual([
      ["c1", "done", 9_000],
      ["c2", "done", 9_000],
    ])
    expect(statuses(log)).toEqual([
      ["c1", "done"],
      ["c2", "done"],
      ["t1", "failed"],
    ])
  })

  it("keeps a running worker's steps open and leaves a stopped worker's steps failed", () => {
    const log = room()
    log.hearStep(step({ id: "c1", worker: WORKER }))

    expect(log.endWorkers(KIKO, [row("running")])).toEqual([])
    expect(statuses(log)).toEqual([["c1", "running"]])
    expect(log.endWorkers(KIKO, [row("stopped")])).toMatchObject([{ id: "c1", status: "failed" }])
  })
})
