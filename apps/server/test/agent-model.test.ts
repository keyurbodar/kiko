import { expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

test("changing an agent's model configures its retained Harness before the next run", async () => {
  const mf = new Miniflare({ modules: true, script: await bundleWorker(new URL("./agent-model-worker.ts", import.meta.url)), compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], durableObjects: { T: { className: "T", useSQLite: true } } })
  try {
    const ns = await mf.getDurableObjectNamespace("T")
    const object = ns.get(ns.newUniqueId())
    const first = await (await object.fetch("http://do/?model=before")).json()
    const next = await (await object.fetch("http://do/?model=after")).json()
    expect(first).toMatchObject({ model: "before", content: [{ type: "text", text: "before" }] })
    expect(next).toMatchObject({ model: "after", content: [{ type: "text", text: "after" }] })
  } finally { await mf.dispose() }
}, 30_000)
