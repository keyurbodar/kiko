// The theme model, ported from t3code (MIT): packages/shared/src/themePalettes.ts and
// apps/web/src/themePalette.ts. A theme names a color per product role. Kiko keeps t3code's
// roles and file format, so a t3code theme file imports unchanged, and `TOKEN_ROLES` maps each
// role onto the tokens kat.css already gives the UI. A theme changes colors and nothing else.
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

/** t3code's stock light palette, the look with no theme installed. */
export const DEFAULT_LIGHT_COLORS: ThemeColors = {
  canvas: "#fcfcfc",
  chrome: "#fcfcfc",
  toolbar: "#fcfcfc",
  toolbarForeground: "#27272a",
  toolbarBorder: "#e4e4e7",
  toolbarControl: "#ffffff",
  toolbarControlForeground: "#27272a",
  toolbarControlHover: "#f4f4f5",
  surface: "#ffffff",
  surfaceRaised: "#fcfcfc",
  surfaceOverlay: "#ffffff",
  text: "#27272a",
  textMuted: "#71717b",
  border: "#e4e4e7",
  input: "#d4d4d8",
  focus: "#1b4ed8",
  accent: "#1b4ed8",
  accentForeground: "#ffffff",
  secondary: "#fafafa",
  secondaryForeground: "#27272a",
  muted: "#fafafa",
  mutedForeground: "#71717b",
  placeholder: "#71717b",
  secondaryLabel: "#71717b",
  iconMuted: "#71717b",
  error: "#fb2c36",
  errorForeground: "#c10007",
  errorSurface: "#fcebec",
  warning: "#fe9a00",
  warningForeground: "#bb4d00",
  warningSurface: "#fcf4e8",
  update: "#1b4ed8",
  updateForeground: "#1b4ed8",
  updateSurface: "#e0e6f7",
  accentSurface: "#f4f4f5",
  accentSurfaceForeground: "#18181b",
  messageSurface: "#f4f4f5",
  messageForeground: "#27272a",
  messageAction: "#1b4ed8",
  messageActionForeground: "#ffffff",
  messageActionHover: "#3160db",
  codeBackground: "#ffffff",
  codeForeground: "#27272a",
  sidebar: "#fafafa",
  sidebarForeground: "#27272a",
  sidebarMutedForeground: "#71717b",
  sidebarControlSurface: "#f4f4f5",
  sidebarRowHover: "#fcfcfc",
  sidebarRowActive: "#ffffff",
  sidebarRowSelected: "#ffffff",
  sidebarBorder: "#e4e4e7",
  terminalBackground: "#fcfcfc",
  terminalForeground: "#27272a",
  terminalCursor: "#26384e",
  terminalSelection: "#d0d6dd",
  terminalScrollbar: "#d6d6d6",
  terminalScrollbarHover: "#bdbdbd",
}

/** t3code's stock dark palette. */
export const DEFAULT_DARK_COLORS: ThemeColors = {
  canvas: "#0a0a0a",
  chrome: "#0a0a0a",
  toolbar: "#0a0a0a",
  toolbarForeground: "#f5f5f5",
  toolbarBorder: "#191919",
  toolbarControl: "#111111",
  toolbarControlForeground: "#f5f5f5",
  toolbarControlHover: "#141414",
  surface: "#111111",
  surfaceRaised: "#111111",
  surfaceOverlay: "#111111",
  text: "#f5f5f5",
  textMuted: "#818181",
  border: "#191919",
  input: "#1e1e1e",
  focus: "#346bf1",
  accent: "#346bf1",
  accentForeground: "#ffffff",
  secondary: "#111111",
  secondaryForeground: "#f5f5f5",
  muted: "#111111",
  mutedForeground: "#818181",
  placeholder: "#818181",
  secondaryLabel: "#818181",
  iconMuted: "#818181",
  error: "#fb414a",
  errorForeground: "#ff6467",
  errorSurface: "#301214",
  warning: "#fe9a00",
  warningForeground: "#ffb900",
  warningSurface: "#312108",
  update: "#346bf1",
  updateForeground: "#51a2ff",
  updateSurface: "#121b34",
  accentSurface: "#141414",
  accentSurfaceForeground: "#f5f5f5",
  messageSurface: "#141414",
  messageForeground: "#f5f5f5",
  messageAction: "#346bf1",
  messageActionForeground: "#ffffff",
  messageActionHover: "#3061d9",
  codeBackground: "#111111",
  codeForeground: "#f5f5f5",
  sidebar: "#000000",
  sidebarForeground: "#f1f3f7",
  sidebarMutedForeground: "#a3a3a3",
  sidebarControlSurface: "#0a0a0a",
  sidebarRowHover: "#131313",
  sidebarRowActive: "#1a1b1b",
  sidebarRowSelected: "#111111",
  sidebarBorder: "#141414",
  terminalBackground: "#0a0a0a",
  terminalForeground: "#f5f5f5",
  terminalCursor: "#b4cbff",
  terminalSelection: "#343a47",
  terminalScrollbar: "#222222",
  terminalScrollbarHover: "#363636",
}

