import { VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake, newRoom, seen, until } from "./mid-run"

// Architecture section 6.1. A burst bigger than one delivery (100 envelopes) reaches the agent in
// full, in order, chunk after chunk. The room reads only one delivery's worth of the backlog per
// flush, so a long backlog costs linear row reads, not quadratic. The fake agent answers with
// `heard: <every turn it read>`, so the suite checks that every message was heard exactly once.

const COUNT = 250

const suite: Suite = {
  name: "burst-backlog",
  async run(v) {
    const s = await v.as(`burst-${Date.now().toString(36)}`)
    const { roomId, room } = await newRoom(s, "burst backlog")
    await fake(v, s, roomId)
    for (let i = 0; i < COUNT; i++) room.send(`b${i}x`)
    const heard = () => seen(room).live.flatMap((m) => [...m.text.matchAll(/\bb(\d+)x\b/g)].map((x) => Number(x[1])))
    await until(`all ${COUNT} messages heard`, () => new Set(heard()).size === COUNT, 120_000)
    await Bun.sleep(2_000)
    const all = heard()
    const twice = all.filter((n, i) => all.indexOf(n) !== i)
    if (twice.length) throw new VerifyError(`messages heard twice: ${[...new Set(twice)].slice(0, 10).join(", ")}`)
    const runs = new Set(seen(room).live.map((m) => m.run?.runId)).size
    console.log(`  ${COUNT} messages heard once each, across ${runs} run(s)`)
  },
}

export default suite
