import { newRoom } from "../kit"
import { type Session, VerifyError } from "../client"
import { must } from "../must"
import { ok, type Routine, runsOf } from "../routine-kit"
import type { Suite } from "../runner"
import { fake } from "./mid-run"


const N = Number(process.env.ROUTINES_SCALE_N ?? 300)
const CONCURRENCY = 25

async function pool<T, R>(items: readonly T[], size: number, work: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await work(must(items[i], "a scale item"), i)
      }
    }),
  )
  return out
}

const suite: Suite = {
  name: "routines-scale",
  load: true,
  async run(v) {
    const url = v.url
    const run = Date.now()
    const setupStart = Date.now()
    const dueAt = Date.now() + 60_000 + N * 150
    const users = await pool(Array.from({ length: N }, (_, i) => i), CONCURRENCY, async (i) => {
      const s = await v.as(`scale-${run}-${i}`)
      const { roomId, room } = await newRoom(s, `scale ${i}`)
      await fake(v, s, roomId)
      room.raw.close()
      const { routine } = await ok<{ routine: Routine }>(url, s, "routines", { roomId, name: "tick", instructions: `[reply] tick ${i}`, trigger: { on: "time", at: new Date(dueAt).toISOString() } })
      return { s, routine }
    })
    v.closeAll()
    console.log(`  ok ${N} users set up in ${Math.round((Date.now() - setupStart) / 1000)}s, all due at the same second`)
    if (Date.now() > dueAt) throw new VerifyError("set-up ran past the due time; lower ROUTINES_SCALE_N")
    const wait = async (u: { s: Session; routine: Routine }) => {
      const end = dueAt + 300_000
      for (;;) {
        const runs = await runsOf(url, u.s, u.routine.id)
        if (runs.some((r) => r.status !== "running")) return runs
        if (Date.now() > end) return runs
        await Bun.sleep(1_000)
      }
    }
    await Bun.sleep(Math.max(0, dueAt - Date.now()))
    const results = await pool(users, CONCURRENCY, wait)
    const lastDone = Date.now() - dueAt
    const statuses = new Map<string, number>()
    for (const runs of results) {
      const key = runs.length === 0 ? "lost" : runs.length > 1 ? "twice" : runs[0]?.status
      statuses.set(key, (statuses.get(key) ?? 0) + 1)
    }
    const summary = JSON.stringify(Object.fromEntries(statuses))
    if (statuses.get("ok") !== N) throw new VerifyError(`expected ${N} ok runs, got ${summary}`)
    console.log(`  ok ${N} routines due at once each ran exactly once; the last was confirmed ${Math.round(lastDone / 1000)}s after the due time: ${summary}`)
  },
}

export default suite
