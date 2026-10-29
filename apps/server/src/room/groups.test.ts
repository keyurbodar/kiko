import type { Agent, AgentSlug, RoomEvent, RoomId } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import type { Env } from "../index"
import type { OwnerServices } from "../owner/services"
import { Groups } from "./groups"
import type { Home } from "./home"
import type { RoomLog } from "./log"
import type { Members } from "./members"

const KIKO = "kiko" as AgentSlug
const HOME: Home = { userId: "owner", roomId: "room" as RoomId }

const GROUP = {
  title: "Field notes",
  members: [],
  newAgents: [{ name: "Rosa", handle: "rosa", description: "maps things", soul: "# rosa\n\nmaps things\n" }],
  goal: "map the coast",
  kickoff: "start with the harbour",
}

function setup(openChat?: () => Promise<{ roomId: string; created: boolean }>) {
  const meta = new Map<string, string>()
  const made: Agent[] = []
  const user = {
    listAgents: async () => [],
    makeAgent: async () => {
      const agent = { id: `id-${made.length}`, name: "Rosa", slug: "rosa", prompt: "maps things", model: "" }
      made.push(agent as Agent)
      return agent as Agent
    },
    openChat: openChat ?? (async () => ({ roomId: "group-room", created: true })),
    discardAgents: vi.fn(async () => {}),
  }
  const startGroup = vi.fn(async () => {})
  const services = {
    user: () => user,
    room: () => ({ startGroup }),
  } as unknown as OwnerServices
  const log = {
    meta: (key: string) => meta.get(key) ?? null,
    setMeta: (key: string, value: string) => meta.set(key, value),
    addMessage: () => ({ event: null }),
  } as unknown as RoomLog
  const groups = new Groups({
    ctx: { waitUntil: () => {} } as unknown as DurableObjectState,
    env: {} as Env,
    services,
    log,
    members: { get: () => ({ slug: KIKO }) } as unknown as Members,
    home: () => HOME,
    publish: (_events: readonly RoomEvent[]) => {},
    chain: () => ({ rootId: "root", hop: 0 }),
  })
  return { groups, user, startGroup, meta }
}

describe("making a group", () => {
  it("records nothing when the kickoff fails, so the retry sends it", async () => {
    const { groups, startGroup, meta } = setup()
    startGroup.mockRejectedValueOnce(new Error("kickoff refused"))

    const failed = await groups.createGroup(KIKO, GROUP)
    const retry = await groups.createGroup(KIKO, GROUP)

    expect(failed).toEqual({ ok: false, error: "kickoff refused" })
    expect(retry.ok).toBe(true)
    expect(startGroup).toHaveBeenCalledTimes(2)
    expect(meta.size).toBe(1)
  })

  it("discards the agents it made when the chat cannot be opened", async () => {
    const { groups, user, startGroup, meta } = setup(async () => {
      throw new Error("chat refused")
    })

    const out = await groups.createGroup(KIKO, GROUP)

    expect(out).toEqual({ ok: false, error: "chat refused" })
    expect(user.discardAgents).toHaveBeenCalledWith(["rosa"])
    expect(startGroup).not.toHaveBeenCalled()
    expect(meta.size).toBe(0)
  })
})
