import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: await bundleWorker(new URL("./run-invocation-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], durableObjects: { T: { className: "T", useSQLite: true } } })
  await mf.ready
}, 60_000)
afterAll(async () => { await mf?.dispose() })

type State = { outcome: "done" | "continue"; calls: number; setups: number; effects: number[]; errors: string[]; resumes: number | null; messages: { role: string; stopReason?: string; content: unknown }[] }

test("admission stays paused and run RPCs preserve setup across more than three planned continuations", async () => {
  const ns = await mf.getDurableObjectNamespace("T")
  const stub = ns.get(ns.newUniqueId())
  console.info("host test: admitting")
  const admitted = await (await stub.fetch("http://do/start")).json()
  console.info("host test: admitted", admitted)
  expect(admitted).toMatchObject({ calls: 0, effects: [], busy: true, alarmAt: expect.any(Number) })
  let continuations = 0
  for (;;) {
    console.info("host test: running", continuations)
    const result = await (await stub.fetch("http://do/run")).json() as State
    console.info("host test: outcome", result.outcome, result.calls)
    expect(result.errors).toEqual([])
    expect(result.calls).toBeLessThanOrEqual(40)
    expect(result.setups).toBe(1)
    expect(result.resumes).toBeNull()
    if (result.outcome === "continue") {
      continuations++
      expect(continuations).toBeLessThan(10)
      continue
    }
    expect(continuations).toBeGreaterThanOrEqual(3)
    expect(result.effects).toEqual(Array.from({ length: 60 }, (_, n) => n))
    expect(result.messages.filter((m) => m.role === "toolResult")).toHaveLength(60)
    expect(result.messages.filter((m) => m.role === "assistant" && ["error", "aborted"].includes(m.stopReason ?? ""))).toEqual([])
    expect(result.messages.at(-1)?.content).toEqual([{ type: "text", text: "Finished all 60 calls." }])
    break
  }
}, 60_000)
