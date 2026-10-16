/** One chunk is one row. A SQLite value holds at most 2 MB, so a megabyte leaves room. */
export const CHUNK_BYTES = 1024 * 1024
/** The largest file the Durable Object store takes. The Free plan caps a request body at 100 MB. */
export const MAX_STORE_FILE_BYTES = 100 * 1024 * 1024
/**
 * What one chat or the drive may hold here. Free allows 5 GB across all objects and one object holds
 * 1 GB on the Free plan (the limits page gives both), so a space stays under the smaller.
 */
export const MAX_SPACE_BYTES = 800 * 1024 * 1024
export const STORAGE_FULL = "This chat's built-in storage is full (800 MB). Delete some files to make room."
export const FILE_TOO_LARGE = "That file is over 100 MB, the most Kiko's built-in storage takes."

export type StoredInfo = { size: number; type: string; meta: Record<string, string>; etag: string }
