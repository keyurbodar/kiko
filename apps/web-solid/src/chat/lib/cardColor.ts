// The colour of a link card's panel, as kat paints it: the page's own colour, taken from its
// picture. Pure functions over pixels, so a test can feed them numbers.

type Rgb = [number, number, number]

/** The pixel side the picture is shrunk to before counting. 24 x 24 is 576 pixels. */
export const SAMPLE_SIDE = 24

// Hue buckets of 30 degrees. A pixel greyer or darker or lighter than these limits has no hue worth naming.
const BUCKETS = 12
const MIN_SATURATION = 0.28
const MIN_LIGHTNESS = 0.12
const MAX_LIGHTNESS = 0.9
/** The share of opaque pixels the winning bucket needs, so a speck of colour on a grey page does not win. */
const MIN_SHARE = 0.06
/** WCAG AA for normal text. */
export const MIN_CONTRAST = 4.5

function toHsl([r, g, b]: Rgb): [h: number, s: number, l: number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** The contrast of white text on `rgb`. */
export function contrastWithWhite(rgb: Rgb): number {
  return 1.05 / (luminance(rgb) + 0.05)
}

const hex = (rgb: Rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`

export function parseHex(color: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (!m) return null
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
}

/** A hex or `rgb()` colour, or null for anything else, alpha ignored. */
export function parseCssColor(color: string | undefined): Rgb | null {
  if (!color) return null
  const fromHex = parseHex(color.length === 9 || color.length === 5 ? color.slice(0, color.length === 9 ? 7 : 4) : color)
  if (fromHex) return fromHex
  const m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(color.trim())
  if (!m) return null
  const rgb = [Number(m[1]), Number(m[2]), Number(m[3])] as Rgb
  return rgb.every((c) => c <= 255) ? rgb : null
}

/**
 * Darkens a colour until white text on it reads at `MIN_CONTRAST`, keeping its hue. Saturation is
 * capped a little, so a neon picture still gives a calm panel.
 */
export function readablePanel(rgb: Rgb): string {
  const [h, s, l] = toHsl(rgb)
  const sat = Math.min(s, 0.72)
  let light = Math.min(l, 0.56)
  let out = fromHsl(h, sat, light)
  while (contrastWithWhite(out) < MIN_CONTRAST && light > 0.05) {
    light -= 0.02
    out = fromHsl(h, sat, light)
  }
  return hex(out)
}

/**
 * The most common vivid hue of a picture, as a panel colour, or null when the picture is grey.
 * `pixels` is RGBA, as `ImageData.data` holds it. The winning bucket's own pixels are averaged,
 * weighted by saturation, so the answer is a colour the picture has and never a muddy blend.
 */
export function pickCardColor(pixels: ArrayLike<number>): string | null {
  const weight = new Float64Array(BUCKETS)
  const counts = new Uint32Array(BUCKETS)
  const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0])
  let opaque = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue
    opaque++
    const rgb: Rgb = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
    const [h, s, l] = toHsl(rgb)
    if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue
    const bucket = Math.floor(h / (360 / BUCKETS)) % BUCKETS
    // Vivid, mid-light pixels count most: they are the ones a reader names the picture by.
    const w = s * (1 - Math.abs(l - 0.5))
    weight[bucket]! += w
    counts[bucket]!++
    sums[bucket]![0]! += rgb[0] * w
    sums[bucket]![1]! += rgb[1] * w
    sums[bucket]![2]! += rgb[2] * w
  }
  if (opaque === 0) return null
  let best = 0
  for (let b = 1; b < BUCKETS; b++) if (weight[b]! > weight[best]!) best = b
  if (weight[best] === 0 || counts[best]! / opaque < MIN_SHARE) return null
  const w = weight[best]!
  const [r, g, b] = sums[best]!
  return readablePanel([Math.round(r! / w), Math.round(g! / w), Math.round(b! / w)])
}

/** A page's theme-color as a panel, when it has a hue. Most sites set white or black, which says nothing. */
export function themePanel(themeColor: string | undefined): string | null {
  const rgb = parseCssColor(themeColor)
  if (!rgb) return null
  const [, s, l] = toHsl(rgb)
  return s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS ? null : readablePanel(rgb)
}

/** Draws a loaded picture at `SAMPLE_SIDE` and picks its colour. Null when the canvas is unreadable. */
export function colorOfImage(image: CanvasImageSource): string | null {
  try {
    const canvas = document.createElement("canvas")
    canvas.width = SAMPLE_SIDE
    canvas.height = SAMPLE_SIDE
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return null
    context.drawImage(image, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE)
    return pickCardColor(context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data)
  } catch {
    // A tainted canvas throws. Preview images are on kiko's origin, so this is a broken image.
    return null
  }
}
