import type { FileRef } from "@kiko/protocol"
import type { LocalAttachment } from "./patches"

/*
 * Composer attachments (architecture section 18.1). Each file is stored in the room's file space
 * under `attachments/`, unchanged. The message waits for every upload before its frame leaves,
 * while the transcript shows it at once from the local blob URLs.
 *
 * A file up to the server's one-request limit goes in one PUT. A larger one goes as a multipart
 * upload, in parts of one size, as R2 requires.
 */

const RETRIES = 3
/** The server's largest single request body (`files/upload.ts`). */
const MAX_SINGLE_PUT = 32 * 1024 * 1024
/** Every part but the last is this size. R2 wants at least 5 MiB. */
const PART_BYTES = 16 * 1024 * 1024

/** `attachments/<time>-<name>`, so two sends of `photo.png` never collide. */
export function attachmentPath(name: string, now = Date.now()): string {
  const clean = name.replace(/[/\\\u0000-\u001f]/g, "_").slice(-120) || "file"
  return `attachments/${now.toString(36)}-${clean}`
}

/** The name the human gave a file: `attachments/<time>-photo.png` reads as `photo.png`. */
export function attachmentName(path: string): string {
  const m = /^attachments\/[0-9a-z]+-(.+)$/.exec(path)
  return m ? m[1]! : (path.split("/").pop() ?? path)
}

async function answer<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Upload failed with ${res.status}`)
  return (await res.json()) as T
}

const base = (roomId: string) => `/api/files/${roomId}`
const jsonHeaders = { "content-type": "application/json" }

async function putOnce(roomId: string, body: Blob, type: string, path: string): Promise<FileRef> {
  const res = await fetch(`${base(roomId)}?path=${encodeURIComponent(path)}`, { method: "PUT", headers: { "content-type": type }, body })
  return (await answer<{ file: FileRef }>(res)).file
}

async function putParts(roomId: string, body: Blob, type: string, path: string): Promise<FileRef> {
  const { fileId, uploadId } = await answer<{ fileId: string; uploadId: string }>(
    await fetch(`${base(roomId)}/uploads`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ path, type, size: body.size }) }),
  )
  const at = (rest: string) => `${base(roomId)}/uploads/${encodeURIComponent(fileId)}${rest}?uploadId=${encodeURIComponent(uploadId)}`
  try {
    const parts: { partNumber: number; etag: string }[] = []
    for (let n = 1, from = 0; from < body.size; n++, from += PART_BYTES) {
      parts.push(await answer(await fetch(at(`/${n}`), { method: "PUT", body: body.slice(from, from + PART_BYTES) })))
    }
    return (await answer<{ file: FileRef }>(await fetch(at(""), { method: "POST", headers: jsonHeaders, body: JSON.stringify({ parts }) }))).file
  } catch (e) {
    void fetch(at(""), { method: "DELETE" }).catch(() => {})
    throw e
  }
}

/** Uploads one file, retrying a failure with a growing delay. */
export async function uploadAttachment(roomId: string, file: LocalAttachment): Promise<FileRef> {
  const body = await (await fetch(file.src)).blob()
  const path = attachmentPath(file.name)
  const type = file.type || body.type || "application/octet-stream"
  const put = body.size > MAX_SINGLE_PUT ? putParts : putOnce
  let last: unknown
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await put(roomId, body, type, path)
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw last
}

/** Every file of one message, in order. Resolves once all are stored. */
export function uploadAll(roomId: string, files: readonly LocalAttachment[]): Promise<FileRef[]> {
  return Promise.all(files.map((f) => uploadAttachment(roomId, f)))
}
