// The theme model. A theme names a color per product role, ported from t3code (MIT):
// packages/shared/src/themePalettes.ts and apps/web/src/themePalette.ts, so a t3code theme file
// imports unchanged. The stock palette and the way a palette becomes kiko's tokens follow
// monocode (MIT): one neutral tint, and every fill a few percent of the text over what is
// beneath. A theme changes colors and nothing else.
//
// This module is on the first-paint path, so it parses nothing heavier than JSON. Colors are
// canonicalized once, when a theme is imported (theme/import.ts), and stored that way.

export type ThemeAppearance = "light" | "dark"
export type ThemeMode = ThemeAppearance | "system"

export const THEME_COLOR_ROLES = [
  "canvas",
  "chrome",
  "toolbar",
  "toolbarForeground",
  "toolbarBorder",
  "toolbarControl",
  "toolbarControlForeground",
  "toolbarControlHover",
  "surface",
  "surfaceRaised",
  "surfaceOverlay",
  "text",
  "textMuted",
  "border",
  "input",
  "focus",
  "accent",
  "accentForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "placeholder",
  "secondaryLabel",
  "iconMuted",
  "error",
  "errorForeground",
  "errorSurface",
  "warning",
  "warningForeground",
  "warningSurface",
  "update",
  "updateForeground",
  "updateSurface",
  "accentSurface",
  "accentSurfaceForeground",
  "messageSurface",
  "messageForeground",
  "messageAction",
  "messageActionForeground",
  "messageActionHover",
  "codeBackground",
  "codeForeground",
  "sidebar",
  "sidebarForeground",
  "sidebarMutedForeground",
  "sidebarControlSurface",
  "sidebarRowHover",
  "sidebarRowActive",
  "sidebarRowSelected",
  "sidebarBorder",
  "terminalBackground",
  "terminalForeground",
  "terminalCursor",
  "terminalSelection",
  "terminalScrollbar",
  "terminalScrollbarHover",
] as const

export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number]
export type ThemeColors = Readonly<Record<ThemeColorRole, string>>
export type ThemeVariants = Readonly<Partial<Record<ThemeAppearance, ThemeColors>>>
export type ThemeDefinition = Readonly<{
  id: string
  label: string
  appearance: ThemeAppearance
  colors: ThemeColors
  variants?: ThemeVariants
  /** Groups the variants one extension ships into one library card. */
  collection?: Readonly<{ id: string; label: string }>
}>

// ---------------------------------------------------------------------------
// The stock palette: monocode's (MIT, src/styles/index.css). Every surface is one hue at one
// saturation, the background and the content at two lightnesses, so the person's tint moves
// the whole interface at once. It is a full set of t3code roles, so it previews, exports and
// sits in the library like any theme.

/** Monocode's tint: hue 0 to 360, saturation 0 to 100 percent, dark-mode background lightness 0 to 30 percent. */
export type Tint = Readonly<{ hue: number; saturation: number; lightness: number }>
export const TINT_RANGE = {
  hue: { min: 0, max: 360, default: 240 },
  saturation: { min: 0, max: 100, default: 0 },
  lightness: { min: 0, max: 30, default: 9 },
} as const
export const DEFAULT_TINT: Tint = { hue: 240, saturation: 0, lightness: 9 }

type Rgb = readonly [number, number, number]

