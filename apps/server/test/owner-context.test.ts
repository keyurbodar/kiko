import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
let mf: Miniflare
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: await bundleWorker(new URL("./owner-context-worker.ts", import.meta.url)), compatibilityDate: "2026-07-01", durableObjects: { T: { className: "T", useSQLite: true } } })
})
afterAll(async () => { await mf?.dispose() })
test("scoped SQLite preserves columns, aliases, FTS triggers, catalog predicates and erase isolation", async () => {
  const ns = await mf.getDurableObjectNamespace("T")
  const response = await ns.get(ns.newUniqueId()).fetch("http://do/")
  const out = await response.json() as Record<string, unknown>
  expect(out.overlap).toEqual({ agents: "agents", agents_alias: "hello" })
  expect(out.qualified).toEqual({ agents: "agents" })
  expect(out.aliased).toEqual({ agents: "agents" })
  expect(out.columns).toMatchObject([{ name: "id" }, { name: "agents" }, { name: "text" }])
  expect(out.catalog).toMatchObject([{ name: "chats" }])
  expect(out.found).toEqual([{ agents: "agents" }])
  expect(out.deleted).toEqual([])
  expect(out.a).toEqual([])
  expect(out.b).toEqual([{ agents: "agents" }])
  expect(out.bSearch).toEqual([{ rowid: 1 }])
  expect(out.tombstone).toEqual({ value: "1" })
}, 30_000)
