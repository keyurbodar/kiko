// The small still and thumbhash of a picture, made in the browser at upload (architecture 18.1).
// Loaded on the first send with a picture, never with the first paint.

import { rgbaToThumbHash } from "thumbhash"

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
