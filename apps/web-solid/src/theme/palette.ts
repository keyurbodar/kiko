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
export function tokensFor(colors: ThemeColors, mode: ThemeAppearance, accent: string | null = null): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [token, role] of TOKEN_ROLES) vars[token] = colors[role]
  const ink = (share: number) => `color-mix(in oklab, ${colors.text} ${share}%, transparent)`
  for (const [token, dark, light] of NEUTRALS) vars[token] = ink(mode === "dark" ? dark : light)
  // Opaque where something must hide what is under it: dialogs and tooltips.
  vars["--menu-bg"] = mode === "dark" ? `color-mix(in oklab, ${colors.text} 4%, ${colors.canvas})` : colors.canvas
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
