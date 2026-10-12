// Where in the human's day does each rhythm variant put its nudges? Wait = nudge -> human's next session start.
import { BASE, PERSONAS, run, START, TZ, HOUR, type Variant } from "./sim"
import { slotOf } from "../../../apps/server/src/initiative/attention/rhythm"
const vs: Variant[] = [BASE, { ...BASE, name: "24", rhythm: "24" }, { ...BASE, name: "nosmooth", rhythm: "168-nosmooth" }, { ...BASE, name: "raw", rhythm: "168-raw" }]
const q = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))] ?? NaN
for (const p of PERSONAS.filter((p) => ["regular-keen", "irregular-keen", "weekday-weekend"].includes(p.name))) {
  for (const v of vs) {
    const waits: number[] = []
    const hours: Record<number, number> = {}
    for (let s = 1; s <= 10; s++) for (const n of run(p, s, 8, v).nudges) {
      waits.push((n.wait ?? 0) / HOUR)
      const h = slotOf(n.at, TZ) % 24
      hours[h] = (hours[h] ?? 0) + 1
    }
    const top = Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h, c]) => `${h}h:${c}`).join(" ")
    console.log(`${p.name.padEnd(16)} ${v.name.padEnd(9)} n=${waits.length} wait h p25 ${q(waits, 0.25).toFixed(1)} median ${q(waits, 0.5).toFixed(1)} p75 ${q(waits, 0.75).toFixed(1)} p90 ${q(waits, 0.9).toFixed(1)} | nudge local hours ${top}`)
  }
}
