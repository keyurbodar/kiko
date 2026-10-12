import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// A recall with no word match falls back to a substring search of the life log. That search runs on a trigram
// index, so these cases pin what it finds: a fragment inside a word, a line the human removed, and a query too
// short to search.
let mf: Miniflare

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { CREDENTIALS_KEK: "kek-test-life-substring" },
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
  })
}, 60_000)

afterAll(async () => {
  await mf?.dispose()
})

let n = 0
const fresh = () => `sub${++n}${Date.now().toString(36)}`

async function rpc(user: string, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/rpc/${user}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: any }).result
}

const ROOM = "01J0000000000000000000000S"

test("a fragment inside a word finds the line when no word matches", async () => {
  const user = fresh()
  await rpc(user, "lifeNote", "ada", "the human keeps ovenmitts by the door")
  expect(((await rpc(user, "lifeRecall", "enmit")) as string[]).join()).toContain("ovenmitts by the door")
})

test("a line the human removed stops matching a substring search", async () => {
  const user = fresh()
  await rpc(user, "lifeNote", "ada", "the human keeps ovenmitts by the door", `room:${ROOM}:msg:m1`)
  expect(((await rpc(user, "lifeRecall", "enmit")) as string[]).length).toBe(1)
  await rpc(user, "forgetMessages", ROOM, ["m1"], [], [])
  expect(await rpc(user, "lifeRecall", "enmit")).toEqual([])
})

test("a query under three characters is not searched as a substring", async () => {
  const user = fresh()
  await rpc(user, "lifeNote", "ada", "the human keeps ovenmitts by the door")
  expect(await rpc(user, "lifeRecall", "en")).toEqual([])
})
