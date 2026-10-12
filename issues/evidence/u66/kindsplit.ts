// Per-kind vs pooled vs no appetite for the kind-split persona, 40 seeds, welcome and unwelcome nudge counts.
import { BASE, PERSONAS, run, type Variant } from "./sim"
const p = PERSONAS.find((x) => x.name === "kind-split")!
const SEEDS = 40
const vs: Variant[] = [BASE, { ...BASE, name: "pooled", appetite: "pooled" }, { ...BASE, name: "none", appetite: "none" }]
for (const rooms of [1, 3, 8]) for (const judge of [false, true]) {
  const row: string[] = []
  for (const v of vs) {
    let n = 0, w = 0, goalsUnwelcome = 0
    const per: number[] = []
    for (let s = 1; s <= SEEDS; s++) {
      const r = run(p, s, 8, { ...v, judge }, rooms)
      const ww = r.nudges.filter((x) => x.intent === "reply").length
      n += r.nudges.length; w += ww; per.push(ww / Math.max(1, r.nudges.length))
      goalsUnwelcome += r.nudges.filter((x) => x.intent !== "reply" && (x.kind === "goal" || x.kind === "intention" || x.kind === "project")).length
    }
    const m = per.reduce((a, b) => a + b, 0) / SEEDS
    const se = Math.sqrt(per.reduce((a, b) => a + (b - m) ** 2, 0) / (SEEDS - 1) / SEEDS)
    row.push(`${v.name === "shipped" ? "per-kind" : v.name}: ${w}/${n} welcome ${(100 * m).toFixed(1)}%±${(100 * se).toFixed(1)} unwelcome-goal/intention/project ${goalsUnwelcome}`)
  }
  console.log(`rooms=${rooms} jev=${judge} | ${row.join(" | ")}`)
}
