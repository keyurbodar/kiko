import type { AgentSlug } from "@kiko/protocol"
import { connectTestModel, VerifyError } from "../client"
import { newRoom, poll, seen } from "../kit"
import type { Suite } from "../runner"
import { readStats, resetStats } from "./latency"

const MODEL = "opencode-go/deepseek-v4.1-flash"

const suite: Suite = {
  name: "agent-reasoning",
  model: true,
  async run(v) {
    const s = await v.as("agent-reasoning")
    await connectTestModel(s)
    const user = await s.user()
    user.send({ t: "agent_model", slug: "kiko" as AgentSlug, ref: MODEL, thinking: "high" })
    await user.expect((f) => f.t === "events" && f.events.some((e) => e.t === "agent_model" && e.slug === "kiko" && e.model === MODEL && e.thinking === "high"))
    const { room } = await newRoom(s, "agent reasoning")
    await resetStats(v, s)
    room.send("reply with the single word ok.")
    await poll("an answer", () => seen(room).live.length > 0, 90_000)
    const stats = await readStats(v, s)
    console.log(`  provider requests by reasoning: ${JSON.stringify(Object.fromEntries(Object.entries(stats).filter(([k]) => k.startsWith("model.reasoning."))))}`)
    if (!stats["model.reasoning.high"]) throw new VerifyError("no model request carried reasoning high")
    if (stats["model.reasoning.minimal"] || stats["model.reasoning.off"]) throw new VerifyError("a request went out at another level")
  },
}

export default suite
