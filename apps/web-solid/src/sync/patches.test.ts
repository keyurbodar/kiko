import { describe, expect, test } from "bun:test"
import type { AgentSlug, Member, RoomEvent } from "@kiko/protocol"
import { overlayMembers, type RoomPatch, settleRoom } from "./patches"

describe("a model pick", () => {
  const members: Member[] = [
    { slug: "kiko" as AgentSlug, name: "Kiko", lead: true, model: "a/one", thinking: "low", thinkingLevels: ["off", "low", "high"] },
    { slug: "ada" as AgentSlug, name: "Ada", lead: false, model: "a/one", thinking: "low", thinkingLevels: ["off", "low", "high"] },
  ]
  const pick: RoomPatch = { clientId: "m1", at: 0, frame: { t: "model", slug: "ada" as AgentSlug, ref: "b/two", thinking: "max" }, levels: ["off", "max"] }

  test("shows at once on that agent only", () => {
    const out = overlayMembers(members, [pick])
    expect(out[1]).toMatchObject({ model: "b/two", thinking: "max", thinkingLevels: ["off", "max"] })
    expect(out[0]).toBe(members[0]!)
  })
  test("the room's member event for the agent settles it, and another agent's does not", () => {
    const member = (slug: string, model: string, thinking: "max" | "low"): RoomEvent => ({ t: "member", member: { slug: slug as AgentSlug, name: slug, lead: false, model, thinking } }) as RoomEvent
    expect(settleRoom([pick], [member("kiko", "b/two", "max")], 0)).toHaveLength(1)
    expect(settleRoom([pick], [member("ada", "a/one", "low")], 0)).toHaveLength(1)
    expect(settleRoom([pick], [member("ada", "b/two", "max")], 0)).toHaveLength(0)
  })
})
