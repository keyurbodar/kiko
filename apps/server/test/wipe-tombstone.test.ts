import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

async function start(dir: string) {
  return new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./wipe-tombstone-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { ROOM: { className: "RoomDO", useSQLite: true }, AGENT: { className: "AgentDO", useSQLite: true } },
    durableObjectsPersist: dir,
  })
}

async function get<T>(mf: Miniflare, path: string): Promise<T> {
  const res = await mf.dispatchFetch(`http://do${path}`)
  return (await res.json()) as T
}

test("a wiped room refuses a socket after it is evicted and restarted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yuki-wipe-room-"))
  const first = await start(dir)
  expect(await get(first, "/room/socket")).toEqual({ status: 101 })
  await get(first, "/room/wipe")
  await first.dispose()

  const second = await start(dir)
  expect(await get(second, "/room/socket")).toEqual({ status: 410 })
  await second.dispose()
}, 60_000)

test("a wiped agent refuses work after it is evicted and restarted, and stores none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yuki-wipe-agent-"))
  const first = await start(dir)
  await get(first, "/agent/wipe")
  await first.dispose()

  const second = await start(dir)
  const answer = await get<{ admitted?: string[]; error?: string }>(second, "/agent/receive")
  expect(answer.error).toBe("this agent was deleted")
  expect(await get(second, "/agent/rows")).toBe(0)
  await second.dispose()
}, 60_000)