export const defaultColors = (appearance: ThemeAppearance): ThemeColors =>
  appearance === "dark" ? DEFAULT_DARK_COLORS : DEFAULT_LIGHT_COLORS


/*
 * Where each role lands in kat.css. Every token here is a final color a component already
 * reads. t3code has no role for kiko's chips and counts, so those mix the text into the
 * canvas, and success keeps kat.css's green. The toolbar and terminal roles have no surface
 * in kiko except the scrollbar; the rest are kept so a file round-trips.
 */
export const TOKEN_ROLES: ReadonlyArray<readonly [token: string, role: ThemeColorRole]> = [
  ["--bg", "canvas"],
  ["--bg-sidebar", "sidebar"],
  ["--sidebar-solid", "sidebar"],
  ["--bg-subtle", "muted"],
  ["--surface-raised", "surfaceRaised"],
  ["--card", "surface"],
  ["--menu-bg", "surfaceOverlay"],
  ["--tooltip-bg", "surfaceOverlay"],
  ["--input-bg", "surface"],
  ["--hover-bg", "accentSurface"],
  ["--selected-bg", "accentSurface"],
  ["--nav-hover-bg", "sidebarRowHover"],
  ["--nav-active-bg", "sidebarRowActive"],
  ["--text", "text"],
  ["--text-muted", "textMuted"],
  ["--text-faint", "placeholder"],
  ["--accent", "accent"],
  ["--accent-fill", "messageAction"],
  ["--accent-hover", "messageActionHover"],
  ["--on-accent", "messageActionForeground"],
  ["--assistant-bubble", "surface"],
  ["--user-bubble", "messageSurface"],
  ["--user-bubble-deep", "messageSurface"],
  ["--user-bubble-text", "messageForeground"],
  ["--danger", "errorForeground"],
  ["--gold", "warningForeground"],
  ["--hairline", "border"],
  ["--scrollbar-thumb", "terminalScrollbar"],
  ["--scrollbar-thumb-hover", "terminalScrollbarHover"],
]

/** Chips and counts: the text mixed into the canvas, by share. */
const MIXES: ReadonlyArray<readonly [token: string, share: number]> = [
  ["--tint-subtle", 7],
  ["--tint", 12],
  ["--tint-strong", 18],
]

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

/** Lightness, chroma and hue of a stored color: hex or oklch, the two forms themes hold. */
export function oklchOf(color: string): { l: number; c: number; h: number } | null {
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(color)
  if (ok) return { l: Number(ok[1]) / (ok[2] ? 100 : 1), c: Number(ok[3]), h: Number(ok[4]) }
  const hex = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color) ?? /^#([0-9a-f]{3})$/i.exec(color)
  if (!hex) return null
  const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join("") : hex[1]!
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

/**
 * The custom properties a palette sets on <html>. `--hue` and `--h-brand` follow the accent,
 * so the few colors kat.css still derives from a hue, and the kiko bird, wear the theme too.
 */
export function tokensFor(colors: ThemeColors): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [token, role] of TOKEN_ROLES) vars[token] = colors[role]
  for (const [token, share] of MIXES) vars[token] = `color-mix(in oklab, ${colors.text} ${share}%, ${colors.canvas})`
  const brand = oklchOf(colors.accent)
  if (brand) vars["--hue"] = vars["--h-brand"] = String(round(brand.h, 1))
  return vars
}

/** How colorful the accent is, 0 to 1, for the favicon bird. */
export function accentChroma(colors: ThemeColors): number {
  const brand = oklchOf(colors.accent)
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
