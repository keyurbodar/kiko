import { run, PERSONAS, BASE } from "./sim"
const t0 = performance.now()
for (const p of PERSONAS) {
  const r = run(p, 1, 8, BASE)
  const reasons: Record<string, number> = {}
  for (const ps of r.passes) for (const v of ps.verdicts) { const k = v.verdict === "brief" ? v.reason : v.verdict; reasons[k] = (reasons[k] ?? 0) + 1 }
  console.log(p.name, "passes", r.passes.length, "nudges", r.nudges.length, JSON.stringify(r.outcomes), "avgItems", (r.passes.reduce((a, x) => a + x.items.length, 0) / r.passes.length).toFixed(1), JSON.stringify(reasons))
}
console.log("ms", (performance.now() - t0).toFixed(0))
