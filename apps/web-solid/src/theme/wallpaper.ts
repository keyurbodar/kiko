// A wallpaper behind frost, and the theme it generates. The glass is dark and neutral over the
// blurred picture, so the picture's own colour and soft shapes come through everything.
// The accent comes from the picture too: its strongest vivid hue becomes a custom theme, so
// no preset is involved.
//
// The picture is stored in the look record, so it syncs with it. It is blurred at window size
// first and then compressed hard: blurred, 320 px on the long edge loses nothing.

import type { Theme } from "./schema"

/** The longest the stored data URL may be. The whole look must stay under the server's 32 KB. */
export const MAX_WALLPAPER_CHARS = 20_000
const DATA_URL = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/

export const isWallpaper = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_WALLPAPER_CHARS && DATA_URL.test(v)

export type Palette = { hue: number; chroma: number }

const lin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** sRGB bytes to OKLab. */
function oklab(r: number, g: number, b: number): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const BINS = 36
/** Below this OKLCH chroma a pixel counts as grey and votes for nothing. */
const GREY = 0.03
/** The chroma of a vivid wallpaper colour that maps to the themes' full chroma of 1. */
const FULL = 0.12

/**
 * The hue and chroma a picture's pixels (RGBA bytes) ask for. Each colourful pixel votes for its
 * hue with weight chroma², so a vivid patch outvotes a wide dull one. The winning 30° of hue sets
 * the hue, and how colourful the picture is overall sets the chroma. A grey picture gives
 * chroma 0, which is the mono look.
 */
export function paletteOf(rgba: ArrayLike<number>): Palette {
  const votes = new Float64Array(BINS)
  const sumA = new Float64Array(BINS)
  const sumB = new Float64Array(BINS)
  let n = 0
  let chromaSum = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    n++
    const [L, a, b] = oklab(rgba[i], rgba[i + 1], rgba[i + 2])
    const c = Math.hypot(a, b)
    chromaSum += c
    // Near black and near white carry no reliable hue.
    if (c < GREY || L < 0.2 || L > 0.97) continue
    const bin = Math.floor((((Math.atan2(b, a) * 180) / Math.PI + 360) % 360) / (360 / BINS)) % BINS
    const w = c * c
    votes[bin] += w
    sumA[bin] += (a / c) * w
    sumB[bin] += (b / c) * w
  }
  let best = -1
  let bestVote = 0
  for (let i = 0; i < BINS; i++) {
    const v = votes[(i + BINS - 1) % BINS] + votes[i] + votes[(i + 1) % BINS]
    if (v > bestVote) {
      bestVote = v
      best = i
    }
  }
  if (best < 0 || n === 0) return { hue: 0, chroma: 0 }
  let a = 0
  let b = 0
  for (const i of [(best + BINS - 1) % BINS, best, (best + 1) % BINS]) {
    a += sumA[i]
    b += sumB[i]
  }
  const hue = Math.round(((Math.atan2(b, a) * 180) / Math.PI + 360) % 360) % 360
  // A picture that is mostly grey with one bright spot still reads as mostly grey.
  const vivid = Math.sqrt(bestVote / n)
  const chroma = Math.min(1.2, Math.max(vivid, chromaSum / n) / FULL)
  return { hue, chroma: Math.round(chroma * 100) / 100 }
}

/** The custom theme a palette makes. Every derived colour in `kat.css` follows these three. */
export const themeFrom = (p: Palette): Theme => ({ version: 1, name: "wallpaper", colors: { hue: p.hue, userHue: p.hue, chroma: p.chroma } })

export type Prepared = { wallpaper: string; palette: Palette }

/** The picture is blurred at this size, about a window's width, before it is shrunk. */
const WORK_EDGE = 1280
/** The blur at that size, in px: soft shapes stay, edges and detail go, as under macOS glass. */
export const PREBLUR = 40

const canvas2d = (w: number, h: number) => {
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext("2d")
  if (!ctx) throw new Error("no canvas")
  ctx.imageSmoothingQuality = "high"
  return [c, ctx] as const
}

/**
 * The picture at about a window's width, blurred. Blurring before shrinking is what keeps the
 * stored copy smooth: a blurred picture has no detail left to lose, so 320 px of it stretches
 * back to the window with no blocks, where blurring a stretched 320 px copy smears its pixels
 * into wavy contours. The picture is drawn past the edges so the blur never fades there. A
 * browser without canvas filters gets a blur from shrinking hard and stretching back.
 */
function blurred(bitmap: ImageBitmap): HTMLCanvasElement {
  const scale = Math.min(1, WORK_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  const [c, ctx] = canvas2d(w, h)
  // Older Safari has no canvas `filter`, and TypeScript's types say every browser does.
  if ((ctx as { filter?: unknown }).filter !== undefined) {
    const pad = PREBLUR * 2
    ctx.filter = `blur(${PREBLUR}px)`
    ctx.drawImage(bitmap, -pad, -pad, c.width + pad * 2, c.height + pad * 2)
    ctx.filter = "none"
    return c
  }
  const [tiny, tctx] = canvas2d(w / PREBLUR, h / PREBLUR)
  tctx.drawImage(bitmap, 0, 0, tiny.width, tiny.height)
  ctx.drawImage(tiny, 0, 0, c.width, c.height)
  return c
}

/**
 * Shrinks a picked image to a small data URL and reads its palette. It tries smaller sizes and
 * lower quality until the result fits. WebP where the browser can write it, JPEG otherwise.
 */
export async function prepareWallpaper(file: Blob): Promise<Prepared> {
  const bitmap = await createImageBitmap(file)
  try {
    const soft = blurred(bitmap)
    let wallpaper = ""
    for (const [edge, quality] of [[320, 0.85], [320, 0.7], [240, 0.6], [160, 0.5]] as const) {
      const scale = edge / Math.max(soft.width, soft.height)
      const [c, ctx] = canvas2d(soft.width * scale, soft.height * scale)
      ctx.drawImage(soft, 0, 0, c.width, c.height)
      wallpaper = c.toDataURL("image/webp", quality)
      if (!wallpaper.startsWith("data:image/webp")) wallpaper = c.toDataURL("image/jpeg", quality)
      if (isWallpaper(wallpaper)) break
    }
    if (!isWallpaper(wallpaper)) throw new Error("too large")
    // The palette reads a sharp 32 px copy, so a small vivid patch still gets its vote.
    const k = 32 / Math.max(bitmap.width, bitmap.height)
    const [small, sctx] = canvas2d(bitmap.width * k, bitmap.height * k)
    sctx.drawImage(bitmap, 0, 0, small.width, small.height)
    return { wallpaper, palette: paletteOf(sctx.getImageData(0, 0, small.width, small.height).data) }
  } finally {
    bitmap.close()
  }
}
