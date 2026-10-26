export type Storage = { objectBytes: number; archiveEnabled: boolean }

export const OBJECT_LIMIT_BYTES = 1_000_000_000

const WARN_BYTES = 800_000_000

export const nearlyFull = (s: Storage) => !s.archiveEnabled && s.objectBytes >= WARN_BYTES

export function formatSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), 3)
  const n = bytes / 1_000 ** i
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${["B", "KB", "MB", "GB"][i]}`
}
