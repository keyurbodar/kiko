import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import snapshot from "./fixtures/schema-columns.json"

// The columns each object's tables have on a fresh object, from its schema list. A deliberate schema change
// appends a step and updates fixtures/schema-columns.json in the same change. An upgraded object is checked
// against a fresh one in schema-upgrade.test.ts.
let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./schema-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      ROOM: { className: "RoomProbe", useSQLite: true },
      USER: { className: "UserProbe", useSQLite: true },
      AGENT: { className: "AgentProbe", useSQLite: true },
    },
  })
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
})

async function fresh(kind: "room" | "user" | "agent") {
  const res = await mf.dispatchFetch(`http://do/${kind}`)
  return await res.json()
}

test("a fresh room has every table in its final shape", async () => {
  expect(await fresh("room")).toEqual(snapshot.room)
}, 30_000)

test("a fresh user has every table in its final shape", async () => {
  expect(await fresh("user")).toEqual(snapshot.user)
}, 30_000)

test("a fresh agent has every table in its final shape", async () => {
  expect(await fresh("agent")).toEqual(snapshot.agent)
}, 30_000)
