import type { CustomApi } from "@kiko/protocol"
import { setCustomProviders } from "../models/catalog"
import { type CustomSpec, cleanBaseUrl, customId, fetchUpstream } from "../models/custom"
import { getSetting, setSetting } from "../lib/settings"

const KEY = "customProviders"
const REFRESH_MS = 60 * 60 * 1000

const queues = new WeakMap<SqlStorage, Promise<unknown>>()

function enqueue<T>(sql: SqlStorage, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(sql) ?? Promise.resolve()
  const run = previous.catch(() => {}).then(task)
  const tail = run.catch(() => {})
  queues.set(sql, tail)
  void tail.then(() => {
    if (queues.get(sql) === tail) queues.delete(sql)
  })
  return run
}

function stored(sql: SqlStorage): CustomSpec[] {
  const text = getSetting(sql, KEY)
  return text ? (JSON.parse(text) as CustomSpec[]) : []
}

export function restoreCustom(sql: SqlStorage): void {
  setCustomProviders(stored(sql))
}

function save(sql: SqlStorage, specs: readonly CustomSpec[]): void {
  setSetting(sql, KEY, JSON.stringify(specs))
  setCustomProviders(specs)
}

const REFUSALS = {
  bad_url: "The base URL must be an https:// address.",
  refused: "The provider refused that key.",
  unreachable: "Kiko could not list models at that address. Check the base URL.",
  empty: "That address answered with no models.",
} as const

export async function addCustom(
  sql: SqlStorage,
  input: { name: string; api: CustomApi; baseUrl: string; apiKey: string },
  fetcher: typeof fetch,
): Promise<{ ok: true; spec: CustomSpec } | { ok: false; message: string }> {
  const baseUrl = cleanBaseUrl(input.api, input.baseUrl)
  if (!baseUrl) return { ok: false, message: REFUSALS.bad_url }
  const fetched = await fetchUpstream({ api: input.api, baseUrl }, input.apiKey.trim(), fetcher)
  if (!fetched.ok) return { ok: false, message: REFUSALS[fetched.reason] }
  const name = input.name.trim()
  const spec: CustomSpec = { id: customId(name), name, api: input.api, baseUrl, models: fetched.models }
  await enqueue(sql, async () => {
    save(sql, [...stored(sql).filter((s) => s.id !== spec.id), spec])
  })
  return { ok: true, spec }
}

export function removeCustom(sql: SqlStorage, id: string): Promise<boolean> {
  return enqueue(sql, async () => {
    const specs = stored(sql)
    if (!specs.some((s) => s.id === id)) return false
    save(
      sql,
      specs.filter((s) => s.id !== id),
    )
    return true
  })
}

let refreshedAt = 0

export async function refreshCustom(
  sql: SqlStorage,
  key: (id: string) => Promise<string | undefined>,
  fetcher: typeof fetch,
  now: number,
): Promise<boolean> {
  if (now - refreshedAt < REFRESH_MS) return false
  const specs = stored(sql)
  if (specs.length === 0) return false
  refreshedAt = now
  const refreshed = await Promise.all(
    specs.map(async (spec) => {
      const secret = await key(spec.id)
      const fetched = secret ? await fetchUpstream(spec, secret, fetcher) : null
      return fetched?.ok && JSON.stringify(fetched.models) !== JSON.stringify(spec.models)
        ? { ...spec, models: fetched.models }
        : spec
    }),
  )
  return enqueue(sql, async () => {
    const current = stored(sql)
    const byId = new Map(refreshed.map((spec) => [spec.id, spec]))
    let changed = false
    const next = current.map((spec) => {
      const fresh = byId.get(spec.id)
      const before = specs.find((s) => s.id === spec.id)
      if (!fresh || !before || JSON.stringify(before) !== JSON.stringify(spec)) return spec
      if (JSON.stringify(fresh.models) === JSON.stringify(spec.models)) return spec
      changed = true
      return { ...spec, models: fresh.models }
    })
    if (changed) save(sql, next)
    return changed
  })
}
