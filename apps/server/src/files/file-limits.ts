/** One chunk is one row. A SQLite value holds at most 2 MB, so a megabyte leaves room. */
export const CHUNK_BYTES = 1024 * 1024
/** The largest file the Durable Object store takes. The Free plan caps a request body at 100 MB. */
export const MAX_STORE_FILE_BYTES = 100 * 1024 * 1024
/**
 * What one chat or the drive may hold here. Free allows 5 GB across all objects and one object holds
 * 1 GB on the Free plan (the limits page gives both), so a space stays under the smaller.
 */
export const MAX_SPACE_BYTES = 800 * 1024 * 1024
export const STORAGE_FULL = "Storage is full. Delete some files, or turn on R2 for more room."
export const FILE_TOO_LARGE = "That file is too large for Kiko's built-in storage."

export type StoredInfo = { size: number; type: string; meta: Record<string, string>; etag: string }
