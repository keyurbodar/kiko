import type { AgentSlug, Chat, RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import type { OwnerServices } from "../owner/services"
import type { Asks } from "./asks"
import type { Burst } from "./burst"
import { RoomDelivery } from "./delivery"
import type { Home } from "./home"
import type { RoomLog } from "./log"
import type { Members } from "./members"
import type { ReceiveDeps } from "./receive"
import type { RoomRoutines } from "./routines"
import type { RoomWorkspace } from "./workspace"

const ROOM = "room" as RoomId
const KIKO = "kiko" as AgentSlug
const HOME: Home = { userId: "owner", roomId: ROOM }

function room(refused: string | null) {
  const marked: string[] = []
  const reports = [{ seq: 4, recipient: KIKO, body: "the task is done", chain: null }]
  const wakes = [{ taskId: "t1", owner: KIKO, title: "map the coast", seq: 2, chain: null }]
  const services = { agent: () => ({ receive: async () => ({ refused }) }) } as unknown as OwnerServices
  const log = { lastSeq: () => 0, meta: () => null, setMeta: () => {} } as unknown as RoomLog
  const receiver = {
    services,
    log,
    mail: { stopped: () => false, delivered: () => {} },
    deliveries: {},
    publish: () => {},
    agentHome: () => HOME,
    delivery: () => ({ envelopes: [], brief: "", reactionsUpTo: 0 }),
  } as unknown as ReceiveDeps
  const workspace = {
    pendingReports: () => reports,
    markReported: (seq: number) => marked.push(`report:${seq}`),
    pendingWakes: () => wakes,
    markWoken: (taskId: string) => marked.push(`wake:${taskId}`),
  } as unknown as RoomWorkspace
  const delivery = new RoomDelivery({
    services,
    log,
    members: { list: () => [{ slug: KIKO, lead: true }] } as unknown as Members,
    routines: {} as RoomRoutines,
    workspace,
    burst: {} as Burst,
    asks: { owes: () => false } as unknown as Asks,
    home: () => HOME,
    chat: async () => ({ title: "chat" }) as Chat,
    seedMembers: async () => {},
    receiver,
  })
  return { delivery, marked }
}

describe("task wakes", () => {
  it("stay pending when the agent does not take them", async () => {
    const { delivery, marked } = room("full")
    await delivery.deliverWakes()
    expect(marked).toEqual([])
  })

  it("are marked once the agent takes them", async () => {
    const { delivery, marked } = room(null)
    await delivery.deliverWakes()
    expect(marked).toEqual(["report:4", "wake:t1"])
  })
})
