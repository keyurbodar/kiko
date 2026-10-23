import { isRoomId } from "@kiko/protocol"
import type { Env } from "../index"
import { FILE_TOO_LARGE, STORAGE_FULL } from "./file-limits"
import { fileStore, type FileBucket, maxFileBytes } from "./store"

const MAX_FILE_BYTES = 512 * 1024 * 1024
export const MAX_SINGLE_PUT_BYTES = 32 * 1024 * 1024

const MAX_PATH = 512
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FILES_PATH = /^\/api\/files\/([^/]+)(?:\/(.*))?$/
const R2_DELETE_LIMIT = 1000

export const HOME = "home"
export const isSpace = (id: string) => id === HOME || isRoomId(id)
export const isFileId = (id: string) => FILE_ID.test(id)

export function fileKey(userId: string, roomId: string, fileId: string): string {
  return `u/${userId}/r/${roomId}/${fileId}`
}

export function filesPath(pathname: string): { roomId: string; rest: string[] } | null {
  const m = FILES_PATH.exec(pathname)
  if (!m) return null
  const roomId = m[1]
  if (roomId === undefined) return null
  return { roomId, rest: m[2] ? m[2].split("/") : [] }
}

export async function deleteFiles(bucket: FileBucket, keys: string | readonly string[]): Promise<void> {
  const all = typeof keys === "string" ? [keys] : keys
  for (let i = 0; i < all.length; i += R2_DELETE_LIMIT) await bucket.delete(all.slice(i, i + R2_DELETE_LIMIT))
}

export function storageRefusal(e: unknown): string | null {
  const message = e instanceof Error ? e.message : ""
  return message === STORAGE_FULL || message === FILE_TOO_LARGE ? message : null
}

export const tooLarge = (env: Pick<Env, "FILES">): string =>
  env.FILES ? "That file is over 512 MB, the most Kiko takes." : FILE_TOO_LARGE

export function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

export function isControl(c: string): boolean {
  const n = c.charCodeAt(0)
  return n <= 0x1f || n === 0x7f
}

export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw.length > MAX_PATH) return null
  if ([...raw].some((c) => c === "\\" || isControl(c))) return null
  const parts = raw.split("/")
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null
  return raw
}

export function declaredSize(raw: string | null | undefined): number | null {
  const n = raw === null || raw === undefined || raw === "" ? Number.NaN : Number(raw)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

export function mime(raw: unknown): string {
  const type = typeof raw === "string" ? (raw.split(";", 1)[0] ?? "").trim().toLowerCase() : ""
  return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(type) ? type : "application/octet-stream"
}

export async function json(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.includes("application/json")) return null
  try {
    const body = await request.json()
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function refuse(size: number, env: Env): Response | null {
  return size > maxFileBytes(env, MAX_FILE_BYTES) ? error(413, tooLarge(env)) : null
}

export async function part(request: Request, env: Env, key: string, uploadId: string, n: number): Promise<Response> {
  const length = declaredSize(request.headers.get("content-length"))
  if (length === null) return error(411, "content-length required")
  if (length > MAX_SINGLE_PUT_BYTES) return error(413, "part too large")
  try {
    const body = (request.body ?? new Blob([]).stream()).pipeThrough(new FixedLengthStream(length))
    const uploaded = await fileStore(env).resumeMultipartUpload(key, uploadId).uploadPart(n, body)
    return Response.json({ partNumber: uploaded.partNumber, etag: uploaded.etag })
  } catch (e) {
    const why = storageRefusal(e)
    return why ? error(413, why) : error(404, "no such upload")
  }
}
