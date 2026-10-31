import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { initializeSchema } from "../owner/schema"
import { RoomLog } from "./log"
import { Members } from "./members"

const ROOM = "room"
const KIKO = "kiko" as AgentSlug
const MIRA = "mira" as AgentSlug

function room(clock: () => number = () => 9_000) {
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
  const log = new RoomLog(storage, ROOM, clock)
  new Members(storage, log).seed([
    { slug: KIKO, name: "Kiko" },
    { slug: MIRA, name: "Mira" },
  ])
  return log
}

const say = (log: RoomLog, text: string) => log.addMessage({ from: { kind: "human" }, text })

const readEvents = (log: RoomLog) => {
  const caught = log.catchUp(0)
  return caught.t === "events" ? caught.events.filter((event) => event.t === "read") : []
}

describe("reading at the bottom of a chat", () => {
  it("coalesces a burst of reads into one write a second", () => {
    let now = 9_000
    const log = room(() => now)
    for (const text of ["one", "two", "three"]) say(log, text)

    expect(log.markRead(3)).not.toBeNull()
    now += 500
    expect(log.markRead(4)).toBeNull()
    expect(log.markRead(5)).toBeNull()
    expect(log.readSeq()).toBe(3)

    now += 600
    expect(log.markRead(5)?.t).toBe("read")
    expect(log.readSeq()).toBe(5)
    expect(readEvents(log)).toHaveLength(2)
  })

  it("keeps the cursor a coalesced read left pending when a client replays", () => {
    let now = 9_000
    const log = room(() => now)
    for (const text of ["one", "two"]) say(log, text)

    expect(log.markRead(3)).not.toBeNull()
    now += 500
    expect(log.markRead(4)).toBeNull()
    expect(log.readSeq()).toBe(3)

    expect(log.snapshot().readSeq).toBe(4)
  })
})

describe("agent reaction events", () => {
  it("are trimmed after the mail retention and still dedupe their delivery", () => {
    let now = 9_000
    const log = room(() => now)
    const sent = say(log, "hello")
    const mira = { kind: "agent" as const, slug: MIRA }
    expect(log.react(sent.id, mira, "👍", "delivery-1")).not.toBeNull()

    now += 8 * 86_400_000
    for (let n = 0; n < 1_100; n++) say(log, `later ${n}`)

    expect(log.reactionDelivered("delivery-1")).toBe(false)
    expect(log.react(sent.id, mira, "👍", "delivery-1")).toBeNull()
    expect(log.reactionDelivered("delivery-1")).toBe(true)
  })
})

describe("a human message scan", () => {
  it("finds a message addressed to the agent past a page of messages for someone else", () => {
    const log = room()
    say(log, "@mira one")
    say(log, "@mira two")
    say(log, "@mira three")
    const late = say(log, "@kiko four")

    expect(log.unansweredFor(KIKO, 0, 1).map(({ envelope }) => envelope.seq)).toEqual([late.seq])
  })

  it("returns no more addressed messages than the caller asked for", () => {
    const log = room()
    for (let n = 0; n < 5; n++) say(log, `@kiko ${n}`)

    expect(log.unansweredFor(KIKO, 0, 2)).toHaveLength(2)
  })

  it("finds the newest mail when the caller asks for everything", () => {
    const log = room()
    for (let n = 0; n < 450; n++) say(log, `@mira ${n}`)
    const late = say(log, "@kiko late")

    expect(log.unansweredFor(KIKO, 0, Number.MAX_SAFE_INTEGER).map(({ envelope }) => envelope.seq)).toEqual([late.seq])
  })

  it("does not walk past the newest window", () => {
    const log = room()
    say(log, "@kiko early")
    for (let n = 0; n < 500; n++) say(log, `@mira ${n}`)

    expect(log.unansweredFor(KIKO, 0, Number.MAX_SAFE_INTEGER)).toEqual([])
  })
})
