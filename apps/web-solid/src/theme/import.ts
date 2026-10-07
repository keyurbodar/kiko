// Theme files and VS Code theme conversion. Ported from t3code (MIT): apps/web/src/themePalette.ts
// (color math, the vivid palette engine, the theme file format) and apps/web/src/vscodeThemeImport.ts.
// This module and culori load only with the import dialog, never on first paint.

import "culori/css"
import { converter, parse } from "culori/fn"
import {
  THEME_COLOR_ROLES,
  defaultColors,
  isThemeId,
  themeModes,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
} from "./palette"

export const THEME_FILE_VERSION = 1
/** A full theme file is a few KB. Anything bigger is not read at all. */
export const MAX_THEME_FILE_BYTES = 256 * 1024
/** Ids no theme may take. */
const RESERVED_IDS = new Set(["system", "light", "dark", "default", "t3-chat", "grove", "ocean", "ember", "iris", "t3-chat-dark", "t3-grove", "t3-ocean", "t3-ember", "t3-iris"])
const ROLE_SET: ReadonlySet<string> = new Set(THEME_COLOR_ROLES)

type Rgb = { r: number; g: number; b: number }
type Oklch = { L: number; C: number; h: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const isAppearance = (value: unknown): value is ThemeAppearance => value === "light" || value === "dark"
const isLabel = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 48

// ---------------------------------------------------------------------------
// Color math

const toOklch = converter("oklch")

function parseColor(value: unknown): { color: Oklch; alpha: number } | null {
  if (typeof value !== "string" || value.length > 128) return null
  const input = value.trim()
  // Contextual colors cannot be resolved from stored data.
  if (/\bfrom\b|(?:var|env|attr|calc|min|max|clamp)\(|^(?:currentcolor|inherit|initial|unset|revert)$/i.test(input)) return null
  const parsed = parse(input)
  if (!parsed) return null
  const c = toOklch(parsed)
  const L = c.l ?? 0
  const C = c.c ?? 0
  const h = c.h ?? 0
  const alpha = /\/\s*none\s*\)$/i.test(input) ? 0 : (c.alpha ?? 1)
  if (![L, C, h, alpha].every(Number.isFinite)) return null
  return { color: { L: Math.min(1, Math.max(0, L)), C: Math.max(0, C), h }, alpha: Math.min(1, Math.max(0, alpha)) }
}

const num = (value: number, precision: number) =>
  (Math.abs(value) < 10 ** -precision / 2 ? 0 : value).toFixed(precision).replace(/(?:\.0+|(\.[0-9]*?)0+)$/, "$1")

function formatOklch(color: Oklch, alpha = 1): string {
  const hue = color.C < 0.0000005 ? 0 : ((color.h % 360) + 360) % 360
  const body = `${num(color.L, 6)} ${num(color.C, 6)} ${num(hue, 3)}`
  return alpha < 1 ? `oklch(${body} / ${num(alpha, 4)})` : `oklch(${body})`
}

/** A literal CSS color in the canonical oklch form themes are stored in, or null. */
export function canonicalColor(value: unknown): string | null {
  const parsed = parseColor(value)
  return parsed ? formatOklch(parsed.color, parsed.alpha) : null
}

const srgbToLinear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const linearToSrgb = (channel: number) => {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, c)) * 255)
}

function rgbToOklch(color: Rgb): Oklch {
  const r = srgbToLinear(color.r)
  const g = srgbToLinear(color.g)
  const b = srgbToLinear(color.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI }
}

function oklchToLinear({ L, C, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180
  const a = C * Math.cos(hr)
  const bb = C * Math.sin(hr)
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  }
}

/** The greatest chroma at the same lightness and hue that fits in sRGB. */
function toGamut(color: Oklch): Oklch {
  const fits = (C: number) => {
    const c = oklchToLinear({ ...color, C })
    return [c.r, c.g, c.b].every((channel) => channel >= -0.0001 && channel <= 1.0001)
  }
  if (fits(color.C)) return color
  let low = 0
  let high = color.C
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2
    if (fits(mid)) low = mid
    else high = mid
  }
  return { ...color, C: low }
}

