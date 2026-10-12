import { expect, test } from "bun:test"
import type { AgentSlug, Envelope } from "@yuki/protocol"
import { Asks } from "../src/room/asks"
import { Deliveries } from "../src/room/deliver"
import { RoomLog } from "../src/room/log"
import { Mail } from "../src/room/mail"
import { migrate } from "../src/room/schema"
import type { ReceiveDeps } from "../src/room/receive"
import { HeldWakes, type Wake } from "../src/room/wake"
import { RoomWakes } from "../src/room/wake-delivery"
import { sqlStorage } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada", name: "Ada", role: "", model: "", lead: true, status: "idle" }

function wake(id: string, budget: Wake["budget"] = "user"): Wake {
  return { id, to: "ada" as AgentSlug, why: "reminder", body: "b", chain: null, budget, retry: true }
}

function setup() {
  const sql = sqlStorage()
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  migrate(storage)
  const log = new RoomLog(storage, () => 1)
  const mail = new Mail(storage, log, new Asks(sql))
  const deliveries = new Deliveries(storage, log)
  const outbox = new HeldWakes(sql)
  // What the user object answers: whether the day's runs that start without the human are used up, and which wakes it refunded.
  const user = { limited: false, refunded: [] as string[] }
  // What the agent answers to what the room delivers.
  const agent = { refused: null as string | null, received: [] as string[] }
  const env = {
    AGENT: {
      idFromName: (name: string) => name,
      get: () => ({
        receive: async (envelopes: Envelope[]) => {
          agent.received.push(...envelopes.map((e) => e.id))
          return { refused: agent.refused }
        },
      }),
    },
    USER: {
      idFromName: (name: string) => name,
      get: () => ({
        takeAutonomous: async () => (user.limited ? { ok: false, reason: "limit" } : { ok: true, used: 1 }),
        refundAutonomous: async (id: string) => void user.refunded.push(id),
      }),
    },
  }
  const receiver = {
    env,
    log,
    mail,
    deliveries,
    publish: () => {},
    agentHome: (_h, slug) => ({ ...home, slug }),
    delivery: (_m, _ms, _g, raw) => ({ envelopes: raw, brief: "", reactionsUpTo: 0 }),
  } as unknown as ReceiveDeps
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} }
  const wakes = new RoomWakes({
    env,
    log,
    members: { list: () => [ada], get: () => ada } as never,
    mail,
    deliveries,
    routines: { follow: () => {}, unfollow: () => {} } as never,
    outbox,
    alarms: alarms as never,
    workspace: {} as never,
    burst: { pending: () => false } as never,
    home: () => home,
    chat: async () => ({ title: "t" }) as never,
    seedMembers: async () => {},
    publish: () => {},
    receiver,
  } as never)
  return { wakes, outbox, user, agent }
}

test("a wake the agent admits is delivered once, and a repeat is a duplicate", async () => {
  const { wakes, agent } = setup()
  expect(await wakes.wake(wake("w1"))).toBe("delivered")
  expect(await wakes.wake(wake("w1"))).toBe("duplicate")
  expect(agent.received.filter((id) => id === "w1")).toHaveLength(1)
})

test("a wake the agent refuses gives its autonomous run back", async () => {
  const { wakes, user, agent } = setup()
  agent.refused = "too_large"
  expect(await wakes.wake(wake("w2"))).toBe("refused")
  expect(user.refunded).toEqual(["w2"])
})

test("a wake held by the run limit waits in the outbox and is delivered once the limit lifts", async () => {
  const { wakes, outbox, user, agent } = setup()
  user.limited = true
  expect(await wakes.wake(wake("w3"))).toBe("held")
  expect(outbox.has("w3")).toBe(true)
  user.limited = false
  await wakes.retryHeld()
  expect(agent.received.filter((id) => id === "w3")).toHaveLength(1)
  expect(outbox.has("w3")).toBe(false)
})

test("a held wake stays held while the limit still holds", async () => {
  const { wakes, outbox, user, agent } = setup()
  user.limited = true
  await wakes.wake(wake("w4"))
  await wakes.retryHeld()
  expect(agent.received).toEqual([])
  expect(outbox.has("w4")).toBe(true)
})
