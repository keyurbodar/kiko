// Nudge volume and welcome share per persona for the attention code as it is now, with the spread over seeds.
// Run it before and after a change on the same seeds: `SEEDS=10 WEEKS=8 ROOMS=3 bun quality.ts`; `JUDGE=1` runs with Jev.
import { BASE, PERSONAS, run, type Variant } from "./sim"

const SEEDS = Number(process.env.SEEDS ?? 10)
const WEEKS = Number(process.env.WEEKS ?? 8)
const ROOMS = Number(process.env.ROOMS ?? 3)
const VARIANT: Variant = process.env.JUDGE === "1" ? { ...BASE, judge: true } : BASE
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

console.log(`rooms=${ROOMS} seeds=${SEEDS} weeks=${WEEKS} human=${process.env.HUMAN ?? "uniform"} signal=${process.env.SIGNAL ?? "answer"} jev=${VARIANT.judge}`)
console.log("persona            nudges/week (mean ± sd)   welcome share (mean ± sd, runs with a nudge)   nudges total")
for (const p of PERSONAS) {
  const perWeek: number[] = []
  const share: number[] = []
  let total = 0
  for (let s = 1; s <= SEEDS; s++) {
    const r = run(p, s, WEEKS, VARIANT, ROOMS)
    const n = r.nudges.length
    const welcome = r.nudges.filter((x) => x.intent === "reply").length
    total += n
    perWeek.push(n / WEEKS)
    if (n) share.push(welcome / n)
  }
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`
  console.log(
    `${p.name.padEnd(18)} ${mean(perWeek).toFixed(2).padStart(6)} ± ${sd(perWeek).toFixed(2).padEnd(6)}        ${(share.length ? pct(mean(share)) : "-").padStart(6)} ± ${(share.length ? pct(sd(share)) : "-").padEnd(6)}                                ${total}`,
  )
}