function oklchToRgb(color: Oklch): Rgb {
  const c = oklchToLinear(toGamut(color))
  return { r: linearToSrgb(c.r), g: linearToSrgb(c.g), b: linearToSrgb(c.b) }
}

const rgbToColor = (color: Rgb) => formatOklch(rgbToOklch(color))
const oklchToColor = (color: Oklch) => formatOklch(toGamut(color))

function rgbOf(value: string, fallback: Rgb): Rgb {
  const parsed = parseColor(value)
  return parsed ? oklchToRgb(parsed.color) : fallback
}

function toHexColor(color: Rgb): string {
  return `#${[color.r, color.g, color.b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`
}

/** A theme color as #rrggbb (or #rrggbbaa), for the VS Code importer. */
export function colorToHex(value: string): string | null {
  const parsed = parseColor(value)
  if (!parsed) return null
  const hex = toHexColor(oklchToRgb(parsed.color))
  return parsed.alpha >= 1 ? hex : `${hex}${Math.round(parsed.alpha * 255).toString(16).padStart(2, "0")}`
}

const mixRgb = (base: Rgb, over: Rgb, amount: number): Rgb => ({
  r: base.r + (over.r - base.r) * amount,
  g: base.g + (over.g - base.g) * amount,
  b: base.b + (over.b - base.b) * amount,
})

function luminance(color: Rgb): number {
  const lin = (channel: number) => {
    const n = channel / 255
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b)
}

function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Binary-searches the lightness that reaches a contrast target against a background. */
function solveLightness(base: Oklch, against: Rgb, target: number, direction: "lighter" | "darker"): Oklch {
  let low = direction === "lighter" ? base.L : 0
  let high = direction === "lighter" ? 1 : base.L
  if (contrast(oklchToRgb(base), against) >= target) return base
  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2
    const ok = contrast(oklchToRgb({ ...base, L: mid }), against) >= target
    if (ok === (direction === "lighter")) high = mid
    else low = mid
  }
  return { ...base, L: direction === "lighter" ? high : low }
}

const LIGHT_FG: Rgb = { r: 255, g: 250, b: 255 }
const DARK_FG: Rgb = { r: 36, g: 21, b: 35 }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

function readableOn(background: Rgb): Rgb {
  const light = contrast(background, LIGHT_FG)
  const dark = contrast(background, DARK_FG)
  if (Math.max(light, dark) >= 4.5) return light >= dark ? LIGHT_FG : DARK_FG
  return contrast(background, WHITE) >= contrast(background, BLACK) ? WHITE : BLACK
}

/** The quietest mix of the foreground into the background that still clears the contrast floor. */
function readableText(background: Rgb, foreground: Rgb, amount: number, minimum: number): Rgb {
  const softened = mixRgb(foreground, background, amount)
  if (contrast(softened, background) >= minimum) return softened
  let readable = foreground
  let lower = 0
  let upper = amount
  for (let index = 0; index < 12; index += 1) {
    const mid = (lower + upper) / 2
    const candidate = mixRgb(foreground, background, mid)
    if (contrast(candidate, background) >= minimum) {
      readable = candidate
      lower = mid
    } else upper = mid
  }
  return readable
}

// The contrast of zinc-500 on the stock light canvas and #818181 on the stock dark one.
const mutedText = (background: Rgb, foreground: Rgb) =>
  readableText(background, foreground, 1, luminance(background) < 0.179 ? 5.082 : 4.705)

const STANDARD_STATUS = {
  light: { error: "#fb2c36", errorForeground: "#c10007", warning: "#fe9a00", warningForeground: "#bb4d00" },
  dark: { error: "#fb414a", errorForeground: "#ff6467", warning: "#fe9a00", warningForeground: "#ffb900" },
} as const

