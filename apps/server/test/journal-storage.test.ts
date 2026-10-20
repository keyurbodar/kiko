import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: await bundleWorker(new URL("./journal-worker.ts", import.meta.url)), compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], durableObjects: { T: { className: "T", useSQLite: true } } })
})
afterAll(async () => { await mf?.dispose() })

async function object(id?: DurableObjectId) {
  const ns = await mf.getDurableObjectNamespace("T")
  return ns.get(id ?? ns.newUniqueId())
}
async function call<T>(body: unknown, stub?: Awaited<ReturnType<typeof object>>): Promise<T> {
  const response = await (stub ?? await object()).fetch("http://do/", { method: "POST", body: JSON.stringify(body) })
  return await response.json() as T
}
test("literal ctx.abort during the second tool resumes without repeating completed tool work", async () => {
  const ns = await mf.getDurableObjectNamespace("T")
  const id = ns.newUniqueId()
  const crashed = await (await object(id)).fetch("http://do/", { method: "POST", body: JSON.stringify({ op: "crash" }) }).then((response) => response.text(), (error: unknown) => String(error))
  expect(crashed).toContain("journal test eviction during second tool")
  const resumed = await call<{ ok: boolean; error?: string }>({ op: "resume" }, await object(id))
  if (!resumed.ok) console.error(`error: journal resume ${JSON.stringify(resumed)}`)
  expect(resumed).toEqual({ ok: true, newInstance: true, calls: [{ tool: "save", count: 1 }, { tool: "wait", count: 2 }] })
}, 60_000)

test("successful generation and current-document commits survive immediate reopen without close, and unused minted IDs are never reused", async () => {
  const result = await call<{ ok: boolean; generation: number; current: number; mintedUnused: number; mintedAfterReopen: number }>({ op: "immediate" })
  expect(result).toMatchObject({ ok: true, generation: 2, current: 2 })
  expect(result.mintedAfterReopen).toBeGreaterThan(result.mintedUnused)
})