function hsl(h: number, s: number, l: number): Rgb {
  const S = s / 100
  const L = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

const hex = (c: Rgb) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`
/** `a` over `b`, `share` of the way: what `color-mix(in srgb, a share%, b)` paints. */
const over = (a: Rgb, b: Rgb, share: number): Rgb => [0, 1, 2].map((i) => a[i]! * share + b[i]! * (1 - share)) as unknown as Rgb

export function monocodeColors(tint: Tint, mode: ThemeAppearance): ThemeColors {
  const dark = mode === "dark"
  const B = hsl(tint.hue, tint.saturation, dark ? tint.lightness : 97)
  const C = hsl(tint.hue, tint.saturation, dark ? 92 : 18)
  const ink = (share: number) => hex(over(C, B, share))
  const sidebar = dark ? over([0, 0, 0], B, 0.1) : B
  const onSidebar = (share: number) => hex(over(C, sidebar, share))
  const accent = hsl(211, 92, dark ? 62 : 40)
  const error: Rgb = dark ? [248, 113, 113] : [220, 38, 38]
  const warning: Rgb = dark ? [251, 191, 36] : [180, 83, 9]
  const white: Rgb = [255, 255, 255]
  const black: Rgb = [0, 0, 0]
  const muted = ink(0.45)
  return {
    canvas: hex(B),
    chrome: hex(B),
    toolbar: hex(B),
    toolbarForeground: hex(C),
    toolbarBorder: ink(0.07),
    toolbarControl: ink(0.05),
    toolbarControlForeground: hex(C),
    toolbarControlHover: ink(0.08),
    surface: ink(0.03),
    surfaceRaised: ink(0.06),
    surfaceOverlay: ink(0.04),
    text: hex(C),
    textMuted: muted,
    border: ink(0.1),
    input: ink(0.12),
    focus: hex(accent),
    accent: hex(accent),
    accentForeground: "#ffffff",
    secondary: ink(0.05),
    secondaryForeground: hex(C),
    muted: ink(0.04),
    mutedForeground: muted,
    placeholder: ink(0.32),
    secondaryLabel: muted,
    iconMuted: muted,
    error: hex(error),
    errorForeground: hex(error),
    errorSurface: hex(over(error, B, 0.15)),
    warning: hex(warning),
    warningForeground: hex(warning),
    warningSurface: hex(over(warning, B, 0.15)),
    update: hex(accent),
    updateForeground: hex(accent),
    updateSurface: hex(over(accent, B, 0.15)),
    accentSurface: ink(0.08),
    accentSurfaceForeground: hex(C),
    messageSurface: ink(0.1),
    messageForeground: hex(C),
    // Monocode's primary action: white in dark, the content color in light.
    messageAction: dark ? hex(white) : hex(C),
    messageActionForeground: dark ? hex(black) : hex(B),
    messageActionHover: dark ? hex(over(white, B, 0.9)) : hex(over(C, B, 0.9)),
    codeBackground: ink(0.04),
    codeForeground: hex(C),
    sidebar: hex(sidebar),
    sidebarForeground: hex(C),
    sidebarMutedForeground: muted,
    sidebarControlSurface: onSidebar(0.05),
    sidebarRowHover: onSidebar(0.05),
    sidebarRowActive: onSidebar(0.1),
    sidebarRowSelected: onSidebar(0.1),
    sidebarBorder: onSidebar(0.07),
    terminalBackground: hex(B),
    terminalForeground: hex(C),
    terminalCursor: hex(C),
    terminalSelection: hex(over(accent, B, 0.3)),
    terminalScrollbar: ink(0.2),
    terminalScrollbarHover: ink(0.32),
  }
}

export const DEFAULT_DARK_COLORS: ThemeColors = monocodeColors(DEFAULT_TINT, "dark")
export const DEFAULT_LIGHT_COLORS: ThemeColors = monocodeColors(DEFAULT_TINT, "light")

export const defaultColors = (appearance: ThemeAppearance): ThemeColors =>
  appearance === "dark" ? DEFAULT_DARK_COLORS : DEFAULT_LIGHT_COLORS

// ---------------------------------------------------------------------------
// The wallpaper's own palette. Nothing here is a preset or a setting: the surfaces take the
// picture's overall hue, colorfulness and darkness through the stock palette's tint, and the
// accent is the picture's most vivid color. A new picture gives a new palette.

/** What a picture asks for. `accent` is an OKLCH hue and chroma. */
export type WallpaperPalette = Readonly<{ hue: number; saturation: number; lightness: number; accent: Readonly<{ h: number; c: number }> }>

/** The theme id that means "match the wallpaper". It is never a stored theme's id. */
export const WALLPAPER_ID = "wallpaper"

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const gamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

function oklabOf(r: number, g: number, b: number): [number, number, number] {
  const R = linear(r / 255)
  const G = linear(g / 255)
  const B = linear(b / 255)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** An OKLCH color as #rrggbb, with chroma reduced until it fits sRGB. */
export function oklchHex(L: number, C: number, h: number): string {
  const rgb = (c: number) => {
    const a = c * Math.cos((h * Math.PI) / 180)
    const b = c * Math.sin((h * Math.PI) / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  }
  let c = C
  while (c > 0 && rgb(c).some((v) => v < -0.0005 || v > 1.0005)) c -= 0.005
  return hex(rgb(Math.max(0, c)).map((v) => gamma(Math.min(1, Math.max(0, v))) * 255) as unknown as Rgb)
}

/** Below this OKLCH chroma a pixel is grey and has no hue to give. */
const GREY = 0.03

/** A pixel at least this colorful can be the accent. Softer colors only tint the surfaces. */
const VIVID = 0.1

/** The hue a histogram's busiest 30° asks for: its votes' weighted mean direction. Null when empty. */
function busiest(votes: Float64Array, sumA: Float64Array, sumB: Float64Array): { hue: number; bins: number[] } | null {
  const BINS = votes.length
  let best = -1
  let top = 0
  for (let i = 0; i < BINS; i++) {
    const v = votes[(i + BINS - 1) % BINS]! + votes[i]! + votes[(i + 1) % BINS]!
    if (v > top) {
      top = v
      best = i
    }
  }
  if (best < 0) return null
  const bins = [(best + BINS - 1) % BINS, best, (best + 1) % BINS]
  const a = bins.reduce((t, i) => t + sumA[i]!, 0)
  const b = bins.reduce((t, i) => t + sumB[i]!, 0)
  return { hue: Math.round(((Math.atan2(b, a) * 180) / Math.PI + 360) % 360), bins }
}

/**
 * Reads a picture's palette from its pixels (RGBA bytes; a 64 px copy is plenty).
 *
 * - The surfaces take the hue that covers the most of the picture, each pixel weighted by how
 *   colorful it is. Hues are counted, not averaged: a violet sky over a tan field is violet, not
 *   the muddy red their average would be.
 * - Their saturation follows how colorful the picture is overall, kept low so text still reads,
 *   and dark mode's background lightness follows the picture's own brightness.
 * - The accent is the vivid color with the most presence: only pixels vivid enough to be an
 *   accent vote, each by its chroma squared, so a wide field of blue petals outvotes a few
 *   hot-pink flecks, and a small bright sun still outvotes a dull sky.
 */
export function wallpaperPalette(rgba: ArrayLike<number>): WallpaperPalette {
  const BINS = 36
  const bin = (A: number, B: number) => Math.floor((((Math.atan2(B, A) * 180) / Math.PI + 360) % 360) / (360 / BINS)) % BINS
  const tone = { votes: new Float64Array(BINS), a: new Float64Array(BINS), b: new Float64Array(BINS) }
  const vivid = { votes: new Float64Array(BINS), a: new Float64Array(BINS), b: new Float64Array(BINS), chroma: new Float64Array(BINS) }
  let n = 0
  let sumL = 0
  let sumC = 0
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue
    const [L, A, B] = oklabOf(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)
    const c = Math.hypot(A, B)
    n++
    sumL += L
    sumC += c
    if (c < GREY) continue
    const k = bin(A, B)
    tone.votes[k] += c
    tone.a[k] += A
    tone.b[k] += B
    if (c < VIVID || L < 0.25 || L > 0.95) continue
    const w = c * c
    vivid.votes[k] += w
    vivid.a[k] += (A / c) * w
    vivid.b[k] += (B / c) * w
    vivid.chroma[k] += c * w
  }
  if (n === 0) return { hue: DEFAULT_TINT.hue, saturation: 0, lightness: DEFAULT_TINT.lightness, accent: { h: 252, c: 0 } }
  const meanL = sumL / n
  const meanC = sumC / n
  const surface = busiest(tone.votes, tone.a, tone.b)
  // A grey picture keeps neutral surfaces; a vivid one tints them, at most 28%.
  const saturation = surface ? Math.round(Math.min(28, Math.max(0, (meanC - 0.01) * 260))) : 0
  // A dark picture keeps a dark background, a bright one lifts it a little: 5% to 14%.
  const lightness = Math.round(5 + Math.min(1, Math.max(0, meanL - 0.15) / 0.6) * 9)
  const hue = surface?.hue ?? DEFAULT_TINT.hue
  const accentHue = busiest(vivid.votes, vivid.a, vivid.b)
  let accent = { h: hue, c: 0 }
  if (accentHue) {
    const weight = accentHue.bins.reduce((t, i) => t + vivid.votes[i]!, 0)
    const chroma = accentHue.bins.reduce((t, i) => t + vivid.chroma[i]!, 0) / weight
    accent = { h: accentHue.hue, c: Math.round(chroma * 1000) / 1000 }
  }
  return { hue, saturation, lightness, accent }
}

/** The accent a palette paints in one appearance: bright on dark, deeper on light, always vivid enough to show. */
export function wallpaperAccent(p: WallpaperPalette, mode: ThemeAppearance): string {
  if (p.accent.c < GREY) return mode === "dark" ? "#ffffff" : hex(hsl(p.hue, p.saturation, 18))
  const c = Math.min(0.2, Math.max(0.12, p.accent.c))
  return oklchHex(mode === "dark" ? 0.74 : 0.55, c, p.accent.h)
}

/**
 * The HSL hue of an OKLCH hue. The palette is read in OKLCH, where hues are evenly spaced to the
 * eye, but the stock palette's tint is monocode's HSL; the two scales differ by up to 40°.
 */
export function hslHueOf(oklchHue: number): number {
  const color = oklchHex(0.6, 0.1, oklchHue)
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round((h * 60 + 360) % 360)
}

/** The full theme a wallpaper palette makes: the stock palette in the picture's tint, with its accent. */
export function wallpaperColors(p: WallpaperPalette, mode: ThemeAppearance): ThemeColors {
  const base = monocodeColors({ hue: hslHueOf(p.hue), saturation: p.saturation, lightness: p.lightness }, mode)
  const accent = wallpaperAccent(p, mode)
  return { ...base, accent, focus: accent, update: accent, updateForeground: accent }
}

/** Reads a stored wallpaper palette, or null. */
export function readWallpaperPalette(v: unknown): WallpaperPalette | null {
  if (typeof v !== "object" || v === null) return null
  const r = v as Record<string, unknown>
  const n = (x: unknown, min: number, max: number) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max
  const accent = r.accent as Record<string, unknown> | undefined
  if (!n(r.hue, 0, 360) || !n(r.saturation, 0, 100) || !n(r.lightness, 0, 30) || !accent || !n(accent.h, 0, 360) || !n(accent.c, 0, 0.5)) return null
  return { hue: r.hue as number, saturation: r.saturation as number, lightness: r.lightness as number, accent: { h: accent.h as number, c: accent.c as number } }
}

// ---------------------------------------------------------------------------
// From a palette to kiko's tokens.

/*
 * Roles a theme sets as they are. Every token here is a final color a component already reads.
 * The toolbar and terminal roles have no surface in kiko; they are kept so a file round-trips.
 */
export const TOKEN_ROLES: ReadonlyArray<readonly [token: string, role: ThemeColorRole]> = [
  ["--bg", "canvas"],
  ["--bg-sidebar", "sidebar"],
  ["--sidebar-solid", "sidebar"],
  ["--text", "text"],
  ["--text-muted", "textMuted"],
  ["--text-faint", "placeholder"],
  ["--accent", "accent"],
  ["--accent-fill", "messageAction"],
  ["--accent-hover", "messageActionHover"],
  ["--on-accent", "messageActionForeground"],
  ["--danger", "errorForeground"],
  ["--gold", "warningForeground"],
]

/*
 * Monocode's neutrals, for every theme: each fill is the theme's text at a few percent over
 * whatever is beneath, so it always shows (t3code themes often give their cards the canvas
 * color and lean on a border, which kiko does not draw) and glass shows through it. Shares are
 * monocode's selection strengths, gentler in light. [token, dark %, light %]
 */
export const NEUTRALS: ReadonlyArray<readonly [token: string, dark: number, light: number]> = [
  ["--card", 3, 3],
  ["--bg-subtle", 4, 3],
  ["--input-bg", 5, 4],
  ["--hover-bg", 5, 4],
  ["--nav-hover-bg", 5, 4],
  ["--selected-bg", 10, 6],
  ["--nav-active-bg", 10, 6],
  ["--surface-raised", 12, 7],
  ["--assistant-bubble", 6, 5],
  ["--tint-subtle", 5, 4],
  ["--tint", 8, 6],
  ["--tint-strong", 12, 8],
  ["--hairline", 7, 7],
  ["--panel-edge", 10, 10],
  ["--scrollbar-thumb", 20, 20],
  ["--scrollbar-thumb-hover", 32, 32],
  // The settings kit's control tokens (settings/kit.css), t3code's white/N in dark mode.
  ["--kit-border", 9, 9],
  ["--kit-input", 12, 12],
  ["--kit-input-fill", 4, 4],
  ["--kit-card", 3, 3],
  ["--kit-hover", 7, 7],
]

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

/** Lightness, chroma and hue of a stored color: hex or oklch, the two forms themes hold. */
export function oklchOf(color: string): { l: number; c: number; h: number } | null {
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(color)
  if (ok) return { l: Number(ok[1]) / (ok[2] ? 100 : 1), c: Number(ok[3]), h: Number(ok[4]) }
  const hexed = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color) ?? /^#([0-9a-f]{3})$/i.exec(color)
  if (!hexed) return null
  const digits = hexed[1]!.length === 3 ? [...hexed[1]!].map((d) => d + d).join("") : hexed[1]!
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = Number.parseInt(digits.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, c: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
}

/** Monocode's accent presets. Null keeps the theme's own primary action. */
export const ACCENT_PRESETS = ["#4da3f5", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#10b981"] as const
export const isAccent = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)

/** Black or white, whichever reads on the accent, as monocode picks it. */
export function accentForeground(color: string): "#000000" | "#ffffff" {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(color.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff"
}

/**
 * The custom properties a palette sets on <html>, in one appearance. `accent` is the person's
 * accent color: as in monocode, it fills the send button and tints their own bubbles.
 * `--hue` and `--h-brand` follow the accent, so the few colors kat.css still derives from a
 * hue, and the kiko bird, wear the theme too.
 */
export function tokensFor(colors: ThemeColors, mode: ThemeAppearance, accent: string | null = null, contrast = 100): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [token, role] of TOKEN_ROLES) vars[token] = colors[role]
  // Contrast scales every neutral's share, so borders, hairlines, and fills all move together. The
  // percent is computed here, never with calc() inside color-mix, which some browsers drop.
  const ink = (share: number) => `color-mix(in oklab, ${colors.text} ${Math.min(100, round((share * contrast) / 100, 2))}%, transparent)`
  for (const [token, dark, light] of NEUTRALS) vars[token] = ink(mode === "dark" ? dark : light)
  // Tooltips stay opaque: they are small and sit over text.
  // Menus, dialogs and the palette: in dark, monocode's glass, the background at 55% over a strong
  // backdrop blur (kat.css section 4d), so what is behind shows as soft color. In light, opaque,
  // as monocode's light popovers are.
  vars["--menu-bg"] = mode === "dark" ? `color-mix(in oklab, color-mix(in oklab, ${colors.text} 3%, ${colors.canvas}) 55%, transparent)` : colors.canvas
  vars["--tooltip-bg"] = `color-mix(in oklab, ${colors.text} 12%, ${colors.canvas})`
  // Your bubble: the content at 10% in dark, and solid in light, as monocode draws it.
  vars["--user-bubble"] = mode === "dark" ? ink(10) : colors.text
  vars["--user-bubble-text"] = mode === "dark" ? colors.text : colors.canvas
  if (accent) {
    vars["--accent-fill"] = accent
    vars["--on-accent"] = accentForeground(accent)
    vars["--accent-hover"] = `color-mix(in oklab, ${accent} 88%, ${colors.text})`
    vars["--user-bubble"] = `color-mix(in oklab, ${accent} 24%, transparent)`
    vars["--user-bubble-text"] = colors.text
  }
  vars["--user-bubble-deep"] = vars["--user-bubble"]!
  const brand = oklchOf(accent ?? colors.accent)
  if (brand) vars["--hue"] = vars["--h-brand"] = String(round(brand.h, 1))
  return vars
}

/** How colorful the accent is, 0 to 1, for the favicon bird. */
export function accentChroma(color: string): number {
  const brand = oklchOf(color)
  return brand ? Math.min(1, round(brand.c / 0.09, 2)) : 1
}

/** A theme as a file people can share and import again: t3code's format. */
export function serializeThemeFile(theme: ThemeDefinition): string {
  const file = {
    version: 1,
    id: theme.id,
    name: theme.label,
    appearance: theme.appearance,
    colors: theme.colors,
    ...(theme.variants ? { variants: theme.variants } : {}),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

export function colorsForMode(theme: ThemeDefinition, mode: ThemeAppearance): ThemeColors | null {
  if (mode === theme.appearance) return theme.colors
  return theme.variants?.[mode] ?? null
}

export function themeModes(theme: ThemeDefinition): ThemeAppearance[] {
  return (["light", "dark"] as const).filter((mode) => colorsForMode(theme, mode) !== null)
}

/** The appearance a mode resolves to on this device. */
export const resolveAppearance = (mode: ThemeMode, systemDark: boolean): ThemeAppearance =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode

// ---------------------------------------------------------------------------
// Reading stored themes. A stored color is trusted only as far as it can do no harm in a
// custom property: a short literal with no character that could end the declaration. The
// import path canonicalized it already; this guards against a hand-edited or corrupted store.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const isAppearance = (value: unknown): value is ThemeAppearance => value === "light" || value === "dark"
export const isThemeId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,47})$/.test(value)
const isLabel = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 48

export const isSafeColor = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 64 && /^(?:#[0-9a-f]{3,8}|(?:oklch|rgb|rgba|hsl|hsla)\([0-9a-z.%\s/,+-]+\))$/i.test(value.trim())

function readColors(value: unknown, appearance: ThemeAppearance): ThemeColors | null {
  if (!isRecord(value)) return null
  const colors: Record<string, string> = { ...defaultColors(appearance) }
  for (const role of THEME_COLOR_ROLES) if (isSafeColor(value[role])) colors[role] = (value[role] as string).trim()
  return colors as ThemeColors
}

/** Reads one stored theme. Anything malformed is dropped rather than half-applied. */
export function readStoredTheme(value: unknown): ThemeDefinition | null {
  if (!isRecord(value) || !isThemeId(value.id) || !isLabel(value.label) || !isAppearance(value.appearance)) return null
  const colors = readColors(value.colors, value.appearance)
  if (!colors) return null
  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {}
  if (isRecord(value.variants)) {
    for (const mode of ["light", "dark"] as const) {
      if (mode === value.appearance || value.variants[mode] === undefined) continue
      const variant = readColors(value.variants[mode], mode)
      if (variant) variants[mode] = variant
    }
  }
  const collection =
    isRecord(value.collection) && typeof value.collection.id === "string" && isLabel(value.collection.label)
      ? { id: value.collection.id.slice(0, 128), label: value.collection.label.trim() }
      : undefined
  return {
    id: value.id,
    label: value.label.trim(),
    appearance: value.appearance,
    colors,
    ...(Object.keys(variants).length ? { variants } : {}),
    ...(collection ? { collection } : {}),
  }
}

/** Reads a list of stored themes, dropping the malformed and the duplicates. */
export function readStoredThemes(raw: unknown): ThemeDefinition[] {
  if (!Array.isArray(raw)) return []
  const themes: ThemeDefinition[] = []
  for (const value of raw) {
    const theme = readStoredTheme(value)
    if (theme && !themes.some((t) => t.id === theme.id)) themes.push(theme)
  }
  return themes
}
