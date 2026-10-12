// Under `wrangler dev` every object of one Worker shares one isolate, so this module-level table sees them all.

import type { DevCounterPort } from "./dev-stats-patch"

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

// The storage patch is dev-only and lives in dev-stats-patch.ts; the fold in dev-guard drops it from a
// production bundle. A dev build wires the patch to these counters through one port.
const port: DevCounterPort = {
  bump,
  track(kind, cursor, write) {
    open.push({ kind, write, cursor })
    if (open.length > 10_000) settle()
  },
}

export { bump, port }

export function proxyRpc<T extends object>(stub: T, target: string): T {
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

const live = new Map<string, number>()

// Records the most calls of one key running at once, as a counter that holds the peak until the next reset.
export async function trackInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const now = (live.get(key) ?? 0) + 1
  live.set(key, now)
  counters.set(key, Math.max(counters.get(key) ?? 0, now))
  try {
    return await run()
  } finally {
    live.set(key, (live.get(key) ?? 1) - 1)
  }
}

export function devStatsRoute(request: Request, local: boolean): Response | null {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/dev/stats")) return null
  if (!local) return Response.json({ error: "not found" }, { status: 404 })
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
