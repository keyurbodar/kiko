// Variants are interleaved so drift in the API's latency hits both.
import { readFileSync } from "node:fs"
import { JEV_INSTRUCTIONS } from "../src/decide/jev"
import type { Choice } from "../src/decide/types"
import type { PageView } from "../src/page/types"
import { choices } from "../src/plan/candidates"

const dev = readFileSync(new URL("../../../apps/server/.dev.vars", import.meta.url), "utf8")
const KEY = process.env.TYPESAFE_API_KEY ?? dev.match(/^TYPESAFE_API_KEY=(.*)$/m)?.[1]?.trim()
const i = process.argv.indexOf("--runs")
const RUNS = i > 0 ? Number(process.argv[i + 1]) : 6
const hn = JSON.parse(readFileSync(new URL("../test/fixtures/hn.json", import.meta.url), "utf8")) as PageView
const GOALS = [
  { goal: "see the newest submissions", want: "k3" },
  { goal: "log in", want: "k10" },
  { goal: "open the comments of the 3rd story", want: "k31" },
]

type Variant = { name: string; text: (o: Choice) => string; keep?: number }
const VARIANTS: Variant[] = [
  { name: "as is", text: (o) => o.text },
  { name: "no id", text: (o) => o.text.replace(/^\d+ /, "") },
  { name: "first 12", text: (o) => o.text, keep: 12 },
]

async function ask(goal: string, options: { key: string; text: string }[]) {
  const t = performance.now()
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: { goal, values: [], recent: [], url: hn.url, title: hn.title },
      questions: { step: { type: "choice", instructions: JEV_INSTRUCTIONS, criteria: Object.fromEntries(options.map((o) => [o.key, o.text])) } },
    }),
  })
  if (!res.ok) throw new Error(`jev ${res.status}`)
  const json = (await res.json()) as { answers: { step: { choice: string } }; usage?: { input_tokens?: number } }
  return { ms: performance.now() - t, key: json.answers.step.choice, tokens: json.usage?.input_tokens ?? 0 }
}

const p50 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? 0
const stats = new Map(VARIANTS.map((v) => [v.name, { ms: [] as number[], tokens: [] as number[], right: 0, n: 0 }]))
for (let r = 0; r < RUNS; r++) {
  for (const { goal, want } of GOALS) {
    const options = choices(hn, goal, {})
    for (const v of r % 2 ? [...VARIANTS].reverse() : VARIANTS) {
      const kept = v.keep ? [...options.filter((o) => o.key === want), ...options.filter((o) => o.key !== want)].slice(0, v.keep) : options
      const out = await ask(goal, kept.map((o) => ({ key: o.key, text: v.text(o) })))
      const s = stats.get(v.name)!
      s.ms.push(out.ms)
      s.tokens.push(out.tokens)
      s.n++
      if (out.key === want) s.right++
    }
  }
}
console.log("variant\tp50 ms\tinput tokens\tcorrect")
for (const [name, s] of stats) console.log(`${name}\t${Math.round(p50(s.ms))}\t${Math.round(s.tokens.reduce((a, b) => a + b, 0) / s.n)}\t${s.right}/${s.n}`)
