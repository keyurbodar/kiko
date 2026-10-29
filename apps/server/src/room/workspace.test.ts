import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug, RoomEvent } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import type { RoomLog } from "./log"
import { RoomWorkspace } from "./workspace"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug
const MAX = "max" as AgentSlug
const ANA = "ana" as AgentSlug
const MEMBERS = [KIKO, MAX, ANA]
const LEAD = { kind: "agent", slug: KIKO } as const

function board() {
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
  let seq = 0
  const log = {
    roomId: ROOM,
    lastSeq: () => seq,
    append: (_actor: string, body: object) => {
      seq += 1
      return { ...body, seq, at: 0 } as RoomEvent
    },
  } as unknown as RoomLog
  return new RoomWorkspace(storage, log)
}

describe("task wakes", () => {
  it("skip a task its owner already moved to review before its dependencies finished", () => {
    const ws = board()
    ws.create(LEAD, { id: "a", title: "facts", owner: ANA }, MEMBERS)
    ws.markWoken("a")
    ws.create(LEAD, { id: "m", title: "merge", owner: MAX, dependsOn: ["a"] }, MEMBERS)
    ws.update({ kind: "agent", slug: MAX }, "m", { status: "review" }, MEMBERS, false)

    ws.update(LEAD, "a", { status: "done" }, MEMBERS, true)

    expect(ws.pendingWakes()).toEqual([])
  })

  it("wake the owner of a waiting task when a teammate, not the lead, finishes the dependency", () => {
    const ws = board()
    ws.create(LEAD, { id: "a", title: "facts", owner: ANA }, MEMBERS)
    ws.markWoken("a")
    ws.create(LEAD, { id: "m", title: "merge", owner: MAX, dependsOn: ["a"] }, MEMBERS)

    ws.update({ kind: "agent", slug: ANA }, "a", { status: "done" }, MEMBERS, false)

    expect(ws.pendingWakes()).toEqual([{ taskId: "m", owner: MAX, title: "merge", seq: 3, chain: null }])
  })

  it("wake the owner of a waiting task once the lead closes its dependencies", () => {
    const ws = board()
    ws.create(LEAD, { id: "a", title: "facts", owner: ANA }, MEMBERS)
    ws.markWoken("a")
    ws.create(LEAD, { id: "m", title: "merge", owner: MAX, dependsOn: ["a"] }, MEMBERS)

    ws.update(LEAD, "a", { status: "done" }, MEMBERS, true)

    expect(ws.pendingWakes().map((w) => w.owner)).toEqual([MAX])
  })
})

describe("cancelled dependencies", () => {
  it("treat a cancelled dependency as satisfied so its dependent can still finish", () => {
    const ws = board()
    ws.create(LEAD, { id: "a", title: "facts", owner: ANA }, MEMBERS)
    ws.update(LEAD, "a", { status: "cancelled" }, MEMBERS, true)
    ws.create(LEAD, { id: "m", title: "merge", owner: MAX, dependsOn: ["a"] }, MEMBERS)

    expect(ws.update({ kind: "agent", slug: MAX }, "m", { status: "done" }, MEMBERS, false).ok).toBe(true)
  })

  it("wake the owner of a waiting task when its dependency is cancelled", () => {
    const ws = board()
    ws.create(LEAD, { id: "a", title: "facts", owner: ANA }, MEMBERS)
    ws.markWoken("a")
    ws.create(LEAD, { id: "m", title: "merge", owner: MAX, dependsOn: ["a"] }, MEMBERS)

    ws.update(LEAD, "a", { status: "cancelled" }, MEMBERS, true)

    expect(ws.pendingWakes().map((w) => w.owner)).toEqual([MAX])
  })
})

describe("removing a task", () => {
  it("wakes the owners of the tasks that waited on it, on the removal's own event", () => {
    const ws = board()
    ws.create(LEAD, { id: "a", title: "facts", owner: ANA }, MEMBERS)
    ws.markWoken("a")
    ws.create(LEAD, { id: "m", title: "merge", owner: MAX, dependsOn: ["a"] }, MEMBERS)

    const removal = ws.remove("a")
    const [wake] = ws.pendingWakes()

    expect(wake.owner).toBe(MAX)
    expect(wake.seq).toBe(removal.ok ? removal.events[0]?.seq : -1)
  })
})

describe("assigning a task", () => {
  it("wakes an assignee the human picks on the board, and leaves the task ready rather than doing", () => {
    const ws = board()
    ws.create({ kind: "human" }, { id: "a", title: "facts" }, MEMBERS)

    const done = ws.update({ kind: "human" }, "a", { owner: MAX }, MEMBERS, true)

    expect(done.ok && done.value.status).toBe("todo")
    expect(ws.pendingWakes().map((w) => w.owner)).toEqual([MAX])
  })

  it("wakes the owner again when a finished task is reopened", () => {
    const ws = board()
    ws.create(LEAD, { id: "a", title: "facts", owner: MAX }, MEMBERS)
    ws.markWoken("a")
    ws.update(LEAD, "a", { status: "done" }, MEMBERS, true)

    ws.update(LEAD, "a", { status: "todo" }, MEMBERS, true)

    expect(ws.pendingWakes().map((w) => w.owner)).toEqual([MAX])
  })
})
