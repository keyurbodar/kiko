import { apiFetch } from "../lib/api"

/** What `GET /api/storage` answers: the owner object's size, and whether R2 takes history older than 30 days. */
export type Storage = { objectBytes: number; archiveEnabled: boolean }

/** A Durable Object on the free plan holds 1 GB. */
export const OBJECT_LIMIT_BYTES = 1_000_000_000

/** The size at which an install without R2 is told to turn it on. */
export const WARN_BYTES = 800_000_000

/** An answer reduced to the contract, or null when it is not that. */
export function readStorage(value: unknown): Storage | null {
  const v = (value ?? {}) as Record<string, unknown>
  if (typeof v.objectBytes !== "number" || !Number.isFinite(v.objectBytes) || v.objectBytes < 0 || typeof v.archiveEnabled !== "boolean") return null
  return { objectBytes: v.objectBytes, archiveEnabled: v.archiveEnabled }
}

/** Only an install that cannot archive has anything to act on. */
export const nearlyFull = (s: Storage) => !s.archiveEnabled && s.objectBytes >= WARN_BYTES

/** `812 MB`, `1.2 GB`. Decimal, like the plan's 1 GB. */
export function formatSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), 3)
  const n = bytes / 1_000 ** i
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${["B", "KB", "MB", "GB"][i]}`
}

/** Throws when the request fails or the answer is not the contract, so a resource reads it as an error. */
export async function fetchStorage(): Promise<Storage> {
  const res = await apiFetch("/api/storage")
  const storage = res.ok ? readStorage(await res.json().catch(() => null)) : null
  if (!storage) throw new Error("storage")
  return storage
}
