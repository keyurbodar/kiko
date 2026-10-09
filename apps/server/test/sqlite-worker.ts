import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Storage } from "@earendil-works/pi-durable"
import { type SqliteDatabase, SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite"
import {
  createStorageConformance,
  type StorageConformanceAssertions,
  type StorageConformanceProvider,
} from "@earendil-works/pi-durable/testing"
import { openDurableObjectSqlite } from "@yuki/agent/sqlite"

type Suite = "fresh" | "reopen" | "facade"
type Case = { name: string; run(): Promise<void> }

const fail = (message: string): never => {
  throw new Error(message)
}
const show = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !ArrayBuffer.isView(value)

function matches(actual: unknown, expected: unknown, subset: boolean): boolean {
  if (Object.is(actual, expected)) return true
  if (ArrayBuffer.isView(actual) && ArrayBuffer.isView(expected)) {
    const a = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength)
    const b = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength)
    return a.length === b.length && a.every((byte, i) => byte === b[i])
  }
  if (Array.isArray(actual) && Array.isArray(expected))
    return actual.length === expected.length && actual.every((item, i) => matches(item, expected[i], subset))
  if (actual instanceof Map && expected instanceof Map)
    return actual.size === expected.size && [...expected].every(([k, v]) => actual.has(k) && matches(actual.get(k), v, subset))
  if (isRecord(actual) && isRecord(expected)) {
    const defined = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined)
    const keys = defined(expected)
    if (!subset && defined(actual).length !== keys.length) return false
    return keys.every((k) => matches(actual[k], expected[k], subset))
  }
  return false
}

export const assertions: StorageConformanceAssertions = {
  ok: (value, message) => void (value || fail(message ?? `expected truthy, got ${show(value)}`)),
  strictEqual: (a, b) => void (Object.is(a, b) || fail(`expected ${show(b)}, got ${show(a)}`)),
  deepEqual: (a, b) => void (matches(a, b, false) || fail(`expected ${show(b)}, got ${show(a)}`)),
  partialDeepEqual: (a, b) => void (matches(a, b, true) || fail(`expected to match ${show(b)}, got ${show(a)}`)),
  greaterThan: (a, b) => void (a > b || fail(`expected ${a} > ${b}`)),
  async rejects(operation, messageIncludes) {
    const error = await operation.then(
      () => fail(`expected a rejection including "${messageIncludes}"`),
      (e: unknown) => e,
    )
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes(messageIncludes)) fail(`expected "${messageIncludes}" in "${message}"`)
  },
}

const open = (storage: DurableObjectStorage) => SqliteStorage.open(openDurableObjectSqlite(storage))

const fresh =
  (storage: DurableObjectStorage): StorageConformanceProvider =>
  async (use) => {
    const durable = await open(storage)
    try {
      await use(durable)
    } finally {
      await durable.close(BACKGROUND_CONTEXT)
    }
  }

const reopen =
  (storage: DurableObjectStorage): StorageConformanceProvider =>
  async (use) => {
    let current = await open(storage)
    let closed = false
    const reopening = new Proxy({} as Storage, {
      get(_target, key: keyof Storage) {
        if (key === "close") closed = true
        if (key !== "commit" || closed) {
          const member = current[key] as unknown
          return typeof member === "function" ? member.bind(current) : member
        }
        const commit: Storage["commit"] = async (writes, context) => {
          try {
            return await current.commit(writes, context)
          } finally {
            await current.close(BACKGROUND_CONTEXT)
            current = await open(storage)
          }
        }
        return commit
      },
    })
    try {
      await use(reopening)
    } finally {
      await current.close(BACKGROUND_CONTEXT)
    }
  }

const conformance = (withStorage: StorageConformanceProvider): Case[] =>
  createStorageConformance({ assertions, withStorage })

