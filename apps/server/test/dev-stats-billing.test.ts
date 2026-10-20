import { expect, test } from "bun:test"
import { billedWrites, devStatsRoute, port } from "../src/lib/dev-stats"
import { patchStorage, type DevCounterPort } from "../src/lib/dev-stats-patch"

function fixture() {
  const values: Record<string, number> = {}
  const keys = new Map<string, unknown>()
  const storage = {
    sql: { exec: () => ({}) },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      if (key === "fail") throw new Error("put failed")
      if (typeof key === "string") keys.set(key, value)
      else for (const [name, body] of Object.entries(key)) keys.set(name, body)
    },
    async delete(key: string | string[]) {
      if (key === "fail") throw new Error("delete failed")
      if (typeof key === "string") return keys.delete(key)
      return key.reduce((deleted, name) => deleted + Number(keys.delete(name)), 0)
    },
    async setAlarm(at: number) { if (at < 0) throw new Error("alarm failed") },
  }
  const port: DevCounterPort = { bump: (key, n = 1) => { values[key] = (values[key] ?? 0) + n }, track: () => {}, instrumentation: () => {} }
  patchStorage({ storage } as unknown as DurableObjectState, "owner", port)
  return { storage, values }
}

test("successful KV writes count keys and failed operations count no billed writes", async () => {
  const { storage, values } = fixture()
  await storage.put("a", 1)
  await storage.put({ b: 2, c: 3 })
  await storage.put({})
  await expect(storage.put("fail")).rejects.toThrow("put failed")
  expect(values["owner.kvKeysPut"]).toBe(3)
  expect(await storage.delete("absent")).toBe(false)
  expect(await storage.delete("a")).toBe(true)
  expect(await storage.delete(["b", "c", "absent"])).toBe(2)
  await expect(storage.delete("fail")).rejects.toThrow("delete failed")
  expect(values["owner.kvKeysDeleted"]).toBe(3)
  await storage.setAlarm(100)
  await expect(storage.setAlarm(-1)).rejects.toThrow("alarm failed")
  expect(values["owner.alarmWrites"]).toBe(1)
  expect(billedWrites(values)).toEqual({ sqlPhysical: 0, kvKeysPut: 3, kvKeysDeleted: 3, setAlarm: 1, total: 7 })
})

test("the SQL alias and call counters do not double count physical writes", () => {
  expect(billedWrites({ "owner.rowsWritten": 8, "owner.sqlRowsWritten": 8, "owner.kv.put": 5, "owner.kvKeysPut": 3, "owner.kvKeysDeleted": 2, "owner.alarmWrites": 1 })).toEqual({ sqlPhysical: 8, kvKeysPut: 3, kvKeysDeleted: 2, setAlarm: 1, total: 14 })
})


test("a partial frozen storage patch fails visibly and reports incomplete instrumentation", () => {
  const status: [string, boolean][] = []
  const storage = Object.freeze({ sql: { exec: () => ({}) }, put: async () => {} })
  expect(() => patchStorage({ storage } as unknown as DurableObjectState, "owner", { bump: () => {}, track: () => {}, instrumentation: (kind, complete) => { status.push([kind, complete]) } })).toThrow()
  expect(status).toEqual([["owner", false]])
})


test("incomplete instrumentation remains visible across counter resets", async () => {
  port.instrumentation("owner", true)
  const read = async () => devStatsRoute(new Request("http://localhost/api/dev/stats"), true)!.json<{ billingVersion: number; instrumentation: Record<string, boolean> }>()
  expect((await read()).billingVersion).toBe(1)
  port.instrumentation("owner", false)
  devStatsRoute(new Request("http://localhost/api/dev/stats/reset", { method: "POST" }), true)
  port.instrumentation("owner", true)
  expect(await read()).toMatchObject({ billingVersion: 0, instrumentation: { owner: false } })
})
