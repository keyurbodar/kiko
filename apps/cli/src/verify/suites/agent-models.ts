import { newRoomId } from "@kiko/protocol"
import type { Agent, AgentModel, AgentSlug, RoomId, UserEvent, UserToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

const REASONER = "anthropic/claude-opus-4-6"
const PLAIN = "openai/gpt-4o"

const modelEvents = (frame: UserToClient, slug: string): Extract<UserEvent, { t: "agent_model" }>[] =>
  frame.t === "events" ? frame.events.filter((e): e is Extract<UserEvent, { t: "agent_model" }> => e.t === "agent_model" && e.slug === slug) : []

const suite: Suite = {
  name: "agent-models",
  async run(v) {
    const s = await v.as("agent-models")
    const a = await s.user()
    const b = await s.user()
    await a.expect(() => true)
    await b.expect(() => true)

    const make = (slug: string): Agent => ({ id: crypto.randomUUID(), name: slug, slug: slug as AgentSlug, prompt: "", model: "" })
    const ada = make("ada")
    const bo = make("bo")
    a.send({ t: "agent", op: { op: "create", agent: ada } })
    a.send({ t: "agent", op: { op: "create", agent: bo } })
    // A new agent whose pick equals its fallback still reaches a live device, so its chip never says "Choose model".
    const cy = make("cy")
    a.send({ t: "agent", op: { op: "create", agent: cy } })
    const born = modelEvents(await b.expect((f) => modelEvents(f, "cy").length > 0), "cy")[0]
    if (!born?.model || born.thinkingLevels.length === 0) throw new VerifyError(`a new agent has no model event: ${JSON.stringify(born)}`)
    const chatA = newRoomId() as RoomId
    const chatB = newRoomId() as RoomId
    a.send({ t: "chat", op: { op: "create", roomId: chatA, title: "ada alone", agents: [ada.id] } })
    a.send({ t: "chat", op: { op: "create", roomId: chatB, title: "ada and bo", agents: [ada.id, bo.id] } })

    a.send({ t: "agent_model", slug: ada.slug, ref: REASONER, thinking: "high", roomId: chatA })
    const high = modelEvents(await b.expect((f) => modelEvents(f, "ada").some((e) => e.model === REASONER)), "ada").find((e) => e.model === REASONER)
    expectEqual(high?.thinking, "high", "the level on the second device")
    if (!high?.thinkingLevels.includes("max") || high.thinkingLevels.includes("xhigh")) throw new VerifyError(`levels are not pi-ai's for ${REASONER}: ${JSON.stringify(high?.thinkingLevels)}`)

    a.send({ t: "agent_model", slug: ada.slug, ref: PLAIN })
    const plain = modelEvents(await b.expect((f) => modelEvents(f, "ada").some((e) => e.model === PLAIN)), "ada").find((e) => e.model === PLAIN)
    expectEqual([plain?.thinking, plain?.thinkingLevels], ["off", ["off"]], "a model that cannot reason")

    a.send({ t: "agent_model", slug: ada.slug, ref: REASONER, thinking: "xhigh" })
    const clamped = modelEvents(await b.expect((f) => modelEvents(f, "ada").some((e) => e.model === REASONER && e.thinking === "max")), "ada")[0]
    expectEqual(clamped?.thinking, "max", "a level the model lacks moves to the next one up")

    const third = await s.user()
    const reset = await third.expect((f) => f.t === "reset")
    const models = (reset.t === "reset" ? reset.snapshot.agentModels : undefined) as Record<string, AgentModel> | undefined
    expectEqual([models?.ada?.model, models?.ada?.thinking], [REASONER, "max"], "ada's model in a fresh snapshot, whatever chat is open")
    if (!models?.kiko || !models.bo) throw new VerifyError(`the snapshot lacks Kiko or Bo: ${JSON.stringify(Object.keys(models ?? {}))}`)
    if (models.kiko.model === REASONER) throw new VerifyError("Kiko moved when Ada's model changed")
  },
}

export default suite