/** The stock status colors laid over the theme's own canvas, nudged until they read. */
function statusColors(canvas: Rgb) {
  const mode: ThemeAppearance = luminance(canvas) < 0.179 ? "dark" : "light"
  const standard = STANDARD_STATUS[mode]
  const surfaceOf = (value: string) => mixRgb(canvas, rgbOf(value, canvas), mode === "dark" ? 0.16 : 0.08)
  const readable = (fg: string, surface: Rgb) =>
    oklchToColor(solveLightness(rgbToOklch(rgbOf(fg, canvas)), surface, 4.6, mode === "dark" ? "lighter" : "darker"))
  const errorSurface = surfaceOf(standard.error)
  const warningSurface = surfaceOf(standard.warning)
  return {
    error: canonicalColor(standard.error)!,
    errorForeground: readable(standard.errorForeground, errorSurface),
    errorSurface: rgbToColor(errorSurface),
    warning: canonicalColor(standard.warning)!,
    warningForeground: readable(standard.warningForeground, warningSurface),
    warningSurface: rgbToColor(warningSurface),
  }
}

/**
 * A full palette from two seed colors, in OKLCH. Surfaces climb an even lightness ramp that
 * carries the accent hue at low chroma, the action color is rotated off the accent, and every
 * foreground is solved for contrast against its own surface.
 */
export function createVividThemeColors(appearance: ThemeAppearance, background: string, accentValue: string): ThemeColors {
  const canvasRgb = rgbOf(background, appearance === "dark" ? { r: 24, g: 15, b: 27 } : { r: 250, g: 245, b: 250 })
  const accentRgb = rgbOf(accentValue, { r: 168, g: 67, b: 112 })
  const canvas = rgbToOklch(canvasRgb)
  const accent = rgbToOklch(accentRgb)
  const dark = luminance(canvasRgb) < 0.179
  const hue = accent.C < 0.02 ? canvas.h : accent.h
  const tintC = Math.min(0.045, Math.max(0.008, accent.C * 0.22))
  const step = dark ? 1 : -1
  const at = (deltaL: number, chroma = tintC): Oklch => ({ L: Math.min(0.98, Math.max(0.05, canvas.L + step * deltaL)), C: chroma, h: hue })
  const textBase: Oklch = { L: dark ? 0.95 : 0.2, C: Math.min(0.035, accent.C * 0.25), h: hue }
  const textRgb = oklchToRgb(solveLightness(textBase, canvasRgb, 7, dark ? "lighter" : "darker"))
  const textMutedRgb = mutedText(canvasRgb, textRgb)
  const action: Oklch = { L: Math.min(0.85, Math.max(0.35, accent.L + (dark ? 0.06 : -0.02))), C: Math.max(accent.C * 0.9, 0.06), h: (hue + 50) % 360 }
  const actionRgb = oklchToRgb(action)
  const sidebar = at(0.045, tintC * 1.4)
  const sidebarRgb = oklchToRgb(sidebar)
  const surfaceRaisedRgb = oklchToRgb(at(0.05))
  const secondary = at(dark ? 0.1 : 0.06, Math.min(0.09, accent.C * 0.5))
  const muted = at(dark ? 0.06 : 0.04, Math.min(0.06, accent.C * 0.35))
  const accentSurface = at(dark ? 0.13 : 0.08, Math.min(0.11, accent.C * 0.55))
  const messageSurface = at(dark ? 0.16 : 0.1, Math.min(0.13, accent.C * 0.6))
  const updateSurface = at(dark ? 0.14 : 0.09, Math.min(0.12, accent.C * 0.55))
  const fgOn = (surface: Rgb) => oklchToColor(solveLightness(textBase, surface, 4.6, dark ? "lighter" : "darker"))
  const text = rgbToColor(textRgb)
  const textMuted = rgbToColor(textMutedRgb)
  return {
    ...defaultColors(appearance),
    ...statusColors(canvasRgb),
    canvas: rgbToColor(canvasRgb),
    chrome: rgbToColor(canvasRgb),
    toolbar: rgbToColor(canvasRgb),
    toolbarForeground: text,
    toolbarBorder: oklchToColor(at(dark ? 0.14 : 0.1, Math.min(0.08, accent.C * 0.4))),
    toolbarControl: oklchToColor(at(dark ? 0.09 : 0.05, tintC * 1.3)),
    toolbarControlForeground: text,
    toolbarControlHover: oklchToColor(at(dark ? 0.14 : 0.09, tintC * 1.6)),
    surface: oklchToColor(at(0.015)),
    surfaceRaised: rgbToColor(surfaceRaisedRgb),
    surfaceOverlay: oklchToColor(at(0.075)),
    text,
    textMuted,
    border: oklchToColor(at(dark ? 0.16 : 0.12, Math.min(0.07, accent.C * 0.35))),
    input: oklchToColor(at(dark ? 0.21 : 0.16, Math.min(0.08, accent.C * 0.4))),
    focus: rgbToColor(accentRgb),
    accent: rgbToColor(accentRgb),
    accentForeground: rgbToColor(readableOn(accentRgb)),
    secondary: oklchToColor(secondary),
    secondaryForeground: fgOn(oklchToRgb(secondary)),
    muted: oklchToColor(muted),
    mutedForeground: rgbToColor(readableText(oklchToRgb(muted), textRgb, 1, 4.6)),
    placeholder: rgbToColor(readableText(surfaceRaisedRgb, textRgb, 1, 4.6)),
    secondaryLabel: textMuted,
    iconMuted: textMuted,
    update: rgbToColor(accentRgb),
    updateForeground: fgOn(oklchToRgb(updateSurface)),
    updateSurface: oklchToColor(updateSurface),
    accentSurface: oklchToColor(accentSurface),
    accentSurfaceForeground: fgOn(oklchToRgb(accentSurface)),
    messageSurface: oklchToColor(messageSurface),
    messageForeground: fgOn(oklchToRgb(messageSurface)),
    messageAction: rgbToColor(actionRgb),
    messageActionForeground: rgbToColor(readableOn(actionRgb)),
    messageActionHover: oklchToColor({ ...action, L: action.L + (dark ? 0.06 : -0.06) }),
    codeBackground: oklchToColor(at(0.035, tintC * 0.8)),
    codeForeground: text,
    sidebar: oklchToColor(sidebar),
    sidebarForeground: fgOn(sidebarRgb),
    sidebarMutedForeground: rgbToColor(mutedText(sidebarRgb, textRgb)),
    sidebarControlSurface: oklchToColor(at(dark ? 0.1 : 0.07, tintC * 1.5)),
    sidebarRowHover: oklchToColor(at(dark ? 0.08 : 0.06, Math.min(0.08, accent.C * 0.45))),
    sidebarRowActive: oklchToColor(at(dark ? 0.12 : 0.09, Math.min(0.1, accent.C * 0.55))),
    sidebarRowSelected: oklchToColor(at(dark ? 0.14 : 0.1, Math.min(0.11, accent.C * 0.6))),
    sidebarBorder: oklchToColor(at(dark ? 0.17 : 0.12, Math.min(0.08, accent.C * 0.4))),
    terminalBackground: rgbToColor(canvasRgb),
    terminalForeground: text,
    terminalCursor: rgbToColor(accentRgb),
    terminalSelection: oklchToColor(at(dark ? 0.18 : 0.12, Math.min(0.12, accent.C * 0.55))),
    terminalScrollbar: oklchToColor(at(dark ? 0.22 : 0.16, tintC)),
    terminalScrollbarHover: oklchToColor(at(dark ? 0.3 : 0.22, tintC)),
  }
}

