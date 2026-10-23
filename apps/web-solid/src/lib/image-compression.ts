export const MAX_DIMENSION = 2048
export const QUALITY_STEPS = [0.92, 0.85, 0.78, 0.68] as const
export const FALLBACK_SCALE_STEPS = [0.75, 0.55] as const
export const MAX_COMPRESSIBLE_SOURCE_BYTES = 50 * 1024 * 1024

type Size = { width: number; height: number }
export type Decoded = Size & { close(): void }

export type Codec<D extends Decoded = Decoded> = {
  decode(file: Blob): Promise<D>
  encode(source: D, size: Size, type: "image/webp" | "image/jpeg", quality: number): Promise<Blob | null>
}

export type PreparedImage =
  | { ok: true; file: File; recompressed: boolean }
  | { ok: false; reason: "too-large" | "unreadable" }

export function encodeSizes(source: Size): Size[] {
  const long = Math.max(source.width, source.height)
  const base = Math.min(MAX_DIMENSION, long)
  return [1, ...FALLBACK_SCALE_STEPS].map((step) => {
    const scale = Math.max(1, Math.round(base * step)) / long
    return {
      width: Math.max(1, Math.round(source.width * scale)),
      height: Math.max(1, Math.round(source.height * scale)),
    }
  })
}

export function renamed(name: string, type: string): string {
  const dot = name.lastIndexOf(".")
  return `${dot > 0 ? name.slice(0, dot) : name}${type === "image/webp" ? ".webp" : ".jpg"}`
}

export async function prepareImageForAttachment<D extends Decoded>(
  file: File,
  maxBytes: number,
  codec: Codec<D> = browserCodec as unknown as Codec<D>,
): Promise<PreparedImage> {
  if (file.size <= maxBytes) return { ok: true, file, recompressed: false }
  if (file.size > MAX_COMPRESSIBLE_SOURCE_BYTES) return { ok: false, reason: "too-large" }
  let source: D
  try {
    source = await codec.decode(file)
  } catch {
    return { ok: false, reason: "unreadable" }
  }
  try {
    let type: "image/webp" | "image/jpeg" | null = null
    let failed = false
    for (const size of encodeSizes(source)) {
      try {
        failed = false
        for (const quality of QUALITY_STEPS) {
          let blob: Blob | null = null
          if (type === null) {
            blob = await codec.encode(source, size, "image/webp", quality)
            type = blob ? "image/webp" : "image/jpeg"
          }
          blob ??= await codec.encode(source, size, type, quality)
          if (!blob) break
          if (blob.size <= maxBytes)
            return {
              ok: true,
              file: new File([blob], renamed(file.name || "image", type), { type }),
              recompressed: true,
            }
        }
      } catch {
        failed = true
      }
    }
    return { ok: false, reason: failed ? "unreadable" : "too-large" }
  } finally {
    source.close()
  }
}

type Surface = OffscreenCanvas | HTMLCanvasElement

function surface(size: Size): Surface {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(size.width, size.height)
  const canvas = document.createElement("canvas")
  canvas.width = size.width
  canvas.height = size.height
  return canvas
}

async function toBlob(canvas: Surface, type: string, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export const browserCodec: Codec<ImageBitmap> = {
  decode: (file) => createImageBitmap(file),
  async encode(bitmap, size, type, quality) {
    const canvas = surface(size)
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
    if (!context) return null
    if (type === "image/jpeg") {
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, size.width, size.height)
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await toBlob(canvas, type, quality)
    return blob?.type === type ? blob : null
  },
}
