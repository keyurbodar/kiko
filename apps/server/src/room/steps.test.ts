import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug, RunStep, WorkerRow } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { RoomLog } from "./log"
import { type HeardStep, STEP_LOG_BYTES, stepLog } from "./steps"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug
const WORKER = { id: "w1", task: "map every radar station" }

function store() {
  const db = new DatabaseSync(":memory:")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      if (!bindings.length && query.includes(";")) {
        db.exec(query)
        return { toArray: () => [], one: () => undefined, rowsWritten: 0 }
      }
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
  return storage
}

function room(storage = store()) {
  return { storage, log: new RoomLog(storage, ROOM, () => 9_000) }
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
    .live(KIKO, 0)
    .map((s) => [s.id, s.status])
    .sort(([a], [b]) => (a! < b! ? -1 : 1))

describe("a worker's steps", () => {
  it("outlive the talker's run, then end with the worker", () => {
    const { log } = room()
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
    const { log } = room()
    log.hearStep(step({ id: "c1", worker: WORKER }))

    expect(log.endWorkers(KIKO, [row("running")])).toEqual([])
    expect(statuses(log)).toEqual([["c1", "running"]])
    expect(log.endWorkers(KIKO, [row("stopped")])).toMatchObject([{ id: "c1", status: "failed" }])
  })
})

describe("a finished step", () => {
  it("writes no run_steps row and lives only in the window until a message closes it", () => {
    const { log } = room()
    log.hearStep(step({ id: "t1" }))
    log.hearStep(step({ id: "t1", status: "done" }))

    expect(log.steps.window(KIKO, 0)).toEqual([])
    expect(statuses(log)).toEqual([["t1", "done"]])

    const { event } = log.addMessage({
      from: { kind: "agent", slug: KIKO },
      text: "done",
      run: { runId: "r1", attempt: 0, index: 0 },
    })
    expect(event?.t).toBe("message")
    expect(log.steps.live(KIKO, 0)).toEqual([])
    expect(log.storedSteps(0)?.map((s) => [s.id, s.status])).toEqual([["t1", "done"]])
  })

  it("does not duplicate when the journal pushes the same finished cards again after an eviction", () => {
    const { storage, log } = room()
    log.hearStep(step({ id: "t1" }))
    log.hearStep(step({ id: "t1", status: "done" }))
    log.hearStep(step({ id: "t1", status: "done" }))

    expect(log.steps.live(KIKO, 0).map((s) => s.id)).toEqual(["t1"])

    const reopened = new RoomLog(storage, ROOM, () => 9_000)
    for (const pushed of [step({ id: "t1", status: "done" }), step({ id: "t2", status: "done" })])
      reopened.hearStep(pushed)
    expect(reopened.steps.live(KIKO, 0).map((s) => s.id)).toEqual(["t1", "t2"])
  })
})

describe("a step log on a message row", () => {
  const card = (id: string, input: string, output: string): RunStep => ({
    id,
    runId: "r1",
    slug: KIKO,
    tool: "run",
    name: "bash",
    label: `Ran ${id}`,
    input,
    status: "done",
    startedAt: Number(id) || 1,
    endedAt: (Number(id) || 1) + 5,
    output,
    after: 0,
  })

  it("keeps the newest cards when the log would grow past its cap", () => {
    const many = Array.from({ length: 60 }, (_, i) => card(String(i + 1), "x ".repeat(4_000), "y ".repeat(4_000)))
    const raw = stepLog(many)
    expect(raw).not.toBeNull()
    const kept = JSON.parse(raw!) as RunStep[]
    expect(Buffer.byteLength(raw!, "utf8")).toBeLessThanOrEqual(STEP_LOG_BYTES)
    expect(kept.at(-1)?.id).toBe("60")
    expect(kept.length).toBeLessThan(many.length)
    const ids = kept.map((s) => Number(s.id))
    expect(ids).toEqual(ids.toSorted((a, b) => a - b))
  })

  it("carries no image bytes", () => {
    const raw = stepLog([card("1", "data:image/png;base64,AAAA", `shot data:image/jpeg;base64,${"B".repeat(2_000)}`)])
    expect(raw).not.toContain("data:image")
    expect(raw).toContain("[image]")
  })

  it("is null when the window has no steps", () => {
    expect(stepLog([])).toBeNull()
  })
})
