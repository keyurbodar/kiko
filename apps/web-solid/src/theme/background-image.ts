// Reads a picked image into the two copies the chat background needs: the sharp picture for the
// chat pane, at most 2048 px on its long edge as monocode's renderer uses it, and a small blurred
// copy that stands in for the desktop behind the glass. That copy is blurred at window size
// before it is shrunk, so it stretches back smoothly, and it is small enough for localStorage,
// which the inline script reads before first paint.

import { wallpaperPalette, type WallpaperPalette } from "./palette"

/** The picture types a browser can decode. Anything else is refused before it is read. */
const IMAGE = /^image\/(png|jpeg|webp|gif|avif|bmp)$/
/** Monocode refuses nothing by size, but a phone photo is plenty. */
export const MAX_BACKGROUND_BYTES = 40 * 1024 * 1024
const SHARP_EDGE = 2048
const WORK_EDGE = 1280
const PREBLUR = 40
const MAX_DESKTOP_CHARS = 60_000

export type Prepared = { sharp: Blob; desktop: string; palette: WallpaperPalette }

const canvas2d = (w: number, h: number) => {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext("2d")
  if (!ctx) throw new Error("This browser can't read pictures.")
  ctx.imageSmoothingQuality = "high"
  return [c, ctx] as const
}

const toBlob = (c: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("That picture couldn't be saved."))), type, quality))

/** The picture fitted to `edge` on its long side, blurred by `radius`, drawn past the edges so the blur never fades there. */
function fitted(source: ImageBitmap, edge: number, radius = 0): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(source.width, source.height))
  const [c, ctx] = canvas2d(source.width * scale, source.height * scale)
  if (radius > 0) {
    const pad = radius * 2
    ctx.filter = `blur(${radius}px)`
    ctx.drawImage(source, -pad, -pad, c.width + pad * 2, c.height + pad * 2)
    ctx.filter = "none"
  } else ctx.drawImage(source, 0, 0, c.width, c.height)
  return c
}

export async function prepareBackground(file: Blob): Promise<Prepared> {
  if (!IMAGE.test(file.type)) throw new Error("Choose a PNG, JPEG, WebP, GIF, or AVIF picture.")
  if (file.size > MAX_BACKGROUND_BYTES) throw new Error("That picture is larger than 40 MB.")
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("That picture couldn't be read.")
  }
  try {
    const full = fitted(bitmap, SHARP_EDGE)
    let sharp = await toBlob(full, "image/webp", 0.85)
    if (sharp.type !== "image/webp") sharp = await toBlob(full, "image/jpeg", 0.85)
    const soft = fitted(bitmap, WORK_EDGE, PREBLUR)
    let desktop = ""
    for (const [edge, quality] of [[480, 0.8], [320, 0.7], [240, 0.6]] as const) {
      const scale = edge / Math.max(soft.width, soft.height)
      const [c, ctx] = canvas2d(soft.width * scale, soft.height * scale)
      ctx.drawImage(soft, 0, 0, c.width, c.height)
      desktop = c.toDataURL("image/webp", quality)
      if (!desktop.startsWith("data:image/webp")) desktop = c.toDataURL("image/jpeg", quality)
      if (desktop.length <= MAX_DESKTOP_CHARS) break
    }
    if (desktop.length > MAX_DESKTOP_CHARS) throw new Error("That picture couldn't be saved.")
    return { sharp, desktop, palette: paletteOfBitmap(bitmap) }
  } finally {
    bitmap.close()
  }
}

/** The palette a picture asks for, read from a 64 px copy. */
export function paletteOfBitmap(source: ImageBitmap): WallpaperPalette {
  const small = fitted(source, 64)
  return wallpaperPalette(small.getContext("2d")!.getImageData(0, 0, small.width, small.height).data)
}

/** The palette of a stored picture, for a background chosen before palettes were kept. */
export async function paletteOfBlob(blob: Blob): Promise<WallpaperPalette> {
  const bitmap = await createImageBitmap(blob)
  try {
    return paletteOfBitmap(bitmap)
  } finally {
    bitmap.close()
  }
}
