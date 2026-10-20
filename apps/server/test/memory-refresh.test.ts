import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./memory-refresh-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { OWNER: { className: "RefreshOwner", useSQLite: true } },
  })
  await mf.ready
}, 60_000)
afterAll(async () => { await mf?.dispose() })

test("an ongoing agent sees additions, edits and deletions without reloading its conversation", async () => {
  const namespace = await mf.getDurableObjectNamespace("OWNER")
  const owner = namespace.get(namespace.idFromName("owner:alice"))
  const input = (fresh = false, withLife = true) => owner.input(fresh, withLife) as Promise<{ text?: string; fresh: boolean }>
  const setLife = async (text: string) => {
    await owner.setLife(text)
  }
  expect((await input(true)).text).toContain("(nothing yet)")
  await setLife("#1 human: add a short joke")
  const added = await input()
  expect(added.text).toContain("#1 human: add a short joke")
  expect(added.fresh).toBe(true)
  expect((await input()).text).toBeUndefined()
  await setLife("#2 radar: the human prefers tea")
  const corrected = await input()
  expect(corrected.fresh).toBe(true)
  expect(corrected.text).toContain("prefers tea")
  expect(corrected.text).not.toContain("short joke")
  await setLife("")
  const removed = await input()
  expect(removed.text).toContain("(nothing yet)")
  expect(removed.fresh).toBe(true)
  await setLife("")
  expect((await input()).fresh).toBe(true)
  await setLife("#3 private worker must not receive this")
  expect((await input(false, false)).text).toBeUndefined()
  expect((await input()).text).toContain("#3 private worker must not receive this")
}, 30_000)
