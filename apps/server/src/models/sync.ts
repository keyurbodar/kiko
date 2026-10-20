import type { AnyModel } from "@earendil-works/pi-ai"
import { getBuiltinModelDataGeneratedAt } from "@earendil-works/pi-ai/providers/all"
import { getSetting, setSetting } from "../lib/settings"
import { applyOverlay, type CatalogOverlay, computeOverlay } from "./catalog"

// One aggregate request. pi's own client sends one per provider, which would spend 42 of the Free plan's 50 subrequests.
const CATALOG_URL = "https://pi.dev/api/models?types=chat,image,classifier"
const ATTEMPT_TIMEOUT_MS = 4_000
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

const STATE_KEY = "model_catalog"

type CatalogState = {
  etag?: string
  lastModified: number
  checkedAt: number
  revision: string
  error?: string
}

export type SyncDeps = {
  sql: SqlStorage
  fetch: (url: string, init: RequestInit) => Promise<Response>
  now: () => number
}

export async function revisionOf(overlay: CatalogOverlay): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(overlay)))
  return [...new Uint8Array(digest).slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function readState(sql: SqlStorage): CatalogState | null {
  const raw = getSetting(sql, STATE_KEY)
  return raw ? (JSON.parse(raw) as CatalogState) : null
}

export function writeState(sql: SqlStorage, state: CatalogState): void {
  setSetting(sql, STATE_KEY, JSON.stringify(state))
}

function readOverlay(sql: SqlStorage): CatalogOverlay {
  const out: CatalogOverlay = {}
  for (const row of sql.exec<{ provider_id: string; models: string }>("SELECT provider_id, models FROM model_catalog").toArray()) {
    out[row.provider_id] = JSON.parse(row.models) as AnyModel[]
  }
  return out
}

export function writeOverlay(sql: SqlStorage, overlay: CatalogOverlay): void {
  sql.exec("DELETE FROM model_catalog WHERE provider_id NOT IN (SELECT value FROM json_each(?))", JSON.stringify(Object.keys(overlay)))
  sql.exec(
    "INSERT INTO model_catalog (provider_id, models) SELECT key, value FROM json_each(?) WHERE true ON CONFLICT(provider_id) DO UPDATE SET models = excluded.models",
    JSON.stringify(overlay),
  )
}

/** Loads the stored overlay into this process. An overlay the bundled data has caught up with is dropped, as pi does. */
export function restoreOverlay(sql: SqlStorage): void {
  const state = readState(sql)
  const generated = getBuiltinModelDataGeneratedAt()
  const fresh = state !== null && (generated === undefined || state.lastModified > generated)
  applyOverlay(fresh ? readOverlay(sql) : {}, fresh ? state.revision : "")
}

export function isStale(sql: SqlStorage, now: number): boolean {
  const state = readState(sql)
  return state === null || now - state.checkedAt > STALE_AFTER_MS
}

async function request(deps: SyncDeps, etag: string | undefined): Promise<Response | string> {
  try {
    return await deps.fetch(CATALOG_URL, {
      headers: { accept: "application/json", ...(etag ? { "if-none-match": etag } : {}) },
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    })
  } catch (error) {
    return error instanceof Error ? error.name : "error"
  }
}

/**
 * One conditional GET of the aggregate catalog, with pi's outcomes: 304 moves only checkedAt, 404 and 501
 * store an empty overlay, any other failure keeps the cached body and its etag. Never throws.
 * Returns whether the overlay changed.
 */
export async function syncCatalog(deps: SyncDeps): Promise<boolean> {
  const { sql } = deps
  const stored = readState(sql)
  const kept = (error?: string): CatalogState => ({ ...(stored ?? { lastModified: 0, revision: "" }), checkedAt: deps.now(), ...(error ? { error } : {}) })
  const response = await request(deps, stored?.etag)
  if (typeof response === "string") {
    writeState(sql, kept(response))
    return false
  }
  const missing = response.status === 404 || response.status === 501
  if (response.status === 304 && stored) {
    const { error: _, ...rest } = kept()
    writeState(sql, rest)
    return false
  }
  if (!response.ok && !missing) {
    writeState(sql, kept(`status ${response.status}`))
    return false
  }
  let overlay: CatalogOverlay = {}
  let lastModified = 0
  if (!missing) {
    try {
      const modified = Date.parse(response.headers.get("last-modified") ?? "")
      lastModified = Number.isNaN(modified) ? 0 : modified
      overlay = computeOverlay(await response.json(), lastModified, getBuiltinModelDataGeneratedAt())
    } catch {
      writeState(sql, kept("bad body"))
      return false
    }
  }
  const revision = await revisionOf(overlay)
  const changed = revision !== (stored?.revision ?? (await revisionOf({})))
  if (changed) writeOverlay(sql, overlay)
  const etag = missing ? undefined : (response.headers.get("etag") ?? undefined)
  writeState(sql, { lastModified, checkedAt: deps.now(), revision, ...(etag ? { etag } : {}) })
  applyOverlay(overlay, revision)
  return changed
}
