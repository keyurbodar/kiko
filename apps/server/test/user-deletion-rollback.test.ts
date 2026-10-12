import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

const ROOM = "01J0000000000000000000000R"
const USER = "rollback"

async function start() {
  return new Miniflare({
    modules: true,
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url)),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
    d1Databases: ["AUTH_DB"],
    bindings: { CREDENTIALS_KEK: "kek-test-rollback" },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), "yuki-rollback-")),
  })
}

async function rpc(mf: Miniflare, method: string, ...args: unknown[]) {
  const res = await mf.dispatchFetch(`http://do/user/${USER}`, { method: "POST", body: JSON.stringify({ method, args }) })
  return ((await res.json()) as { result: unknown }).result
}

// The start tombstones the account, then sets the mark. A rollback restores the account, then clears the mark. If the clear never lands, the mark is stale.
test("a rollback whose cancel never landed stops the account's jobs and lets the account back in", async () => {
  const mf = await start()
  try {
    const db = await mf.getD1Database("AUTH_DB")
    await db.exec('CREATE TABLE "deleted_user" ("id" TEXT PRIMARY KEY, "deletedAt" INTEGER)')
    await db.prepare('INSERT INTO "deleted_user" ("id", "deletedAt") VALUES (?, ?)').bind(USER, 1).run()
    const { generation } = (await rpc(mf, "beginDeletion")) as { generation: number }
    expect(await rpc(mf, "recordRoom", ROOM)).toBe(false)
    expect(await rpc(mf, "deletionCurrent", generation)).toBe(true)

    await db.prepare('DELETE FROM "deleted_user" WHERE "id" = ?').bind(USER).run()
    expect(await rpc(mf, "deletionCurrent", generation)).toBe(false)
    expect(await rpc(mf, "recordRoom", ROOM)).toBe(true)
  } finally {
    await mf.dispose()
  }
}, 60_000)
