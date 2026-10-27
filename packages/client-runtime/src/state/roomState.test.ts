import type { AgentSlug, RoomSnapshot } from "@kiko/protocol"
import * as Option from "effect/Option"
import { describe, expect, it } from "vitest"
import { markCatchingUp, type RoomState } from "./roomState"

const snapshot = (): RoomSnapshot => ({
  seq: 7,
  readSeq: 0,
  members: [{ slug: "kiko" as AgentSlug, name: "Kiko", lead: true }],
  messages: [],
  tasks: [],
  files: [],
  folders: [],
  agents: [{ slug: "kiko" as AgentSlug, state: "working", doing: "running a command" }],
})

const working = (): RoomState => ({
  data: Option.some(snapshot()),
  sequence: 7,
  status: "live",
  error: Option.none(),
})

describe("catching up a chat", () => {
  it("drops the agent status a background tab kept, so the run it shows as working cannot outlive its own subscribe", () => {
    const state = markCatchingUp(working())
    expect(state.status).toBe("synchronizing")
    expect(state.sequence).toBe(7)
    expect(Option.getOrThrow(state.data)).toEqual({ ...snapshot(), agents: [] })
  })
})
