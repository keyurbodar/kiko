import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// Runs the real helper inside workerd through Miniflare. The worker is bundled
// from src/lib/alarm.ts so the test cannot drift from the source.
let mf: Miniflare

beforeAll(async () => {
  const script = await bundleWorker(new URL("./alarm-worker.ts", import.meta.url))
  mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2026-07-01",
    durableObjects: { T: { className: "T", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

const B = 5e12 // far future, so the real alarm never fires during a test
let n = 0
async function call(id: string, op: string, args: Record<string, unknown> = {}) {
  const ns = await mf.getDurableObjectNamespace("T")
  const stub = ns.get(ns.idFromName(id))
  const res = await stub.fetch("http://do/", { method: "POST", body: JSON.stringify({ op, ...args }) })
  return (await res.json()) as any
}
const fresh = () => `obj-${++n}`

test("alarm points at the earliest wakeup", async () => {
  const id = fresh()
  await call(id, "set", { key: "a", at: B + 5000 })
  await call(id, "set", { key: "b", at: B + 3000 })
  expect((await call(id, "state")).alarm).toBe(B + 3000)
})

test("setAlarm is not called when the earliest time did not change", async () => {
  const id = fresh()
  await call(id, "set", { key: "a", at: B + 3000 })
  await call(id, "set", { key: "b", at: B + 9000 })
  await call(id, "set", { key: "a", at: B + 3000 })
  await call(id, "clear", { key: "b" })
  expect((await call(id, "state")).setAlarmCalls).toBe(1)
})

test("two wakeups due in one alarm are both returned and removed", async () => {
  const id = fresh()
  await call(id, "set", { key: "a", at: B + 1000 })
  await call(id, "set", { key: "b", at: B + 2000 })
  await call(id, "set", { key: "c", at: B + 9000 })
  const first = await call(id, "due", { now: B + 2500 })
  expect(first.keys).toEqual(["a", "b"])
  expect(first.alarm).toBe(B + 9000)
  const again = await call(id, "due", { now: B + 2500 })
  expect(again.keys).toEqual([])
})

test("a repeated alarm runs the handler once per key", async () => {
  const id = fresh()
  await call(id, "set", { key: "a", at: B + 1000 })
  await call(id, "set", { key: "b", at: B + 1000 })
  await call(id, "due", { now: B + 1500 })
  await call(id, "due", { now: B + 1500 })
  expect((await call(id, "state")).handled).toEqual({ a: 1, b: 1 })
})

test("clearing the last wakeup removes the alarm", async () => {
  const id = fresh()
  await call(id, "set", { key: "a", at: B + 4000 })
  await call(id, "clear", { key: "a" })
  expect((await call(id, "state")).alarm).toBe(null)
})

test("a wakeup re-set for the same key moves instead of duplicating", async () => {
  const id = fresh()
  await call(id, "set", { key: "a", at: B + 4000 })
  await call(id, "set", { key: "a", at: B + 6000 })
  expect((await call(id, "state")).alarm).toBe(B + 6000)
  expect((await call(id, "due", { now: B + 7000 })).keys).toEqual(["a"])
})

test("runDue runs every due handler even when one throws, and sets only the failed key again", async () => {
  const id = fresh()
  for (const key of ["a", "boom", "c"]) await call(id, "set", { key, at: B + 1000 })
  const out = await call(id, "runDue", { now: B + 2000 })
  expect(out.ran).toEqual(["a", "c"])
  expect(out.failed).toEqual(["boom"])
  expect(out.left).toEqual([{ key: "boom", at: B + 2000 + 5000 }])
})
