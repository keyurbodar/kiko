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

  it("leave the next step to the lead when a teammate finishes a dependency", () => {
    const ws = board()
    ws.create(LEAD, { id: "a", title: "facts", owner: ANA }, MEMBERS)
    ws.markWoken("a")
    ws.create(LEAD, { id: "m", title: "merge", owner: MAX, dependsOn: ["a"] }, MEMBERS)

    ws.update({ kind: "agent", slug: ANA }, "a", { status: "done" }, MEMBERS, false)

    expect(ws.pendingWakes()).toEqual([])
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