// ---------------------------------------------------------------------------
// Theme files: { version: 1, name, appearance, colors, variants? }

export function themeIdFromName(name: string): string {
  const id = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return id || "custom-theme"
}

function parseOverrides(value: unknown): Partial<Record<ThemeColorRole, string>> {
  if (!isRecord(value)) throw new Error("Theme colors must be objects.")
  const overrides: Partial<Record<ThemeColorRole, string>> = {}
  for (const [role, color] of Object.entries(value)) {
    if (!ROLE_SET.has(role)) throw new Error(`"${role}" is not a supported theme color role.`)
    const normalized = canonicalColor(color)
    if (!normalized) throw new Error(`The color for "${role}" must be a literal CSS color such as oklch(0.62 0.2 280).`)
    overrides[role as ThemeColorRole] = normalized
  }
  if (Object.keys(overrides).length === 0) throw new Error("Add at least one color role to the theme file.")
  return overrides
}

/* The stock palettes in canonical form, so a parsed theme stores every role the same way. */
const canonicalDefaults: Partial<Record<ThemeAppearance, ThemeColors>> = {}
function stockColors(appearance: ThemeAppearance): ThemeColors {
  return (canonicalDefaults[appearance] ??= Object.fromEntries(
    THEME_COLOR_ROLES.map((role) => [role, canonicalColor(defaultColors(appearance)[role])!]),
  ) as ThemeColors)
}

