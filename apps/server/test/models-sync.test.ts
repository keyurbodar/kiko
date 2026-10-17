import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./models-sync-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { CATALOG: { className: "CatalogDO", useSQLite: true } },
  })
})

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `ms${++n}${Date.now().toString(36)}`

async function rpc(name: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/${name}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

// The worker turns "newer" into a date one day after the bundled pi-ai data, so a pi upgrade never ages it out.
const NEWER = "newer"
const OLDER = "Wed, 01 Jan 2020 00:00:00 GMT"

async function start() {
  const name = fresh()
  await rpc(name, "restart")
  return name
}

test("a 200 stores the new models, applies them, and sends the etag back on the next request", async () => {
  const name = await start()
  const body = { "opencode-go": [await rpc(name, "model", "live-one")], nowhere: [await rpc(name, "model", "ignored")] }
  const first = await rpc(name, "sync", { status: 200, etag: '"v1"', lastModified: NEWER, body })
  expect(first.changed).toBe(true)
  expect(first.seen[0].ifNoneMatch).toBeNull()
  const after = await rpc(name, "state")
  expect(after.stored).toEqual({ "opencode-go": ["live-one"] })
  expect(after.live).toEqual(["live-one"])
  expect(after.state).toMatchObject({ etag: '"v1"', checkedAt: 61_000 })
  expect(after.revision).toBe(after.state.revision)
  const second = await rpc(name, "sync", { status: 304 })
  expect(second.seen[0].ifNoneMatch).toBe('"v1"')
})

test("a 304 keeps the overlay and moves only checkedAt", async () => {
  const name = await start()
  await rpc(name, "sync", { status: 200, etag: '"v1"', lastModified: NEWER, body: { "opencode-go": [await rpc(name, "model", "live-one")] } })
  const before = await rpc(name, "state")
  const out = await rpc(name, "sync", { status: 304 })
  const after = await rpc(name, "state")
  expect(out.changed).toBe(false)
  expect(after.stored).toEqual(before.stored)
  expect(after.live).toEqual(["live-one"])
  expect(after.state).toEqual({ ...before.state, checkedAt: before.state.checkedAt + 60_000 })
})

test("a server error keeps the etag and the overlay and records the failure", async () => {
  const name = await start()
  await rpc(name, "sync", { status: 200, etag: '"v1"', lastModified: NEWER, body: { "opencode-go": [await rpc(name, "model", "live-one")] } })
  for (const reply of [{ status: 500 }, { status: 200, throws: true }]) {
    const out = await rpc(name, "sync", reply)
    const after = await rpc(name, "state")
    expect(out.changed).toBe(false)
    expect(after.state.etag).toBe('"v1"')
    expect(after.state.error).toBeTruthy()
    expect(after.live).toEqual(["live-one"])
  }
  const recovered = await rpc(name, "sync", { status: 304 })
  expect(recovered.seen[0].ifNoneMatch).toBe('"v1"')
  expect((await rpc(name, "state")).state.error).toBeUndefined()
})

test("a 404 empties the overlay and forgets the etag", async () => {
  const name = await start()
  await rpc(name, "sync", { status: 200, etag: '"v1"', lastModified: NEWER, body: { "opencode-go": [await rpc(name, "model", "live-one")] } })
  const out = await rpc(name, "sync", { status: 404 })
  const after = await rpc(name, "state")
  expect(out.changed).toBe(true)
  expect(after.stored).toEqual({})
  expect(after.live).toEqual([])
  expect(after.state.etag).toBeUndefined()
  expect((await rpc(name, "sync", { status: 200, lastModified: NEWER, body: {} })).seen[0].ifNoneMatch).toBeNull()
})

test("a response older than the bundled data adds nothing", async () => {
  const name = await start()
  const out = await rpc(name, "sync", { status: 200, etag: '"old"', lastModified: OLDER, body: { "opencode-go": [await rpc(name, "model", "stale-one")] } })
  expect(out.changed).toBe(false)
  expect((await rpc(name, "state")).live).toEqual([])
})

test("a changed price replaces rows, a dropped model leaves them, and the stored overlay survives a restart", async () => {
  const name = await start()
  await rpc(name, "sync", { status: 200, etag: '"v1"', lastModified: NEWER, body: { "opencode-go": [await rpc(name, "model", "a", 1), await rpc(name, "model", "b", 1)] } })
  const same = await rpc(name, "sync", { status: 200, etag: '"v2"', lastModified: NEWER, body: { "opencode-go": [await rpc(name, "model", "a", 1), await rpc(name, "model", "b", 1)] } })
  expect(same.changed).toBe(false)
  const next = await rpc(name, "sync", { status: 200, etag: '"v3"', lastModified: NEWER, body: { "opencode-go": [await rpc(name, "model", "a", 2)] } })
  expect(next.changed).toBe(true)
  expect((await rpc(name, "state")).stored).toEqual({ "opencode-go": ["a"] })
  await rpc(name, "restart")
  expect((await rpc(name, "state")).live).toEqual(["a"])
})
