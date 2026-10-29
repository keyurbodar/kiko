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
const ANA = "ana" as AgentSlug
const HOME: Home = { userId: "owner", roomId: ROOM }

function room(options: { refused?: string | null; owes?: boolean } = {}) {
  const state = { refused: options.refused ?? null, owes: options.owes ?? false }
  const claimed = new Set<string>()
  const sent: string[] = []
  const reports = [{ seq: 4, recipient: KIKO, body: "the task is done", chain: null }]
  const wakes = [{ taskId: "t1", owner: ANA, title: "map the coast", seq: 2, chain: null }]
  const services = {
    agent: () => ({
      receive: async () => {
        sent.push("wake")
        return { refused: state.refused }
      },
    }),
  } as unknown as OwnerServices
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
  const claim = (key: string) => {
    if (claimed.has(key)) return false
    claimed.add(key)
    return true
  }
  const workspace = {
    pendingReports: () => reports.filter((r) => !claimed.has(`report:${r.seq}`)),
    claimReport: (seq: number) => claim(`report:${seq}`),
    requeueReport: (report: { seq: number }) => claimed.delete(`report:${report.seq}`),
    pendingWakes: () => wakes.filter((w) => !claimed.has(`wake:${w.taskId}`)),
    claimWake: (taskId: string) => claim(`wake:${taskId}`),
    requeueWake: (taskId: string) => claimed.delete(`wake:${taskId}`),
  } as unknown as RoomWorkspace
  const delivery = new RoomDelivery({
    services,
    log,
    members: { list: () => [{ slug: KIKO, lead: true }, { slug: ANA }] } as unknown as Members,
    routines: {} as RoomRoutines,
    workspace,
    burst: {} as Burst,
    asks: { owes: () => state.owes } as unknown as Asks,
    home: () => HOME,
    chat: async () => ({ title: "chat" }) as Chat,
    seedMembers: async () => {},
    receiver,
  })
  return { delivery, claimed, sent, state }
}

describe("task wakes", () => {
  it("stay pending when the agent does not take them", async () => {
    const { delivery, claimed } = room({ refused: "full" })
    await delivery.deliverWakes()
    expect([...claimed]).toEqual([])
  })

  it("are marked once the agent takes them", async () => {
    const { delivery, claimed } = room()
    await delivery.deliverWakes()
    expect([...claimed]).toEqual(["report:4", "wake:t1"])
  })

  it("are offered once when two passes run together", async () => {
    const { delivery, claimed, sent } = room()
    await Promise.all([delivery.deliverWakes(), delivery.deliverWakes()])
    expect(sent).toHaveLength(2)
    expect([...claimed]).toEqual(["report:4", "wake:t1"])
  })

  it("stay queued while the owner owes the lead an answer", async () => {
    const { delivery, claimed, sent } = room({ owes: true })
    await delivery.deliverWakes()
    expect(sent).toHaveLength(1)
    expect([...claimed]).toEqual(["report:4"])
  })

  it("go out once the ask is answered or ages out", async () => {
    const { delivery, claimed, state } = room({ owes: true })
    await delivery.deliverWakes()
    state.owes = false

    await delivery.deliverWakes()

    expect([...claimed]).toEqual(["report:4", "wake:t1"])
  })
})
