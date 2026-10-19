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
    durableObjects: {
      USER: { className: "UserDO", useSQLite: true },
      ROOM: { className: "RoomDO", useSQLite: true },
      AGENT: { className: "AgentProbe", useSQLite: true },
    },
  })
  await mf.ready
}, 60_000)
afterAll(async () => { await mf?.dispose() })

test("an ongoing agent sees additions, edits and deletions without reloading its conversation", async () => {
  const user = await mf.getDurableObjectNamespace("USER")
  const agent = await mf.getDurableObjectNamespace("AGENT")
  const owner = user.get(user.idFromName("user:alice"))
  const stub = agent.get(agent.newUniqueId())
  const input = async (fresh = false, withLife = true) => {
    const res = await stub.fetch("http://do/", { method: "POST", body: JSON.stringify({ fresh, withLife }) })
    return res.json<{ text?: string; fresh: boolean }>()
  }
  const setLife = async (text: string) => {
    await owner.setLife(text)
  }
  expect((await input(true)).text).toContain("(nothing yet)")
  await setLife("#1 human: add a short joke")
  expect((await input()).text).toContain("#1 human: add a short joke")
  expect((await input()).text).toBeUndefined()
  await setLife("#2 radar: the human prefers tea")
  const corrected = await input()
  expect(corrected.text).toContain("replaces earlier life blocks")
  expect(corrected.text).toContain("prefers tea")
  expect(corrected.text).not.toContain("short joke")
  await setLife("")
  expect((await input()).text).toContain("(nothing yet)")
  await setLife("#3 private worker must not receive this")
  expect((await input(false, false)).text).toBeUndefined()
  expect((await input()).text).toContain("#3 private worker must not receive this")
}, 30_000)
