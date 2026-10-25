import type { CustomApi } from "@kiko/protocol"
import { customSpecs, setCustomProviders } from "../models/catalog"
import { type CustomSpec, cleanBaseUrl, customId, fetchUpstream } from "../models/custom"
import { getSetting, setSetting } from "../lib/settings"

const KEY = "customProviders"
const REFRESH_MS = 60 * 60 * 1000

export function restoreCustom(sql: SqlStorage): void {
  const text = getSetting(sql, KEY)
  setCustomProviders(text ? (JSON.parse(text) as CustomSpec[]) : [])
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
  save(sql, [...customSpecs().filter((s) => s.id !== spec.id), spec])
  return { ok: true, spec }
}

export function removeCustom(sql: SqlStorage, id: string): boolean {
  const specs = customSpecs()
  if (!specs.some((s) => s.id === id)) return false
  save(
    sql,
    specs.filter((s) => s.id !== id),
  )
  return true
}

let refreshedAt = 0

export async function refreshCustom(
  sql: SqlStorage,
  key: (id: string) => Promise<string | undefined>,
  fetcher: typeof fetch,
  now: number,
): Promise<boolean> {
  if (now - refreshedAt < REFRESH_MS || customSpecs().length === 0) return false
  refreshedAt = now
  let changed = false
  const next = await Promise.all(
    customSpecs().map(async (spec) => {
      const secret = await key(spec.id)
      const fetched = secret ? await fetchUpstream(spec, secret, fetcher) : null
      if (!fetched?.ok || JSON.stringify(fetched.models) === JSON.stringify(spec.models)) return spec
      changed = true
      return { ...spec, models: fetched.models }
    }),
  )
  if (changed) save(sql, next)
  return changed
}
