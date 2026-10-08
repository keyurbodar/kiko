import type { FileRef } from "@kiko/protocol"

/*
 * Composer attachments (P8-06, architecture section 18.1). Each file goes to the room's file space
 * in one PUT under `attachments/`, with the dimensions the client already measured, so the server
 * only has to compute the thumbhash. The message waits for every upload before its frame leaves,
 * while the transcript shows it at once from the local blob URLs.
 *
 * ASSUMPTION: a single PUT per file (the server's limit is 32 MB). Larger files and multipart
 * uploads come later. The original is never compressed.
 *
 * A picture larger than a transcript cell also gets a small still (840 px on its long edge, WebP)
 * and a thumbhash, made here while the bytes are in hand. The transcript draws the still, so a
 * 12 MP photo costs about 1 MB of decoded pixels instead of 48 MB. Only the viewer loads the original.
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

async function putOnce(roomId: string, file: LocalFile, body: Blob, path: string, thumbhash?: string): Promise<FileRef> {
  const headers: Record<string, string> = { "content-type": file.mime || body.type || "application/octet-stream" }
  if (thumbhash) headers["x-kiko-thumbhash"] = thumbhash
  if (file.width && file.height) {
    headers["x-kiko-width"] = String(file.width)
    headers["x-kiko-height"] = String(file.height)
  }
  const res = await fetch(`/api/files/${roomId}?path=${encodeURIComponent(path)}`, { method: "PUT", headers, body })
  if (!res.ok) throw new Error(`Upload failed with ${res.status}`)
  return ((await res.json()) as { file: FileRef }).file
}

/** Uploads one file, retrying a failure with a growing delay. */
export async function uploadAttachment(roomId: string, file: LocalFile): Promise<FileRef> {
  const body = await (await fetch(file.src)).blob()
  const path = attachmentPath(file.name)
  const picture = (file.mime || body.type).startsWith("image/") && !!file.width && !!file.height
  // A still that cannot be made costs only the saving: the transcript falls back to the original.
  // The still maker loads with the first picture sent, so it stays out of the first paint.
  const still = picture ? await import("./still").then((m) => m.makeStill(body, file.width!, file.height!)).catch(() => null) : null
  let last: unknown
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const ref = await putOnce(roomId, file, body, path, still?.thumbhash)
      if (!still?.blob) return ref
      const stored = await fetch(`/api/files/${roomId}/${encodeURIComponent(ref.id)}/thumb`, { method: "PUT", headers: { "content-type": still.blob.type }, body: still.blob }).then((r) => r.ok, () => false)
      return stored ? { ...ref, thumb: true } : ref
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
