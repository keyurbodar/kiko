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
    const { room } = await newRoom(s, "agent reasoning")
    room.raw.send({ t: "model", slug: "kiko" as AgentSlug, ref: MODEL, thinking: "high" })
    await poll("kiko on the model at high", () => room.raw.log.some((e) => e.dir === "in" && JSON.stringify(e.frame).includes(`"model":"${MODEL}","thinking":"high"`)))
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
