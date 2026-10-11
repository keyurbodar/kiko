// Live check of both deciders on the Hacker News fixture.
// Usage: bun packages/browser/scripts/decide-probe.ts
// Keys come from the environment or apps/server/.dev.vars. They are never printed.
// The port adapters here are throwaway. The server wires the real ones.
import { readFileSync } from "node:fs"
import { jevDecider } from "../src/decide/jev"
import { modelDecider } from "../src/decide/model"
import type { JevPort, ModelPort } from "../src/decide/ports"
import type { Decider } from "../src/decide/types"
import type { PageView } from "../src/page/types"
import { choices } from "../src/plan/candidates"

const dev = (() => {
  try {
    return readFileSync(new URL("../../../apps/server/.dev.vars", import.meta.url), "utf8")
  } catch {
    return ""
  }
})()
const key = (name: string) => process.env[name] ?? dev.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim()
const JEV_KEY = key("TYPESAFE_API_KEY")
const MODEL_KEY = key("OPENCODE_API_KEY")

const RUNS = 5
const hn = JSON.parse(readFileSync(new URL("../test/fixtures/hn.json", import.meta.url), "utf8")) as PageView
const GOALS = [
  { goal: "see the newest submissions", want: "k3" },
  { goal: "log in", want: "k10" },
  { goal: "open the comments of the 3rd story", want: "k31" },
]

let inTokens: number | null = null

const jevPort: JevPort = {
  async choose(req, signal) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${JEV_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        state: req.state,
        model: "jev-latest",
        questions: {
          pick: {
            type: "choice",
            instructions: req.instructions,
            criteria: Object.fromEntries(req.options.map((o) => [o.key, o.text])),
          },
        },
      }),
      signal,
    })
    if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = (await res.json()) as {
      answers: { pick: { choice: string; confidence: number; probabilities?: Record<string, number> } }
      usage?: { input_tokens?: number }
    }
    inTokens = json.usage?.input_tokens ?? null
    const a = json.answers.pick
    return { key: a.choice, confidence: a.confidence, probabilities: a.probabilities ?? {} }
  },
}

// Muse Spark 1.3 on OpenCode Go speaks the OpenAI Responses API (pi-ai's opencode-go catalog).
const modelPort: ModelPort = {
  async complete(system, user, signal) {
    const res = await fetch("https://opencode.ai/zen/go/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_KEY}`,
        "Content-Type": "application/json",
        "x-opencode-session": crypto.randomUUID(),
      },
      body: JSON.stringify({
        model: "muse-spark-1.3-contributor",
        instructions: system,
        input: user,
        reasoning: { effort: "minimal" },
        max_output_tokens: 200,
      }),
      signal,
    })
    if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = (await res.json()) as {
      output?: { type: string; content?: { type: string; text?: string }[] }[]
      usage?: { input_tokens?: number }
    }
    inTokens = json.usage?.input_tokens ?? null
    return (json.output ?? [])
      .filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? "")
      .join("")
  },
}

const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]

async function probe(d: Decider) {
  console.log(`\n${d.name}`)
  console.log("goal | p50 ms | chosen (x runs) | correct | confidence | input tokens")
  for (const { goal, want } of GOALS) {
    const options = choices(hn, goal, {})
    const ms: number[] = []
    const picks: string[] = []
    const conf: string[] = []
    const toks: (number | null)[] = []
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now()
      try {
        const r = await d.decide({ goal, values: {}, page: hn, options, history: [] }, AbortSignal.timeout(60_000))
        ms.push(performance.now() - t)
        picks.push(r.choice.key)
        conf.push(r.confidence === null ? "null" : r.confidence.toFixed(2))
        toks.push(inTokens)
      } catch (e) {
        picks.push(`ERR ${String(e).slice(0, 80)}`)
      }
    }
    const right = picks.filter((k) => k === want).length
    console.log(
      `${goal} (${options.length} options) | ${ms.length ? Math.round(p50(ms)) : "n/a"} | ${[...new Set(picks)].join(",")} | ${right}/${RUNS} | ${conf.join(",")} | ${toks.find((x) => x !== null) ?? "n/a"}`,
    )
  }
}

if (JEV_KEY) await probe(jevDecider(jevPort))
else console.log("no TYPESAFE_API_KEY, skipping jev")
if (MODEL_KEY) await probe(modelDecider(modelPort))
else console.log("no OPENCODE_API_KEY, skipping model")
