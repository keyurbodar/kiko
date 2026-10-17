import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare

beforeAll(async () => {
  const script = await bundleWorker(new URL("./sqlite-worker.ts", import.meta.url))
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { T: { className: "T", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

type Suite = "fresh" | "reopen" | "facade"
type Result = { name: string; ok: boolean; error?: string }

async function call<T>(suite: Suite, index?: number): Promise<T> {
  const ns = await mf.getDurableObjectNamespace("T")
  const res = await ns.get(ns.newUniqueId()).fetch("http://do/", { method: "POST", body: JSON.stringify({ suite, index }) })
  return (await res.json()) as T
}

async function runSuite(suite: Suite) {
  const { names } = await call<{ names: string[] }>(suite)
  const results: Result[] = []
  for (const [index] of names.entries()) results.push(await call<Result>(suite, index))
  return results
}

const CONFORMANCE_CASES = 24

test("pi-durable storage conformance passes over ctx.storage.sql", async () => {
  const results = await runSuite("fresh")
  expect(results.filter((r) => !r.ok)).toEqual([])
  expect(results.length).toBe(CONFORMANCE_CASES)
}, 60_000)

test("pi-durable storage conformance passes when the storage reopens after every commit", async () => {
  const results = await runSuite("reopen")
  expect(results.filter((r) => !r.ok)).toEqual([])
  expect(results.length).toBe(CONFORMANCE_CASES)
}, 60_000)

test("the SqliteDatabase facade queues, rolls back, and closes as the interface requires", async () => {
  const results = await runSuite("facade")
  expect(results.filter((r) => !r.ok)).toEqual([])
  expect(results.length).toBe(6)
}, 60_000)
