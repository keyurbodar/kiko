import type { FileRef } from "@kiko/protocol"
import { rgbaToThumbHash } from "thumbhash"

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

/** The long edge of a still: twice the widest transcript cell (420 px), for a 2x screen. */
export const STILL_EDGE = 840
/** The thumbhash format's own limit. */
const HASH_EDGE = 100

/** `width` x `height` scaled down to fit `edge`, never up. */
export function fitWithin(width: number, height: number, edge: number): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

type Still = { blob: Blob | null; thumbhash: string }

/**
 * The still and thumbhash of a picture, or null when this browser cannot make them. `blob` is
 * null when the picture already fits a cell, so the original is small enough to draw. An animated
 * GIF keeps its original, which is the only copy that moves.
 */
export async function makeStill(body: Blob, width: number, height: number): Promise<Still | null> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null
  const fit = fitWithin(width, height, STILL_EDGE)
  const big = fit.width < width && body.type !== "image/gif"
  const bitmap = await createImageBitmap(body, { resizeWidth: fit.width, resizeHeight: fit.height, resizeQuality: "high" })
  try {
    let blob: Blob | null = null
    if (big) {
      const canvas = new OffscreenCanvas(fit.width, fit.height)
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
      blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 })
      // A browser that cannot write WebP hands back a PNG, which is no smaller. JPEG is.
      if (blob.type !== "image/webp") blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })
    }
    const small = fitWithin(fit.width, fit.height, HASH_EDGE)
    const sketch = new OffscreenCanvas(small.width, small.height).getContext("2d")!
    sketch.drawImage(bitmap, 0, 0, small.width, small.height)
    const pixels = sketch.getImageData(0, 0, small.width, small.height).data
    return { blob, thumbhash: base64(rgbaToThumbHash(small.width, small.height, pixels)) }
  } finally {
    bitmap.close()
  }
}

async function putStill(roomId: string, fileId: string, still: Blob): Promise<boolean> {
  const res = await fetch(`/api/files/${roomId}/${encodeURIComponent(fileId)}/thumb`, { method: "PUT", headers: { "content-type": still.type }, body: still })
  return res.ok
}

async function putOnce(roomId: string, file: LocalFile, body: Blob, path: string, thumbhash?: string): Promise<FileRef> {
  const headers: Record<string, string> = { "content-type": file.mime || body.type || "application/octet-stream" }
  if (thumbhash) headers["x-kiko-thumbhash"] = thumbhash
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
  const picture = (file.mime || body.type).startsWith("image/") && !!file.width && !!file.height
  // A still that cannot be made costs only the saving: the transcript falls back to the original.
  const still = picture ? await makeStill(body, file.width!, file.height!).catch(() => null) : null
  let last: unknown
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const ref = await putOnce(roomId, file, body, path, still?.thumbhash)
      if (!still?.blob) return ref
      return (await putStill(roomId, ref.id, still.blob).catch(() => false)) ? { ...ref, thumb: true } : ref
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
