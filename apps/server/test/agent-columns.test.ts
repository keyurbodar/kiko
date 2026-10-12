import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare

beforeAll(async () => {
  const script = await bundleWorker(new URL("./workers-worker.ts", import.meta.url))
  mf = new Miniflare({ modules: true, script, compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], durableObjects: { T: { className: "T", useSQLite: true } } })
})

afterAll(async () => {
  await mf?.dispose()
})

type Column = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }

// The column list a fresh agent object creates, in table order. A migration that adds a column
// later, or folds an ALTER into a CREATE with a different order, changes this and fails here.
const EXPECTED: Record<string, string[]> = {
  inbox: [
    "id TEXT NOT NULL PRIMARY KEY",
    "arrival INTEGER NOT NULL",
    "priority INTEGER NOT NULL",
    "envelope TEXT NOT NULL",
    "brief TEXT NOT NULL",
    "request_id TEXT",
    "submitted INTEGER NOT NULL DEFAULT 0",
    "in_flight_at INTEGER",
    "in_flight_by TEXT",
    "at INTEGER",
  ],
  inbox_state: ["id INTEGER PRIMARY KEY", "arrival INTEGER NOT NULL", "pruned_at INTEGER NOT NULL"],
  workers: [
    "n INTEGER PRIMARY KEY",
    "id TEXT NOT NULL",
    "task_id TEXT NOT NULL",
    "task TEXT NOT NULL",
    "conversation_id INTEGER",
    "submission_id INTEGER",
    "status TEXT NOT NULL",
    "step TEXT",
    "steps INTEGER NOT NULL DEFAULT 0",
    "changed TEXT NOT NULL DEFAULT '[]'",
    "delivered INTEGER NOT NULL DEFAULT 0",
    "origin TEXT NOT NULL",
    "started_at INTEGER NOT NULL",
    "updated_at INTEGER NOT NULL",
    "resumes INTEGER NOT NULL DEFAULT 0",
  ],
  harness_epoch: ["id INTEGER PRIMARY KEY", "n INTEGER NOT NULL"],
  run_origin: ["id INTEGER PRIMARY KEY", "origin TEXT NOT NULL", "started_at INTEGER NOT NULL", "steered INTEGER NOT NULL DEFAULT 0"],
}

const describe = (c: Column) => `${c.name} ${c.type}${c.notnull ? " NOT NULL" : ""}${c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : ""}${c.pk ? " PRIMARY KEY" : ""}`

test("a fresh agent object creates core/agent's tables with the same columns, in the same order", async () => {
  const ns = await mf.getDurableObjectNamespace("T")
  const res = await ns.get(ns.newUniqueId()).fetch("http://do/", { method: "POST", body: JSON.stringify({ op: "columns" }) })
  const dump = (await res.json()) as Record<string, Column[]>
  expect(Object.fromEntries(Object.entries(dump).map(([table, columns]) => [table, columns.map(describe)]))).toEqual(EXPECTED)
}, 60_000)
