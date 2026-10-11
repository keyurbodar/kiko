import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

const ROOM = "01J0000000000000000000000R"
const dir = mkdtempSync(join(tmpdir(), "yuki-tombstone-"))

async function start() {
  return new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
    bindings: { CREDENTIALS_KEK: "kek-test-tombstone" },
    durableObjectsPersist: dir,
  })
}

async function rpc(mf: Miniflare, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch("http://do/user/wiped", { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: unknown }).result
}

test("a wiped user object refuses new rows after it is evicted and restarted", async () => {
  const first = await start()
  await rpc(first, "createChat", ROOM, "before")
  await rpc(first, "deleteAll")
  expect(await rpc(first, "recordRoom", ROOM)).toBe(false)
  await first.dispose()

  const second = await start()
  expect(await rpc(second, "recordRoom", ROOM)).toBe(false)
  await second.dispose()
}, 60_000)