function facade(storage: DurableObjectStorage): Case[] {
  const withTable = (run: (db: SqliteDatabase) => Promise<void>) => async () => {
    const db = openDurableObjectSqlite(storage)
    await db.exec("CREATE TABLE t (n INTEGER PRIMARY KEY, label TEXT) STRICT")
    await run(db)
  }
  const insert = (db: Pick<SqliteDatabase, "run">, n: number, label: string | null) =>
    db.run("INSERT INTO t (n, label) VALUES (?, ?)", n, label)
  const labels = async (db: SqliteDatabase) =>
    (await db.all<{ label: string }>("SELECT label FROM t ORDER BY n")).map((row) => row.label)

  return [
    {
      name: "holds an unrelated operation until the running transaction commits",
      run: withTable(async (db) => {
        const order: string[] = []
        const transaction = db.transaction(async (tx) => {
          await insert(tx, 1, "in transaction")
          await scheduler.wait(20)
          order.push("transaction body ends")
        })
        const outside = insert(db, 2, "outside").then(() => order.push("outside ran"))
        const second = db.transaction(async (tx) => {
          order.push("second transaction starts")
          await insert(tx, 3, "second")
        })
        await Promise.all([transaction, outside, second])
        assertions.deepEqual(order, ["transaction body ends", "outside ran", "second transaction starts"])
        assertions.deepEqual(await labels(db), ["in transaction", "outside", "second"])
      }),
    },
    {
      name: "rolls back and rejects with the callback's own error",
      run: withTable(async (db) => {
        const failure = new Error("callback failed")
        const transaction = db.transaction(async (tx) => {
          await insert(tx, 1, "rolled back")
          assertions.deepEqual(await tx.get("SELECT label FROM t WHERE n = ?", 1), { label: "rolled back" })
          throw failure
        })
        const after = insert(db, 2, "kept")
        const error = await transaction.then(() => undefined, (e: unknown) => e)
        assertions.strictEqual(error, failure)
        await after
        assertions.deepEqual(await labels(db), ["kept"])
      }),
    },
    {
      name: "rolls back when a statement fails inside the transaction",
      run: withTable(async (db) => {
        await insert(db, 1, "before")
        await assertions.rejects(
          db.transaction(async (tx) => {
            await insert(tx, 2, "rolled back")
            await insert(tx, 1, "duplicate key")
          }),
          "UNIQUE",
        )
        assertions.deepEqual(await labels(db), ["before"])
      }),
    },
    {
      name: "refuses a transaction handle after its transaction settled",
      run: withTable(async (db) => {
        let leaked: Pick<SqliteDatabase, "run"> | undefined
        await db.transaction(async (tx) => {
          leaked = tx
        })
        await assertions.rejects(insert(leaked ?? fail("no handle"), 1, "late"), "no longer active")
        assertions.deepEqual(await labels(db), [])
      }),
    },
    {
      name: "returns undefined from get when no row matches, and binds null",
      run: withTable(async (db) => {
        assertions.strictEqual(await db.get("SELECT label FROM t WHERE n = ?", 1), undefined)
        await insert(db, 1, null)
        assertions.deepEqual(await db.get("SELECT n, label FROM t WHERE n = ?", 1), { n: 1, label: null })
      }),
    },
    {
      name: "finishes queued work before close, and refuses work after it",
      run: withTable(async (db) => {
        const queued = insert(db, 1, "before close")
        await Promise.all([queued, db.close()])
        await assertions.rejects(db.get("SELECT 1"), "closed")
      }),
    },
  ]
}

const suites: Record<Suite, (storage: DurableObjectStorage) => Case[]> = {
  fresh: (storage) => conformance(fresh(storage)),
  reopen: (storage) => conformance(reopen(storage)),
  facade,
}

export class T extends DurableObject {
  async fetch(request: Request) {
    const { suite, index } = (await request.json()) as { suite: Suite; index?: number }
    const cases = suites[suite](this.ctx.storage)
    if (index === undefined) return Response.json({ names: cases.map((c) => c.name) })
    const testCase = cases[index] ?? fail(`no case ${index}`)
    try {
      await testCase.run()
      return Response.json({ name: testCase.name, ok: true })
    } catch (error) {
      return Response.json({ name: testCase.name, ok: false, error: error instanceof Error ? error.stack : String(error) })
    }
  }
}

export default {
  async fetch() {
    return new Response("not found", { status: 404 })
  },
}