/** Reads a theme file, filling the roles it leaves out from the stock palette of its appearance. */
export function parseThemeFile(value: unknown): ThemeDefinition {
  if (!isRecord(value)) throw new Error("Theme files must contain a JSON object.")
  if (value.version !== THEME_FILE_VERSION) throw new Error(`This theme file uses an unsupported version. Expected ${THEME_FILE_VERSION}.`)
  const { name, appearance } = value
  if (!isLabel(name)) throw new Error("Theme files need a name (48 characters or fewer).")
  if (!isAppearance(appearance)) throw new Error('Theme files need an appearance of "light" or "dark".')
  if (!isRecord(value.colors)) throw new Error("Theme files need a colors object.")
  const id = value.id === undefined ? themeIdFromName(name) : value.id
  if (!isThemeId(id)) throw new Error("Theme ids may only contain lowercase letters, numbers, and hyphens.")
  if (RESERVED_IDS.has(id)) throw new Error(`The theme id "${id}" is reserved.`)
  const colors = { ...stockColors(appearance), ...parseOverrides(value.colors) }
  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {}
  if (value.variants !== undefined) {
    if (!isRecord(value.variants)) throw new Error("Theme variants must be an object.")
    for (const [mode, overrides] of Object.entries(value.variants)) {
      if (!isAppearance(mode)) throw new Error('Theme variants may only be named "light" or "dark".')
      if (mode === appearance) throw new Error(`Theme variants must not repeat the base appearance "${appearance}".`)
      variants[mode] = { ...stockColors(mode), ...parseOverrides(overrides) }
    }
  }
  const collection =
    isRecord(value.collection) && typeof value.collection.id === "string" && isLabel(value.collection.label)
      ? { id: value.collection.id, label: value.collection.label.trim() }
      : undefined
  return {
    id,
    label: name.trim(),
    appearance,
    colors,
    ...(Object.keys(variants).length ? { variants } : {}),
    ...(collection ? { collection } : {}),
  }
}

// ---------------------------------------------------------------------------
// VS Code color themes (`*-color-theme.json`)

type VsRgba = Rgb & { a: number }

function parseVsColor(value: unknown): VsRgba | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.startsWith("color(")) {
    const parsed = parseColor(trimmed)
    if (!parsed) return null
    return { ...oklchToRgb(parsed.color), a: parsed.alpha }
  }
  const hex = trimmed.replace(/^#/, "")
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null
  const expand = (part: string) => (part.length === 1 ? Number.parseInt(part + part, 16) : Number.parseInt(part, 16))
  if (hex.length <= 4) {
    return { r: expand(hex[0]!), g: expand(hex[1]!), b: expand(hex[2]!), a: hex.length === 4 ? expand(hex[3]!) / 255 : 1 }
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  }
}

/** VS Code overlays are translucent; theme roles are opaque, so they are composited onto their surface. */
function flattenOver(color: VsRgba, base: Rgb): string {
  if (color.a >= 1) return toHexColor(color)
  return toHexColor({ r: color.r * color.a + base.r * (1 - color.a), g: color.g * color.a + base.g * (1 - color.a), b: color.b * color.a + base.b * (1 - color.a) })
}

const hexToRgb = (value: string): Rgb => parseVsColor(colorToHex(value) ?? value) ?? { r: 0, g: 0, b: 0, a: 1 }

/** A VS Code theme has dotted workbench keys (`editor.background`), which kiko files never use. */
export function isVsCodeThemeFile(value: unknown): boolean {
  if (!isRecord(value) || value.version === THEME_FILE_VERSION) return false
  return (isRecord(value.colors) && Object.keys(value.colors).some((key) => key.includes("."))) || Array.isArray(value.tokenColors)
}

