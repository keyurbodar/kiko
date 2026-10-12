import { expect, test } from "bun:test"
import type { AgentSlug, Envelope } from "@yuki/protocol"
import { Asks } from "../src/room/asks"
import { Deliveries } from "../src/room/deliver"
import { RoomLog } from "../src/room/log"
import { Mail } from "../src/room/mail"
import { ROOM_STEPS } from "../src/room/schema"
import type { ReceiveDeps } from "../src/room/receive"
import type { Wake } from "../src/room/wake"
import { RoomWakes } from "../src/room/wake-delivery"
import { sqlWith } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada", name: "Ada", role: "", model: "", lead: true, status: "idle" }

function wake(id: string): Wake {
  return { id, to: "ada" as AgentSlug, why: "reminder", body: "b", chain: null }
}

function setup() {
  const sql = sqlWith(ROOM_STEPS)
  const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
  const log = new RoomLog(storage, () => 1)
  const mail = new Mail(storage, log, new Asks(sql))
  const deliveries = new Deliveries(storage, log)
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
      get: () => ({}),
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
    alarms: alarms as never,
    workspace: {} as never,
    burst: { pending: () => false } as never,
    home: () => home,
    chat: async () => ({ title: "t" }) as never,
    seedMembers: async () => {},
    publish: () => {},
    receiver,
  } as never)
  return { wakes, agent }
}

test("a wake the agent admits is delivered once, and a repeat is a duplicate", async () => {
  const { wakes, agent } = setup()
  expect(await wakes.wake(wake("w1"))).toBe("delivered")
  expect(await wakes.wake(wake("w1"))).toBe("duplicate")
  expect(agent.received.filter((id) => id === "w1")).toHaveLength(1)
})

test("a wake the agent refuses is refused", async () => {
  const { wakes, agent } = setup()
  agent.refused = "too_large"
  expect(await wakes.wake(wake("w2"))).toBe("refused")
})
