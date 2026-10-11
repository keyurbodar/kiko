// Under `wrangler dev` every object of one Worker shares one isolate, so this module-level table sees them all.

declare const process: { env: { NODE_ENV?: string } }

const dev = () => process.env.NODE_ENV === "development"
const counters = new Map<string, number>()
const open: { kind: string; write: boolean; cursor: SqlStorageCursor<Record<string, SqlStorageValue>> }[] = []

function bump(key: string, n = 1): void {
  counters.set(key, (counters.get(key) ?? 0) + n)
}

function settle(): void {
  for (const { kind, write, cursor } of open.splice(0)) {
    bump(`${kind}.rowsRead`, cursor.rowsRead)
    if (write) bump(`${kind}.rowsWritten`, cursor.rowsWritten)
  }
}

const KV = ["get", "put", "delete", "list", "setAlarm", "getAlarm", "deleteAlarm", "transaction"] as const

export function instrument(ctx: DurableObjectState, kind: string): void {
  if (!dev()) return
  const storage = ctx.storage as unknown as Record<string, unknown>
  const sql = ctx.storage.sql
  const exec = sql.exec.bind(sql)
  try {
    Object.defineProperty(sql, "exec", {
      configurable: true,
      value: (query: string, ...bindings: SqlStorageValue[]) => {
        const cursor = exec(query, ...bindings)
        bump(`${kind}.statements`)
        open.push({ kind, write: !/^\s*(SELECT|PRAGMA)/i.test(query), cursor })
        if (open.length > 10_000) settle()
        return cursor
      },
    })
    for (const name of KV) {
      const fn = storage[name]
      if (typeof fn !== "function") continue
      Object.defineProperty(storage, name, {
        configurable: true,
        value: (...args: unknown[]) => {
          bump(`${kind}.kv.${name}`)
          return Reflect.apply(fn as (...a: unknown[]) => unknown, ctx.storage, args)
        },
      })
    }
  } catch {
  }
}

export function rpc<T extends object>(stub: T, target: string): T {
  if (!dev()) return stub
  return new Proxy(stub, {
    get(obj, key, receiver) {
      const value = Reflect.get(obj, key, receiver)
      if (typeof key !== "string" || typeof value !== "function" || key === "then") return value
      return (...args: unknown[]) => {
        bump(`rpc.${target}.${key}`)
        return Reflect.apply(value as (...a: unknown[]) => unknown, obj, args)
      }
    },
  })
}

export function count(key: string, n = 1): void {
  if (dev()) bump(key, n)
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export function devStatsRoute(request: Request): Response | null {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/dev/stats")) return null
  if (!dev() || !LOCAL_HOSTS.has(url.hostname)) return Response.json({ error: "not found" }, { status: 404 })
  if (url.pathname === "/api/dev/stats/reset" && request.method === "POST") {
    settle()
    counters.clear()
    return Response.json({ ok: true })
  }
  if (url.pathname === "/api/dev/stats" && request.method === "GET") {
    settle()
    return Response.json({ counters: Object.fromEntries([...counters].sort(([a], [b]) => a.localeCompare(b))) })
  }
  return Response.json({ error: "not found" }, { status: 404 })
}