/** Extension `name` fields are often slugs; read them as words. */
export function humanizeThemeName(raw: string): string {
  const trimmed = raw.trim()
  if (/\s/.test(trimmed) || !/[-_.]/.test(trimmed)) return trimmed
  return trimmed
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

/**
 * Converts a VS Code theme. The derived palette is the floor: every role starts contrast-solved
 * from the editor background and a muted accent, then the theme's own workbench colors replace
 * what it specified, as long as foregrounds stay readable and controls stay distinct.
 */
export function parseVsCodeThemeFile(value: unknown): ThemeDefinition {
  if (!isRecord(value)) throw new Error("Theme files must contain a JSON object.")
  const colors = isRecord(value.colors) ? value.colors : {}
  const pick = (...keys: string[]): VsRgba | null => {
    for (const key of keys) {
      const parsed = parseVsColor(colors[key])
      if (parsed) return parsed
    }
    return null
  }
  const solidOver = (base: Rgb, ...keys: string[]): string | null => {
    const parsed = pick(...keys)
    return parsed ? flattenOver(parsed, base) : null
  }

  const canvasColor = pick("editor.background", "editorPane.background")
  if (!canvasColor) throw new Error('That VS Code theme has no "editor.background" color, so there is nothing to build a palette from.')
  const canvas: Rgb = { r: canvasColor.r, g: canvasColor.g, b: canvasColor.b }
  const type = typeof value.type === "string" ? value.type.toLowerCase() : null
  const appearance: ThemeAppearance =
    type === "light" || type === "hc-light" ? "light" : type === "dark" || type === "hc-black" ? "dark" : luminance(canvas) < 0.179 ? "dark" : "light"
  const canvasHex = toHexColor(canvas)
  const raisedCandidate = solidOver(canvas, "editorWidget.background", "dropdown.background")
  const apart = (a: string, b: string) => contrast(hexToRgb(a), hexToRgb(b)) >= 1.1

  let accent: VsRgba | null = null
  let accentHex: string | null = null
  for (const key of ["focusBorder", "button.background", "textLink.foreground", "activityBarBadge.background", "progressBar.background", "badge.background"]) {
    const candidate = parseVsColor(colors[key])
    if (!candidate) continue
    const hex = flattenOver(candidate, canvas)
    if (!apart(hex, canvasHex) || (raisedCandidate !== null && !apart(hex, raisedCandidate))) continue
    accent = candidate
    accentHex = hex
    break
  }
  if (!accent || !accentHex) {
    const standard = colorToHex(defaultColors(appearance).accent)!
    accentHex = [standard, "#ffffff", "#000000"].find((c) => apart(c, canvasHex) && (raisedCandidate === null || apart(c, raisedCandidate))) ?? standard
    accent = parseVsColor(accentHex)!
  }

  const mutedAccentHex = flattenOver({ r: accent.r, g: accent.g, b: accent.b, a: 0.2 }, canvas)
  const derived = createVividThemeColors(appearance, canvasHex, mutedAccentHex)
  const sidebarHex = solidOver(canvas, "sideBar.background", "activityBar.background") ?? derived.sidebar
  const sidebar = hexToRgb(sidebarHex)
  const terminalHex = solidOver(canvas, "terminal.background", "panel.background") ?? derived.terminalBackground
  const terminal = hexToRgb(terminalHex)

  /** A foreground wins only when it stays readable on the surface it lands on. */
  const readable = (surface: string, fallback: string, ...keys: string[]): string => {
    const surfaceRgb = hexToRgb(surface)
    const ok = (candidate: string) => contrast(hexToRgb(candidate), surfaceRgb) >= 4.5
    const specified = solidOver(surfaceRgb, ...keys)
    if (specified && ok(specified)) return specified
    if (ok(fallback)) return fallback
    return luminance(surfaceRgb) < 0.179 ? "#ffffff" : "#000000"
  }

  const surfaceRaisedHex = raisedCandidate ?? derived.surfaceRaised
  const buttonHex = solidOver(canvas, "button.background")
  const actionHex = buttonHex && apart(buttonHex, canvasHex) && apart(buttonHex, surfaceRaisedHex) ? buttonHex : accentHex
  let inputHex =
    [derived.input, derived.surfaceRaised, defaultColors(appearance).input, "#000000", "#ffffff", "#808080"].find(
      (c) => apart(c, canvasHex) && apart(c, actionHex),
    ) ?? "#808080"
  for (const key of ["input.background", "input.border"]) {
    const candidate = solidOver(canvas, key)
    if (candidate && apart(candidate, canvasHex) && apart(candidate, actionHex)) {
      inputHex = candidate
      break
    }
  }

  const overrides: Partial<Record<ThemeColorRole, string>> = {
    canvas: canvasHex,
    text: readable(canvasHex, derived.text, "editor.foreground", "foreground"),
    textMuted: readable(canvasHex, derived.textMuted, "descriptionForeground", "disabledForeground"),
    surface: solidOver(canvas, "editorWidget.background") ?? derived.surface,
    surfaceRaised: surfaceRaisedHex,
    surfaceOverlay: solidOver(canvas, "menu.background", "quickInput.background", "dropdown.background") ?? derived.surfaceOverlay,
    border: solidOver(canvas, "panel.border", "editorGroup.border", "contrastBorder") ?? derived.border,
    input: inputHex,
    placeholder: readable(surfaceRaisedHex, derived.placeholder, "input.placeholderForeground"),
    error: readable(canvasHex, derived.error, "editorError.foreground", "errorForeground"),
    warning: readable(canvasHex, derived.warning, "editorWarning.foreground"),
    accentSurface: solidOver(canvas, "list.activeSelectionBackground", "list.hoverBackground") ?? derived.accentSurface,
    codeBackground: solidOver(canvas, "textCodeBlock.background") ?? derived.codeBackground,
    sidebar: sidebarHex,
    sidebarForeground: readable(sidebarHex, derived.sidebarForeground, "sideBar.foreground"),
    sidebarBorder: solidOver(sidebar, "sideBar.border") ?? derived.sidebarBorder,
    sidebarRowHover: solidOver(sidebar, "list.hoverBackground") ?? derived.sidebarRowHover,
    sidebarRowActive: solidOver(sidebar, "list.inactiveSelectionBackground", "list.hoverBackground") ?? derived.sidebarRowActive,
    sidebarRowSelected: solidOver(sidebar, "list.activeSelectionBackground") ?? derived.sidebarRowSelected,
    terminalBackground: terminalHex,
    terminalForeground: readable(terminalHex, derived.terminalForeground, "terminal.foreground"),
    terminalCursor: solidOver(terminal, "terminalCursor.foreground", "editorCursor.foreground") ?? derived.terminalCursor,
    terminalSelection: solidOver(terminal, "terminal.selectionBackground", "editor.selectionBackground") ?? derived.terminalSelection,
    terminalScrollbar: solidOver(terminal, "scrollbarSlider.background") ?? derived.terminalScrollbar,
    accent: accentHex,
    focus: accentHex,
    messageAction: actionHex,
    messageActionForeground: readable(actionHex, derived.messageActionForeground, "button.foreground"),
    accentForeground: readable(accentHex, derived.accentForeground, "button.foreground"),
  }

  let name = "VS Code theme"
  for (const candidate of [value.displayName, value.name]) {
    if (typeof candidate !== "string") continue
    const humanized = humanizeThemeName(candidate)
    if (humanized) {
      name = humanized.slice(0, 48)
      break
    }
  }
  const id = themeIdFromName(name)
  return parseThemeFile({
    version: THEME_FILE_VERSION,
    ...(RESERVED_IDS.has(id) ? { id: `${id}-vscode` } : {}),
    name,
    appearance,
    colors: { ...derived, ...overrides },
  })
}

/**
 * A light and a dark theme whose names differ only by the appearance word become one theme
 * with both modes. Anything ambiguous stays as it is.
 */
export function pairVsCodeThemes(
  themes: readonly ThemeDefinition[],
  options?: { pairedId?: (light: ThemeDefinition, dark: ThemeDefinition) => string },
): ThemeDefinition[] {
  const strip = (label: string) => label.replace(/\b(?:light|dark)\b/gi, " ").replace(/\s+/g, " ").trim()
  type Group = { light: ThemeDefinition[]; dark: ThemeDefinition[]; order: number }
  const groups = new Map<string, Group>()
  const out: Array<{ theme: ThemeDefinition; order: number }> = []
  themes.forEach((theme, order) => {
    const key = strip(theme.label)
    if (themeModes(theme).length !== 1 || key === theme.label || !/[a-z0-9]/i.test(key)) return void out.push({ theme, order })
    const group = groups.get(key) ?? { light: [], dark: [], order }
    group[theme.appearance].push(theme)
    groups.set(key, group)
  })
  for (const [key, group] of groups) {
    if (group.light.length === 1 && group.dark.length === 1) {
      try {
        out.push({
          order: group.order,
          theme: parseThemeFile({
            version: THEME_FILE_VERSION,
            ...(options?.pairedId ? { id: options.pairedId(group.light[0]!, group.dark[0]!) } : {}),
            name: key,
            appearance: "light",
            colors: group.light[0]!.colors,
            variants: { dark: group.dark[0]!.colors },
          }),
        })
        continue
      } catch {
        // Fall through to the single themes.
      }
    }
    for (const theme of [...group.light, ...group.dark]) out.push({ theme, order: group.order })
  }
  return out.sort((a, b) => a.order - b.order).map((entry) => entry.theme)
}

/**
 * Some extensions reuse one name across files (Dracula ships dracula.json and dracula-soft.json,
 * both "Dracula"). Colliding entries are renamed from their file name, then numbered.
 */
export function resolveLabelCollisions(entries: ReadonlyArray<{ theme: ThemeDefinition; sourceName?: string }>): ThemeDefinition[] {
  const rename = (theme: ThemeDefinition, name: string): ThemeDefinition | null => {
    try {
      return parseThemeFile({
        version: THEME_FILE_VERSION,
        name: name.slice(0, 48),
        appearance: theme.appearance,
        colors: theme.colors,
        ...(theme.variants ? { variants: theme.variants } : {}),
      })
    } catch {
      return null
    }
  }
  const counts = new Map<string, number>()
  for (const { theme } of entries) counts.set(theme.id, (counts.get(theme.id) ?? 0) + 1)
  const relabelled = entries.map(({ theme, sourceName }) => {
    if ((counts.get(theme.id) ?? 0) < 2) return theme
    const stem = sourceName?.replace(/\.[^.]+$/, "")
    const fromFile = stem ? humanizeThemeName(stem) : null
    return (fromFile && fromFile.toLowerCase() !== theme.label.toLowerCase() ? rename(theme, fromFile) : null) ?? theme
  })
  const seen = new Set<string>()
  return relabelled.map((theme) => {
    if (!seen.has(theme.id)) {
      seen.add(theme.id)
      return theme
    }
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = rename(theme, `${theme.label} ${suffix}`)
      if (candidate && !seen.has(candidate.id)) {
        seen.add(candidate.id)
        return candidate
      }
    }
    return theme
  })
}

/** Reads pasted or dropped JSON as a kiko/t3code theme file or a VS Code theme. */
export function parseAnyThemeFile(text: string): ThemeDefinition {
  if (text.length > MAX_THEME_FILE_BYTES) throw new Error("That file is too large to be a theme.")
  const value: unknown = JSON.parse(stripJsonComments(text))
  return isVsCodeThemeFile(value) ? parseVsCodeThemeFile(value) : parseThemeFile(value)
}

/**
 * VS Code theme files are JSONC: comments and trailing commas. Strips both outside strings so
 * JSON.parse can read them.
 */
export function stripJsonComments(source: string): string {
  let out = ""
  let i = 0
  let inString = false
  while (i < source.length) {
    const c = source[i]!
    if (inString) {
      out += c
      if (c === "\\") {
        out += source[i + 1] ?? ""
        i += 2
        continue
      }
      if (c === '"') inString = false
      i += 1
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      i += 1
    } else if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1
    } else if (c === "/" && source[i + 1] === "*") {
      i += 2
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1
      i += 2
    } else {
      out += c
      i += 1
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}
