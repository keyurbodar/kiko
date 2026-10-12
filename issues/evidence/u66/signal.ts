// How faithful is the appetite's input? Recorded outcome vs what the simulated human meant.
import { run, PERSONAS, BASE } from "./sim"
for (const rooms of [1, 3, 8]) {
  console.log(`rooms=${rooms}`)
  for (const p of PERSONAS) {
    const t = { reply: { n: 0, eng: 0 }, none: { n: 0, eng: 0 }, dismiss: { n: 0, eng: 0, dis: 0 } }
    for (let seed = 1; seed <= 10; seed++) {
      const r = run(p, seed, 8, BASE, rooms)
      for (const n of r.nudges) {
        const b = t[n.intent] as any
        b.n++
        if (n.outcome === "engaged") b.eng++
        if (n.outcome === "dismissed") b.dis = (b.dis ?? 0) + 1
      }
    }
    const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(0) + "%" : "-")
    console.log(`  ${p.name.padEnd(18)} meant-reply ${String(t.reply.n).padStart(4)} recorded-engaged ${pct(t.reply.eng, t.reply.n).padStart(4)} | meant-ignore ${String(t.none.n).padStart(4)} recorded-engaged ${pct(t.none.eng, t.none.n).padStart(4)} | meant-stop ${t.dismiss.n} recorded-dismissed ${pct(t.dismiss.dis, t.dismiss.n)}`)
  }
}
