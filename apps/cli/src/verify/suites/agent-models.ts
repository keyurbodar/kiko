import type { AgentSlug, Member, RoomToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import { frames, newRoom, poll } from "../kit"
import type { Suite } from "../runner"

const REASONER = "anthropic/claude-opus-4-6"
const PLAIN = "openai/gpt-4o"

/** The newest member row the room has published for a slug. */
function latest(frameList: readonly RoomToClient[], slug: string): Member | undefined {
  let found: Member | undefined
  for (const f of frameList) {
    if (f.t === "reset") found = f.snapshot.members.find((m) => m.slug === slug) ?? found
    if (f.t === "events") for (const e of f.events) if (e.t === "member" && e.member.slug === slug) found = e.member
  }
  return found
}

const suite: Suite = {
  name: "agent-models",
  async run(v) {
    const s = await v.as("agent-models")
    const { room } = await newRoom(s, "agent models")
    room.raw.send({ t: "member", op: { op: "add", slug: "ada" as AgentSlug, name: "Ada" } })
    await poll("ada to join", () => latest(frames(room), "ada"))
    const kikoBefore = latest(frames(room), "kiko")

    room.raw.send({ t: "model", slug: "ada" as AgentSlug, ref: REASONER, thinking: "high" })
    const ada = await poll("ada's model and level", () => {
      const m = latest(frames(room), "ada")
      return m?.model === REASONER ? m : undefined
    })
    expectEqual(ada.thinking, "high", "the level the human picked")
    if (!ada.thinkingLevels?.includes("max") || ada.thinkingLevels.includes("xhigh")) throw new VerifyError(`levels are not pi-ai's for ${REASONER}: ${JSON.stringify(ada.thinkingLevels)}`)
    expectEqual(latest(frames(room), "kiko")?.model, kikoBefore?.model, "the other agent's model")

    room.raw.send({ t: "model", slug: "ada" as AgentSlug, ref: PLAIN })
    const plain = await poll("ada on a model that cannot reason", () => {
      const m = latest(frames(room), "ada")
      return m?.model === PLAIN ? m : undefined
    })
    expectEqual(plain.thinking, "off", "the level on a model that cannot reason")
    expectEqual(plain.thinkingLevels, ["off"], "the levels of a model that cannot reason")

    room.raw.send({ t: "model", slug: "ada" as AgentSlug, ref: REASONER, thinking: "xhigh" })
    const clamped = await poll("ada's clamped level", () => {
      const m = latest(frames(room), "ada")
      return m?.model === REASONER ? m : undefined
    })
    expectEqual(clamped.thinking, "max", "a level the model lacks moves to the next one up")

    const second = await s.room(room.id)
    await second.expect((f) => f.t === "reset" || f.t === "events")
    expectEqual(latest(frames(second), "ada")?.model, REASONER, "the model on a second device")
    expectEqual(latest(frames(second), "kiko")?.model, kikoBefore?.model, "kiko's model on a second device")
  },
}

export default suite
