export const CHUNK_BYTES = 1024 * 1024
export const MAX_STORE_FILE_BYTES = 100 * 1024 * 1024
export const MAX_SPACE_BYTES = 800 * 1024 * 1024
export const STORAGE_FULL = "This chat's built-in storage is full (800 MB). Delete some files to make room."
export const FILE_TOO_LARGE = "That file is over 100 MB, the most Kiko's built-in storage takes."

export type StoredInfo = { size: number; type: string; meta: Record<string, string>; etag: string }
