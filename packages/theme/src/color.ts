/*
 * OKLCH and back, for the palette: Kiko derives its paper, ink and lines from the accent's hue, the way
 * Material 3 derives its neutral tones from a seed. Björn Ottosson's OKLab matrices. A color outside
 * sRGB keeps its lightness and hue and loses chroma until it fits.
 */

export type Oklch = { l: number; c: number; h: number }

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** `#rrggbb` to OKLCH, the hue in degrees. */
export function oklchOf(hex: string): Oklch {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}

function linearOf({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180)
  const B = c * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const fits = (rgb: readonly number[]) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6)

/** OKLCH to `#rrggbb`, with chroma cut until the color is inside sRGB. */
export function hexOf(color: Oklch): string {
  let rgb = linearOf(color)
  if (!fits(rgb)) {
    let [low, high] = [0, color.c]
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2
      if (fits(linearOf({ ...color, c: mid }))) low = mid
      else high = mid
    }
    rgb = linearOf({ ...color, c: low })
  }
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255).toString(16).padStart(2, "0")).join("")}`
}
