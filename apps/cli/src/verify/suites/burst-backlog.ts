import { newRoom, poll, seen } from "../kit"
import { VerifyError } from "../client"
import type { Suite } from "../runner"
import { fake } from "./mid-run"


const COUNT = 250

const suite: Suite = {
  name: "burst-backlog",
  async run(v) {
    const s = await v.as(`burst-${Date.now().toString(36)}`)
    const { roomId, room } = await newRoom(s, "burst backlog")
    await fake(v, s, roomId)
    for (let i = 0; i < COUNT; i++) room.send(`b${i}x`)
    const heard = () => seen(room).live.flatMap((m) => [...m.text.matchAll(/\bb(\d+)x\b/g)].map((x) => Number(x[1])))
    await poll(`all ${COUNT} messages heard`, () => new Set(heard()).size === COUNT, 120_000)
    await Bun.sleep(2_000)
    const all = heard()
    const twice = all.filter((n, i) => all.indexOf(n) !== i)
    if (twice.length) throw new VerifyError(`messages heard twice: ${[...new Set(twice)].slice(0, 10).join(", ")}`)
    const runs = new Set(seen(room).live.map((m) => m.run?.runId)).size
    console.log(`  ${COUNT} messages heard once each, across ${runs} run(s)`)
  },
}

export default suite
