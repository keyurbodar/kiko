import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import snapshot from "./fixtures/schema-columns.json"

// The columns each object's tables had before the schema was squashed to one version. A table is created
// in its final shape at first boot, so this catches a fold that moved, retyped, or dropped a column.
// A deliberate schema change updates fixtures/schema-columns.json in the same change.
let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./schema-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { ROOM: { className: "RoomProbe", useSQLite: true }, USER: { className: "UserProbe", useSQLite: true } },
  })
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
})

async function fresh(kind: "room" | "user") {
  const res = await mf.dispatchFetch(`http://do/${kind}`)
  return await res.json()
}

test("a fresh room has every table in its final shape", async () => {
  expect(await fresh("room")).toEqual(snapshot.room)
}, 30_000)

test("a fresh user has every table in its final shape", async () => {
  expect(await fresh("user")).toEqual(snapshot.user)
}, 30_000)
