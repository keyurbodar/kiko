import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentSlug, ThinkingLevel } from "@kiko/protocol"
import { connectTestModel, VerifyError } from "../client"
import { frames, newRoom, poll, seen, statuses } from "../kit"
import type { Suite } from "../runner"
import { send } from "./mid-run"

/** Every OpenCode Go chat model pi-ai lists, or the comma-separated `KIKO_SWEEP_MODELS`. `KIKO_SWEEP_THINKING` sets one reasoning level for all. */
function sweepModels(): string[] {
  const picked = process.env.KIKO_SWEEP_MODELS
  if (picked) return picked.split(",").map((m) => m.trim()).filter(Boolean)
  const data = join(import.meta.dir, "../../../../server/node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json")
  const byApi = JSON.parse(readFileSync(data, "utf8")) as Record<string, Record<string, { id: string; type?: string }> | { id: string; type?: string }[]>
  return Object.values(byApi).flatMap((models) => Object.values(models)).filter((m) => (m.type ?? "chat") === "chat").map((m) => `opencode-go/${m.id}`)
}

type Outcome = { model: string; ok: boolean; text: string; secs: number }

const suite: Suite = {
  name: "model-sweep",
  model: true,
  async run(v) {
    const s = await v.as(`model-sweep-${Date.now().toString(36)}`)
    await connectTestModel(s)
    const user = await s.user()
    await user.expect((f) => f.t === "reset")
    const outcomes: Outcome[] = []
    for (const model of sweepModels()) {
      const thinking = process.env.KIKO_SWEEP_THINKING as ThinkingLevel | undefined
      user.send({ t: "agent_model", slug: "kiko" as AgentSlug, ref: model, ...(thinking ? { thinking } : {}) })
      await user.expect((f) => (f.t === "events" && f.events.some((e) => e.t === "agent_model" && e.slug === "kiko" && e.model === model)) || f.t === "model_refused", 10_000).catch(() => {})
      const { room } = await newRoom(s, `sweep ${model}`)
      const t0 = Date.now()
      await send(room, "Hi")
      const ended = await poll(
        `an answer or a run error from ${model}`,
        () => {
          const error = frames(room).flatMap((f) => (f.t === "events" ? f.events : [])).find((e) => e.t === "message" && (e.event as { kind?: string } | undefined)?.kind === "run_error")
          if (error && error.t === "message") return { ok: false, text: `${error.text} | ${(error.event as { detail?: string }).detail ?? ""}` }
          const answer = seen(room).live.find((m) => m.from.kind === "agent")
          return answer ? { ok: true, text: answer.text } : null
        },
        240_000,
        500,
      ).catch((e: Error) => ({ ok: false, text: `${e.message}. statuses ${statuses(room).join(",")}` }))
      const outcome = { model, ...ended, secs: Math.round((Date.now() - t0) / 1000) }
      outcomes.push(outcome)
      console.log(`  ${outcome.ok ? "ok  " : "FAIL"} ${model} ${outcome.secs}s ${JSON.stringify(outcome.text.slice(0, 220))}`)
    }
    const failed = outcomes.filter((o) => !o.ok)
    if (failed.length) throw new VerifyError(`${failed.length} of ${outcomes.length} models failed: ${failed.map((o) => o.model).join(", ")}`)
  },
}

export default suite
