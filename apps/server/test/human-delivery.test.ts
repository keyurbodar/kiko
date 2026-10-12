import { expect, test } from "bun:test"
import type { Chat, Envelope, Task } from "@yuki/protocol"
import { MAX_ENTRY_BYTES, Inbox } from "@yuki/agent/inbox"
import { BurstFlush, type BurstDeps } from "../src/room/burst-flush"
import { Burst } from "../src/room/burst"
import { buildBrief } from "../src/room/brief"
import { Deliveries } from "../src/room/deliver"
import { RoomLog } from "../src/room/log"
import { Mail } from "../src/room/mail"
import type { MemberRow } from "../src/room/members"
import { MAX_TASKS } from "../src/room/workspace"
import { DELIVERY_RETRY_MS } from "../src/room/wake-delivery"
import { migrate } from "../src/room/schema"
import { sqlStorage } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"
const NOW = 1_000_000
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada", name: "Ada", role: "", model: "", lead: true, status: "idle" } as MemberRow
const bob = { slug: "bob", name: "Bob", role: "", model: "", lead: false, status: "idle" } as MemberRow

function setup(refusal: string | null) {
  const sql = sqlStorage()
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  migrate(storage)
  const log = new RoomLog(storage, () => 1)
  const wakes: [string, number][] = []
  const alarms = {
    setWakeup: async (name: string, at: number) => void wakes.push([name, at]),
    clearWakeup: async () => {},
  }
  const burst = new Burst(storage, alarms as never, () => NOW)
  const env = {
    AGENT: {
      idFromName: (name: string) => name,
      get: () => ({ receive: async () => ({ refused: refusal }) }),
    },
    USER: {
      idFromName: (name: string) => name,
      get: () => ({ takeTurn: async () => ({ ok: true }) }),
    },
  }
  const deps: BurstDeps = {
    env: env as never,
    ctx: {} as never,
    log,
    mail: new Mail(storage, log),
    deliveries: new Deliveries(storage, log),
    publish: () => {},
    agentHome: (_h, slug) => ({ ...home, slug }),
    delivery: (_m, _ms, _g, raw) => ({ envelopes: raw, brief: "", reactionsUpTo: 0 }),
    members: { list: () => [ada, bob] } as never,
    burst,
    outbox: { any: () => false } as never,
    alarms: alarms as never,
    home: () => home,
    chat: async () => ({ title: "t" }) as Chat,
    seedMembers: async () => {},
    drainMail: async () => {},
    retryHeld: async () => {},
  }
  return { flush: new BurstFlush(deps), burst, log, wakes }
}

test("a burst the agent's inbox is full for stays pending and comes back without the human", async () => {
  const { flush, burst, log, wakes } = setup("full")
  await burst.add({ id: "m1", seq: 1, text: "hello" })
  await flush.flush()
  expect(burst.pending()).toBe(true)
  expect(wakes.at(-1)).toEqual(["burst", NOW + DELIVERY_RETRY_MS])
  expect(log.snapshot().messages.filter((m) => /not delivered/.test(m.text))).toHaveLength(0)
})

test("a human message the board's largest brief rides with is refused as too large", () => {
  const sql = sqlStorage()
  const inbox = new Inbox({ sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage, () => NOW)
  const tasks = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `t${i}`, owner: "ada", status: "todo", title: "漢".repeat(200), dependsOn: [] }) as unknown as Task)
  const brief = buildBrief(ada, { goal: "ship", members: [ada, bob], tasks, reactions: null })
  const envelope: Envelope = { id: "human:m1", roomId: ROOM as never, from: { kind: "human" }, body: "漢".repeat(16_000), hop: 0, rootId: "m1", seq: 1 }
  expect(new TextEncoder().encode(brief).length).toBeGreaterThan(MAX_ENTRY_BYTES / 2)
  expect(inbox.admit([envelope], brief)).toEqual({ admitted: [], inserted: 0, refused: "too_large" })
})
