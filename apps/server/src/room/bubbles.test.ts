import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug, RunRef } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { Bubbles } from "./bubbles"
import { RoomLog } from "./log"
import { Members } from "./members"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug

function room() {
  const queries: string[] = []
  const db = new DatabaseSync(":memory:")
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      queries.push(query)
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
  const log = new RoomLog(storage, ROOM, () => 9_000)
  new Members(storage, log).seed([{ slug: KIKO, name: "Kiko" }])
  const bubbles = new Bubbles(storage, log, () => null)
  queries.length = 0
  return { bubbles, log, queries }
}

const run = (attempt: number, index = 0): RunRef => ({ runId: "run-1", attempt, index })

describe("a bubble post", () => {
  it("stores one message and ignores the same bubble again", () => {
    const { bubbles } = room()
    expect(bubbles.post(KIKO, run(0), "hello").map((e) => e.t)).toEqual(["message"])
    expect(bubbles.post(KIKO, run(0), "hello")).toEqual([])
  })

  it("does not scan earlier attempts on a first attempt", () => {
    const { bubbles, queries } = room()
    bubbles.post(KIKO, run(0), "hello")
    bubbles.post(KIKO, run(0), "hello")

    expect(queries.filter((q) => q.includes("run_attempt <"))).toHaveLength(0)
    expect(queries.filter((q) => q.includes("MAX(run_attempt)"))).toHaveLength(1)
  })

  it("remembers that a run has ended", () => {
    const { bubbles, queries } = room()
    expect(bubbles.ended("run-1")).toBe(false)
    bubbles.post(KIKO, run(0), "hello")
    queries.length = 0

    expect(bubbles.ended("run-1")).toBe(true)
    expect(bubbles.ended("run-1")).toBe(true)
    expect(queries.filter((q) => q.includes("LIMIT 1"))).toHaveLength(0)
  })

  it("replaces the bubbles of an earlier attempt", () => {
    const { bubbles, log } = room()
    const first = bubbles.post(KIKO, run(0, 0), "first")[0]!
    bubbles.post(KIKO, run(0, 1), "second")

    const events = bubbles.post(KIKO, run(1, 0), "third")
    const deleted = events[0]!

    expect(events.map((e) => e.t)).toEqual(["delete", "message"])
    expect(deleted.t === "delete" ? deleted.messageIds : []).toHaveLength(2)
    expect(log.message(first.t === "message" ? first.id : "")).toBeNull()
  })

  it("ignores a bubble from a stale attempt", () => {
    const { bubbles } = room()
    bubbles.post(KIKO, run(1), "newer")

    expect(bubbles.post(KIKO, run(0), "older")).toEqual([])
  })

  it("adopts an earlier bubble with the same text instead of posting again", () => {
    const { bubbles, queries } = room()
    bubbles.post(KIKO, run(0), "same")
    queries.length = 0

    expect(bubbles.post(KIKO, run(1), "same")).toEqual([])
    expect(queries.filter((q) => q.includes("run_attempt <"))).toHaveLength(1)
  })

  it("settles by deleting the messages of earlier attempts", () => {
    const { bubbles, log } = room()
    const first = bubbles.post(KIKO, run(0, 0), "first")[0]!
    bubbles.post(KIKO, run(1, 1), "second")

    const settled = bubbles.settle(KIKO, "run-1")

    expect(settled?.t).toBe("delete")
    expect(log.message(first.t === "message" ? first.id : "")).toBeNull()
  })

  it("bounds its run cache and answers settled runs from storage", () => {
    const { bubbles, queries } = room()
    bubbles.post(KIKO, { runId: "run-0", attempt: 1, index: 0 }, "hello 0")
    for (let i = 1; i < 300; i += 1) bubbles.post(KIKO, { runId: `run-${i}`, attempt: 0, index: 0 }, `hello ${i}`)
    queries.length = 0

    expect(bubbles.post(KIKO, { runId: "run-0", attempt: 0, index: 0 }, "stale")).toEqual([])
    expect(bubbles.ended("run-0")).toBe(true)
    expect(bubbles.ended("run-0")).toBe(true)
    expect(queries.filter((q) => q.includes("MAX(run_attempt)"))).toHaveLength(1)
    expect(queries.filter((q) => q.includes("LIMIT 1"))).toHaveLength(1)
  })
})
