// A wallpaper behind frost, and the theme it generates. The glass is monocode's: neutral grey
// at 85% over the picture blurred 24px, so the picture's own colour bleeds through everything.
// The accent comes from the picture too: its strongest vivid hue becomes a custom theme, so
// no preset is involved.
//
// The picture is stored in the look record, so it syncs with it. It is compressed hard: it is
// only ever seen blurred 24px, so 320 px on the long edge loses nothing the eye can find.

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

/**
 * Shrinks a picked image to a small data URL and reads its palette. It tries smaller sizes and
 * lower quality until the result fits. WebP where the browser can write it, JPEG otherwise.
 */
export async function prepareWallpaper(file: Blob): Promise<Prepared> {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no canvas")
    let wallpaper = ""
    // High quality first: block artefacts in a dark picture survive the blur as contours.
    for (const [edge, quality] of [[320, 0.85], [320, 0.7], [320, 0.55], [240, 0.5], [160, 0.4]] as const) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      wallpaper = canvas.toDataURL("image/webp", quality)
      if (!wallpaper.startsWith("data:image/webp")) wallpaper = canvas.toDataURL("image/jpeg", quality)
      if (isWallpaper(wallpaper)) break
    }
    if (!isWallpaper(wallpaper)) throw new Error("too large")
    // The palette reads a 32 px copy: enough to vote on hue, and quick.
    const w = Math.max(1, Math.round((canvas.width / Math.max(canvas.width, canvas.height)) * 32))
    const h = Math.max(1, Math.round((canvas.height / Math.max(canvas.width, canvas.height)) * 32))
    const small = document.createElement("canvas")
    small.width = w
    small.height = h
    const sctx = small.getContext("2d")
    if (!sctx) throw new Error("no canvas")
    sctx.drawImage(canvas, 0, 0, w, h)
    return { wallpaper, palette: paletteOf(sctx.getImageData(0, 0, w, h).data) }
  } finally {
    bitmap.close()
  }
}
