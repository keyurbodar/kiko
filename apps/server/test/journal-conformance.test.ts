import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Storage } from "@earendil-works/pi-durable"
import { registerStorageConformance } from "@earendil-works/pi-durable/testing"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"
import type { Call, Reply, Wire } from "./journal-conformance-worker"

let mf: Miniflare
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: await bundleWorker(new URL("./journal-conformance-worker.ts", import.meta.url)), compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"], durableObjects: { T: { className: "T", useSQLite: true } } })
})
afterAll(async () => { await mf?.dispose() })

function unpack(wire: Wire): unknown {
  switch (wire[0]) {
    case "undefined": return undefined
    case "scalar": return wire[1]
    case "array": return wire[1].map(unpack)
    case "object": return Object.fromEntries(wire[1].map(([key, value]) => [key, unpack(value)]))
  }
}

for (const reopen of [false, true]) {
  registerStorageConformance({ describe, expect, it }, `JournalStorage ${reopen ? "reopened reads" : "live"}`, async (use) => {
    const namespace = await mf.getDurableObjectNamespace("T")
    const stub = namespace.get(namespace.newUniqueId())
    const storage = new Proxy({} as Storage, {
      get: (_target, method: keyof Storage) => async (...args: unknown[]) => {
        // Contexts are not serializable. The worker supplies the upstream background context.
        if (method !== "mintId") args.pop()
        const call: Call = { method, args: args.map((arg) => arg === undefined ? ["undefined"] : ["value", arg]), reopen }
        const response = await stub.fetch("http://do/", { method: "POST", body: JSON.stringify(call) })
        const reply: Reply = await response.json()
        if (!reply.ok) throw new Error(reply.message)
        return unpack(reply.value)
      },
    })
    try { await use(storage) } finally { await storage.close(BACKGROUND_CONTEXT) }
  })
}
