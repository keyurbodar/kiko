import { apiFetch } from "../lib/api"

export type Storage = { objectBytes: number; archiveEnabled: boolean }

export const OBJECT_LIMIT_BYTES = 1_000_000_000

const WARN_BYTES = 800_000_000

function readStorage(value: unknown): Storage | null {
  const v = (value ?? {}) as Record<string, unknown>
  if (
    typeof v.objectBytes !== "number" ||
    !Number.isFinite(v.objectBytes) ||
    v.objectBytes < 0 ||
    typeof v.archiveEnabled !== "boolean"
  )
    return null
  return { objectBytes: v.objectBytes, archiveEnabled: v.archiveEnabled }
}

export const nearlyFull = (s: Storage) => !s.archiveEnabled && s.objectBytes >= WARN_BYTES

export function formatSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), 3)
  const n = bytes / 1_000 ** i
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${["B", "KB", "MB", "GB"][i]}`
}

export async function fetchStorage(): Promise<Storage> {
  const res = await apiFetch("/api/storage")
  const storage = res.ok ? readStorage(await res.json().catch(() => null)) : null
  if (!storage) throw new Error("storage")
  return storage
}
