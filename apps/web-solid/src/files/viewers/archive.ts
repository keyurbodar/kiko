export const ARCHIVE_MAX_BYTES = 25 * 1024 * 1024

export type ArchiveEntry = { name: string; size: number; modified: number | null; directory: boolean }

export type ArchiveRequest = { type: "open"; src: string }

export type ArchiveResult =
  | { type: "entries"; entries: ArchiveEntry[]; size: number }
  | { type: "error"; message: string }
