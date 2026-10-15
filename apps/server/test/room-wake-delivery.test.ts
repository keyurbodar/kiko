import { expect, test } from "bun:test"
import type { AgentSlug, Envelope } from "@kiko/protocol"
import { Asks } from "../src/room/asks"
import { Deliveries } from "../src/room/deliver"
import { RoomLog } from "../src/room/log"
import { Mail } from "../src/room/mail"
import { RoomWorkspace } from "../src/room/workspace"
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
  const agent = { fail: false, refused: null as string | null, received: [] as string[] }
  const env = {
    AGENT: {
      idFromName: (name: string) => name,
      get: () => ({
        receive: async (envelopes: Envelope[]) => {
          if (agent.fail) throw new Error("offline")
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
  const workspace = new RoomWorkspace(storage, log)
  const wakes = new RoomWakes({
    env,
    log,
    members: { list: () => [ada], get: () => ada } as never,
    mail,
    deliveries,
    routines: { follow: () => {}, unfollow: () => {} } as never,
    alarms: alarms as never,
    workspace,
    burst: { pending: () => false } as never,
    home: () => home,
    chat: async () => ({ title: "t" }) as never,
    seedMembers: async () => {},
    publish: () => {},
    receiver,
  } as never)
  return { wakes, agent, workspace }
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


test("task reports survive failed delivery and reach the lead exactly once", async () => {
  const { workspace, wakes, agent } = setup()
  const bob = "bob" as AgentSlug
  workspace.create({ kind: "agent", slug: bob }, { id: "report", title: "Check senders", owner: bob }, [bob, ada.slug as AgentSlug])
  const result = workspace.update({ kind: "agent", slug: bob }, "report", { status: "review", note: "Saved /senders.md" }, [bob, ada.slug as AgentSlug], false)
  if (!result.ok || result.events[0]?.t !== "task") throw new Error("no task event")
  workspace.queueReport(result.events[0], bob, ada.slug as AgentSlug)
  workspace.queueReport(result.events[0], bob, ada.slug as AgentSlug)
  expect(workspace.pendingReports()).toHaveLength(1)
  agent.fail = true
  await wakes.deliverWakes()
  expect(workspace.pendingReports()).toHaveLength(1)
  agent.fail = false
  await wakes.deliverWakes()
  await wakes.deliverWakes()
  expect(agent.received).toEqual([`task-report:${result.events[0].seq}`])
  expect(workspace.pendingReports()).toEqual([])
})

test("task handoffs yield after eight deliveries and continue on the next alarm", async () => {
  const { workspace, wakes, agent } = setup()
  const bob = "bob" as AgentSlug
  for (let i = 0; i < 10; i++) {
    const id = `report-${i}`
    workspace.create({ kind: "agent", slug: bob }, { id, title: "Check senders", owner: bob }, [bob])
    const result = workspace.update({ kind: "agent", slug: bob }, id, { status: "review" }, [bob], false)
    if (!result.ok || result.events[0]?.t !== "task") throw new Error("no task event")
    workspace.queueReport(result.events[0], bob, ada.slug as AgentSlug)
  }
  await wakes.deliverWakes()
  expect(agent.received).toHaveLength(8)
  expect(workspace.pendingReports()).toHaveLength(2)
  await wakes.deliverWakes()
  expect(agent.received).toHaveLength(10)
  expect(workspace.pendingReports()).toEqual([])
})
