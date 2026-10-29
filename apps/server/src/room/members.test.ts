import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug, RoomEvent } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import type { RoomLog } from "./log"
import { Members } from "./members"
import { RoomWorkspace } from "./workspace"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug
const ANA = "ana" as AgentSlug
const MAX = "max" as AgentSlug

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
  let seq = 0
  const log = {
    roomId: ROOM,
    lastSeq: () => seq,
    append: (_actor: string, body: object) => {
      seq += 1
      return { ...body, seq, at: seq * 1_000 } as RoomEvent
    },
  } as unknown as RoomLog
  const members = new Members(storage, log)
  members.seed([
    { slug: KIKO, name: "Kiko" },
    { slug: ANA, name: "Ana" },
    { slug: MAX, name: "Max" },
  ])
  return { members, workspace: new RoomWorkspace(storage, log), sql }
}

describe("removing a member", () => {
  it("leaves no task, ask or lease pointing at the member that left", () => {
    const { members, workspace, sql } = room()
    workspace.create({ kind: "agent", slug: KIKO }, { id: "a", title: "facts", owner: ANA }, [KIKO, ANA, MAX])
    sql.exec(
      "INSERT INTO agent_asks (id, asker, askee, at, state, message_id, room_id) VALUES ('q1', ?1, ?2, 1, 'closed', 'm1', ?3)",
      KIKO,
      ANA,
      ROOM,
    )
    sql.exec("INSERT INTO team_leases (path, slug, at, room_id) VALUES ('/facts', ?1, 1, ?2)", ANA, ROOM)

    const result = members.apply({ op: "remove", slug: ANA })

    expect(result.ok).toBe(true)
    expect(workspace.task("a")?.owner).toBeUndefined()
    expect(result.ok && result.events.some((e) => e.t === "task" && e.task.id === "a")).toBe(true)
    expect(sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM agent_asks WHERE answer IS NULL").one().n).toBe(0)
    expect(sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM team_leases").one().n).toBe(0)
    expect(members.everyone()).toEqual([KIKO, MAX])
    expect(members.allSlugs()).toEqual([KIKO, ANA, MAX])
  })
})
