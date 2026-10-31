import { IMAGE_REF, type ImagePart } from "@kiko/computer/frame"

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"])
const MAX_EDGE = 960
const QUALITY = 60

export type Fitted = { bytes: Uint8Array; mime: string }
export type Fitter = (bytes: Uint8Array, mime: string) => Promise<Fitted>
export type Split = { value: unknown; parts: ImagePart[]; data: Uint8Array<ArrayBuffer> }

type Bag = Record<string, unknown>

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null

function mimeOf(bag: Bag): string | undefined {
  for (const key of ["mimeType", "mime"]) {
    const value = bag[key]
    if (typeof value === "string" && IMAGE_MIMES.has(value)) return value
  }
  return undefined
}

type ImagePipeline = {
  metadata(): Promise<{ width: number; height: number }>
  resize(
    width: number,
    height?: number,
    options?: { fit?: "fill" | "inside"; withoutEnlargement?: boolean },
  ): ImagePipeline
  jpeg(options?: { quality?: number }): ImagePipeline
  bytes(): Promise<Uint8Array>
}

type ImageConstructor = new (input: Uint8Array) => ImagePipeline

function imageConstructor(): ImageConstructor | null {
  const bun = (globalThis as { Bun?: { Image?: ImageConstructor } }).Bun
  return typeof bun?.Image === "function" ? bun.Image : null
}

export async function fitWithBun(bytes: Uint8Array, mime: string): Promise<Fitted> {
  const Image = imageConstructor()
  if (!Image) return { bytes, mime }
  try {
    const size = await new Image(bytes).metadata()
    if (Math.max(size.width, size.height) <= MAX_EDGE) return { bytes, mime }
    const small = await new Image(bytes)
      .resize(MAX_EDGE, undefined, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: QUALITY })
      .bytes()
    return { bytes: new Uint8Array(small), mime: "image/jpeg" }
  } catch {
    return { bytes, mime }
  }
}

export async function splitImages(value: unknown, fit: Fitter = fitWithBun): Promise<Split | null> {
  const parts: ImagePart[] = []
  const chunks: Uint8Array[] = []
  const walk = async (node: unknown): Promise<unknown> => {
    if (Array.isArray(node)) {
      const out: unknown[] = []
      for (const item of node) out.push(await walk(item))
      return out
    }
    if (!isBag(node)) return node
    const mime = typeof node.data === "string" ? mimeOf(node) : undefined
    if (mime !== undefined) {
      const raw = new Uint8Array(Buffer.from(node.data as string, "base64"))
      const fitted = await fit(raw, mime)
      const index = parts.length
      parts.push({ mime: fitted.mime, length: fitted.bytes.byteLength })
      chunks.push(fitted.bytes)
      const key = typeof node.mimeType === "string" ? "mimeType" : "mime"
      return { ...node, data: { [IMAGE_REF]: index }, [key]: fitted.mime }
    }
    const out: Bag = {}
    for (const [key, child] of Object.entries(node)) out[key] = await walk(child)
    return out
  }
  const next = await walk(value)
  if (parts.length === 0) return null
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const data = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    data.set(chunk, at)
    at += chunk.byteLength
  }
  return { value: next, parts, data }
}
