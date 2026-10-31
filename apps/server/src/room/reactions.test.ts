import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { RoomLog } from "./log"
import { Members } from "./members"
import { markReactionsBriefed, reactionBrief } from "./reactions"

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
  queries.length = 0
  return { log, sql, queries }
}

const agentSays = (log: RoomLog, text: string) => log.addMessage({ from: { kind: "agent", slug: KIKO }, text })

describe("a reaction brief", () => {
  it("names a human reaction to an agent message", () => {
    const { log, sql } = room()
    const said = agentSays(log, "hi")
    log.react(said.id, { kind: "human" }, "👍")

    const brief = reactionBrief(log, sql, KIKO)

    expect(brief.text).toContain('the human reacted 👍 to your "hi"')
    expect(brief.upTo).toBeGreaterThan(0)
  })

  it("reports nothing when no reaction happened", () => {
    const { log, sql } = room()
    agentSays(log, "hi")

    expect(reactionBrief(log, sql, KIKO)).toEqual({ text: null, upTo: 0 })
  })

  it("ignores the agent's own reaction", () => {
    const { log, sql } = room()
    const said = agentSays(log, "hi")
    log.react(said.id, { kind: "agent", slug: KIKO }, "🔥")

    expect(reactionBrief(log, sql, KIKO).text).toBeNull()
  })

  it("ignores a reaction to a human message", () => {
    const { log, sql } = room()
    const human = log.addMessage({ from: { kind: "human" }, text: "hello" })
    log.react(human.id, { kind: "human" }, "👍")

    expect(reactionBrief(log, sql, KIKO).text).toBeNull()
  })

  it("skips the join once the cursor is caught up", () => {
    const { log, sql, queries } = room()
    const said = agentSays(log, "hi")
    log.react(said.id, { kind: "human" }, "👍")
    const brief = reactionBrief(log, sql, KIKO)
    markReactionsBriefed(log, KIKO, brief.upTo)
    queries.length = 0

    expect(reactionBrief(log, sql, KIKO)).toEqual({ text: null, upTo: brief.upTo })
    expect(queries.filter((q) => q.includes("FROM reactions AS r"))).toHaveLength(0)
  })
})
