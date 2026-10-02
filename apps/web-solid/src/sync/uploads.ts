import type { FileRef } from "@kiko/protocol"

/*
 * Composer attachments (P8-06, architecture section 18.1). Each file goes to the room's file space
 * in one PUT under `attachments/`, with the dimensions the client already measured, so the server
 * only has to compute the thumbhash. The message waits for every upload before its frame leaves,
 * while the transcript shows it at once from the local blob URLs.
 *
 * ASSUMPTION: a single PUT per file (the server's limit is 32 MB). Larger files and multipart
 * uploads come later. Nothing is compressed in the client.
 */

export type LocalFile = { src: string; name: string; mime: string; width?: number; height?: number }

const RETRIES = 3

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

async function putOnce(roomId: string, file: LocalFile, body: Blob, path: string): Promise<FileRef> {
  const headers: Record<string, string> = { "content-type": file.mime || body.type || "application/octet-stream" }
  if (file.width && file.height) {
    headers["x-kiko-width"] = String(file.width)
    headers["x-kiko-height"] = String(file.height)
  }
  const res = await fetch(`/api/files/${roomId}?path=${encodeURIComponent(path)}`, { method: "PUT", headers, body })
  if (!res.ok) throw new Error(`upload failed with ${res.status}`)
  return ((await res.json()) as { file: FileRef }).file
}

/** Uploads one file, retrying a failure with a growing delay. */
export async function uploadAttachment(roomId: string, file: LocalFile): Promise<FileRef> {
  const body = await (await fetch(file.src)).blob()
  const path = attachmentPath(file.name)
  let last: unknown
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await putOnce(roomId, file, body, path)
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw last
}

/** Every file of one message, in order. Resolves once all are stored. */
export function uploadAll(roomId: string, files: readonly LocalFile[]): Promise<FileRef[]> {
  return Promise.all(files.map((f) => uploadAttachment(roomId, f)))
}
