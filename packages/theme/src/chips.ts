import type { Palette, ThemeAppearance } from "./palette"

export const CHIP_TONES = {
  file: { c: 0.136, h: 237 },
  mention: { c: 0.11, h: 215 },
  pdf: { c: 0.16, h: 24 },
  word: { c: 0.136, h: 248 },
  sheet: { c: 0.134, h: 148 },
  slides: { c: 0.134, h: 56 },
  epub: { c: 0.16, h: 291 },
} as const satisfies Record<string, { c: number; h: number }>

export type ChipTone = keyof typeof CHIP_TONES

const LIGHTNESS = 0.62
const MIN_CONTRAST = 5

type Rgb = readonly [number, number, number]
type Surface = Readonly<{ rgb: Rgb; luminance: number }>

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function hexRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", "").slice(0, 6), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function channelLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function channelSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(channelLinear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

function oklchRgb(l: number, c: number, h: number): Rgb {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = l - 0.0894841775 * a - 1.291485548 * b
  const [lr, mr, sr] = [lRoot ** 3, mRoot ** 3, sRoot ** 3] as [number, number, number]
  return [
    4.0767416621 * lr - 3.3077115913 * mr + 0.2309699292 * sr,
    -1.2684380046 * lr + 2.6097574011 * mr - 0.3413193965 * sr,
    -0.0041960863 * lr - 0.7034186147 * mr + 1.707614701 * sr,
  ].map((value) => clamp01(channelSrgb(clamp01(value)))) as unknown as Rgb
}

function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((value) =>
      Math.round(clamp01(value) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

function mix(base: Rgb, top: Rgb, alpha: number): Rgb {
  return base.map((value, index) => value * (1 - alpha) + top[index]! * alpha) as unknown as Rgb
}

const WHITE: Rgb = [1, 1, 1]
const BLACK: Rgb = [0, 0, 0]

export function chipSurfaces(appearance: ThemeAppearance, p: Palette): Surface[] {
  const dark = appearance === "dark"
  const canvas = hexRgb(p.canvas)
  const surfaces = [
    canvas,
    hexRgb(p.sidebar),
    dark ? mix(canvas, WHITE, 0.07) : WHITE,
    dark ? mix(canvas, WHITE, 0.0565) : WHITE,
    mix(canvas, dark ? WHITE : BLACK, dark ? 0.1 : 0.062),
  ]
  const seen = new Set<string>()
  return surfaces
    .filter((rgb) => {
      const key = toHex(rgb)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((rgb) => ({ rgb, luminance: luminance(rgb) }))
}

function contrastOn(rgb: Rgb, surfaces: readonly Surface[]): number {
  return Math.min(...surfaces.map((surface) => contrast(rgb, surface.rgb)))
}

export function solveChipTone(tone: { c: number; h: number }, surfaces: readonly Surface[]): string {
  const hexAt = (lightness: number) => toHex(oklchRgb(lightness, tone.c, tone.h))
  const measures = (lightness: number) => contrastOn(hexRgb(hexAt(lightness)), surfaces)
  if (measures(LIGHTNESS) >= MIN_CONTRAST) return hexAt(LIGHTNESS)
  const lighter = surfaces.some((surface) => surface.luminance < 0.179)
  let low = 0
  let high = 1
  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2
    if (measures(mid) >= MIN_CONTRAST) {
      if (lighter) high = mid
      else low = mid
    } else if (lighter) low = mid
    else high = mid
  }
  let lightness = lighter ? high : low
  while (measures(lightness) < MIN_CONTRAST && lightness > 0 && lightness < 1)
    lightness = clamp01(lightness + (lighter ? 0.002 : -0.002))
  return hexAt(lightness)
}

export function chipTokens(appearance: ThemeAppearance, p: Palette): Record<string, string> {
  const surfaces = chipSurfaces(appearance, p)
  return Object.fromEntries(
    (Object.entries(CHIP_TONES) as Array<[ChipTone, { c: number; h: number }]>).map(([tone, accent]) => [
      `--chip-${tone}`,
      solveChipTone(accent, surfaces),
    ]),
  )
}

const EXTENSION_TONES: Record<string, ChipTone> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  pages: "word",
  xls: "sheet",
  xlsx: "sheet",
  ods: "sheet",
  csv: "sheet",
  tsv: "sheet",
  numbers: "sheet",
  ppt: "slides",
  pptx: "slides",
  odp: "slides",
  key: "slides",
  epub: "epub",
}

export function toneOf(path: string): ChipTone | "mention" {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return EXTENSION_TONES[ext] ?? "mention"
}
