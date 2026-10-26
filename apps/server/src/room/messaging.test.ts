import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import type { AgentSlug } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { Asks } from "./asks"
import type { RoomLog } from "./log"
import { MessageChains, RoomMessaging } from "./messaging"

const ROOM = "room"
const JUNO = "juno" as AgentSlug
const MIRA = "mira" as AgentSlug
const MEMBERS = [{ slug: JUNO }, { slug: MIRA }]

const TABLES = [
  "CREATE TABLE root_counts (room_id TEXT NOT NULL, root_id TEXT, deliveries INTEGER NOT NULL, tripped INTEGER NOT NULL DEFAULT 0, at INTEGER, PRIMARY KEY (room_id, root_id)) WITHOUT ROWID",
  "CREATE TABLE agent_sends (room_id TEXT NOT NULL, id TEXT, send TEXT NOT NULL, at INTEGER, PRIMARY KEY (room_id, id)) WITHOUT ROWID",
  "CREATE TABLE mail_refused (room_id TEXT NOT NULL, id TEXT, at INTEGER NOT NULL, PRIMARY KEY (room_id, id)) WITHOUT ROWID",
  "CREATE TABLE agent_asks (room_id TEXT NOT NULL, id TEXT, asker TEXT NOT NULL, askee TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')), answer TEXT, message_id TEXT, answer_send TEXT, remote TEXT, PRIMARY KEY (room_id, id)) WITHOUT ROWID",
]

function room() {
  const db = new DatabaseSync(":memory:")
  for (const table of TABLES) db.exec(table)
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
  let seq = 0
  const log = {
    roomId: ROOM,
    addMessage: () => {
      seq += 1
      return { id: `m${seq}`, seq, event: null }
    },
    meta: () => null,
    setMeta: () => {},
  } as unknown as RoomLog
  const asks = new Asks(sql, ROOM)
  const mail = new MessageChains(storage, log, asks)
  return { asks, mail }
}

const sent = (out: ReturnType<MessageChains["send"]>) => {
  if (!out.ok) throw new Error(out.error)
  return out.send.messageId
}

describe("send_message expects_reply", () => {
  it("keeps both asks open when the asked agent asks back a question", () => {
    const { asks, mail } = room()
    const request = sent(mail.send(JUNO, { id: "a", to: MIRA, text: "build the radar app" }, MEMBERS))

    const question = sent(
      mail.send(MIRA, { id: "b", to: JUNO, text: "light or dark theme?", expectsReply: true }, MEMBERS),
    )

    expect(asks.unanswered(MIRA, [request]).map((a) => a.asker)).toEqual([JUNO])
    expect(asks.unanswered(JUNO, [question]).map((a) => a.asker)).toEqual([MIRA])
  })

  it("treats a plain message back to the asker as the answer", () => {
    const { asks, mail } = room()
    const request = sent(mail.send(JUNO, { id: "a", to: MIRA, text: "build the radar app" }, MEMBERS))

    const answer = sent(mail.send(MIRA, { id: "b", to: JUNO, text: "done: https://d1.lakebed.app" }, MEMBERS))

    expect(asks.unanswered(MIRA, [request])).toEqual([])
    expect(asks.unanswered(JUNO, [answer])).toEqual([])
  })

  it("waits for no reply to a message that does not expect one", () => {
    const { asks, mail } = room()

    const note = sent(
      mail.send(JUNO, { id: "a", to: MIRA, text: "fyi, the human is away", expectsReply: false }, MEMBERS),
    )

    expect(asks.unanswered(MIRA, [note])).toEqual([])
  })
})

describe("hop cap", () => {
  it("refuses a send carried past eight hops, even from a chain handed over from another chat", () => {
    const { mail } = room()

    const out = mail.send(JUNO, { id: "k", to: "all", text: "kickoff" }, MEMBERS, null, { rootId: "r", hop: 8 })

    expect(out.ok ? "sent" : out.error).toContain("reached 8 hops")
  })

  it("closes the ask when the answer cannot be relayed past the cap", async () => {
    const { asks, mail } = room()
    const request = sent(mail.send(JUNO, { id: "a", to: MIRA, text: "build the radar app" }, MEMBERS))
    mail.restore(MIRA, [{ rootId: "r", hop: 30 }])
    const messaging = new RoomMessaging({ asks, mail } as unknown as ConstructorParameters<typeof RoomMessaging>[0])

    await messaging.relayHeard(MIRA, [`agent:${request}:${MIRA}`], "here it is", { id: "m9", seq: 9 })

    expect(asks.unanswered(MIRA, [request])).toEqual([])
  })
})
