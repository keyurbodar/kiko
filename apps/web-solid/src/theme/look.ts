// A person's look: the appearance mode, the theme that owns each half (light and dark), and the
// bird each agent wears. It is one JSON record, synced through the user socket's theme slot, so
// the server keeps it as opaque text. Parsing happens here, at the edge. Everything past it
// trusts the type.
//
// The halves follow t3code (MIT, apps/web/src/hooks/useTheme.ts): a two-mode theme can own both,
// a light-only theme owns the light half. The library of imported themes stays in this browser,
// as in t3code, but the record carries the imported themes its halves name, so another device
// paints the same look.

import { BUILT_IN_THEMES } from "./builtins"
import {
  colorsForMode,
  DEFAULT_TINT,
  isAccent,
  isThemeId,
  monocodeColors,
  readStoredThemes,
  readWallpaperPalette,
  TINT_RANGE,
  WALLPAPER_ID,
  wallpaperAccent,
  wallpaperColors,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeMode,
  type Tint,
  type WallpaperPalette,
} from "./palette"
import { DEFAULT_DISPLAY, readDisplay, type Display } from "./display"

export type Mode = ThemeMode
export const MODES: readonly Mode[] = ["system", "light", "dark"]

export type Look = {
  mode: Mode
  /** The theme id for each half. Null is the stock palette, monocode's, in `tint`. */
  light: string | null
  dark: string | null
  /** The imported themes `light` and `dark` name. Built-ins are never carried. */
  themes: readonly ThemeDefinition[]
  /** Monocode's tint of the stock palette. */
  tint: Tint
  /** Monocode's accent color, a hex, or null for the theme's own. */
  accent: string | null
  /**
   * The chat background's palette, read from the picture, while a half matches the wallpaper.
   * It travels with the look, so another device paints the same colors without the picture.
   */
  wallpaper: WallpaperPalette | null
  /** An agent slug to the bird it wears. A slug without an entry gets the bird its slug seeds. */
  birds: Readonly<Record<string, string>>
  /** Contrast, text size, chat width, fonts (display.ts). */
  display: Display
}

export const DEFAULT_LOOK: Look = { mode: "dark", light: null, dark: null, themes: [], tint: DEFAULT_TINT, accent: null, wallpaper: null, birds: {}, display: DEFAULT_DISPLAY }

const MAX_BIRDS = 200
const BIRD_ID = /^[a-z0-9.-]{1,48}$/
const SLUG = /^[a-z0-9_-]{1,40}$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const isBuiltIn = (id: string) => BUILT_IN_THEMES.some((t) => t.id === id)

/** Reads stored text. Anything it cannot read falls back to the default look, never an error. */
export function parseLook(text: string | null): Look {
  if (!text) return DEFAULT_LOOK
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return DEFAULT_LOOK
  }
  if (!isObject(raw) || raw.kind !== "look") return DEFAULT_LOOK
  const mode = MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : DEFAULT_LOOK.mode
  const birds: Record<string, string> = {}
  if (isObject(raw.birds)) {
    for (const [slug, id] of Object.entries(raw.birds).slice(0, MAX_BIRDS)) {
      if (SLUG.test(slug) && typeof id === "string" && BIRD_ID.test(id)) birds[slug] = id
    }
  }
  // Records from before these themes carry a preset or a custom theme instead. Those looks are
  // gone, so the halves start on the stock palette and the mode and birds carry over.
  const themes = readStoredThemes(raw.themes).filter((t) => !isBuiltIn(t.id)).slice(0, 2)
  const wallpaper = readWallpaperPalette(raw.wallpaper)
  const half = (v: unknown) => (v === WALLPAPER_ID ? (wallpaper ? v : null) : isThemeId(v) && (isBuiltIn(v) || themes.some((t) => t.id === v)) ? v : null)
  const t = isObject(raw.tint) ? raw.tint : {}
  const part = (v: unknown, r: { min: number; max: number; default: number }) => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(r.max, Math.max(r.min, v))) : r.default)
  const tint = { hue: part(t.hue, TINT_RANGE.hue), saturation: part(t.saturation, TINT_RANGE.saturation), lightness: part(t.lightness, TINT_RANGE.lightness) }
  const accent = isAccent(raw.accent) ? raw.accent.toLowerCase() : null
  const light = half(raw.light)
  const dark = half(raw.dark)
  return { mode, light, dark, themes, tint, accent, wallpaper: light === WALLPAPER_ID || dark === WALLPAPER_ID ? wallpaper : null, birds, display: readDisplay(raw.display) }
}

export function formatLook(look: Look): string {
  const named = new Set([look.light, look.dark])
  return JSON.stringify({ version: 1, kind: "look", mode: look.mode, light: look.light, dark: look.dark, themes: look.themes.filter((t) => named.has(t.id)), tint: look.tint, accent: look.accent, wallpaper: look.wallpaper, birds: look.birds, display: look.display })
}

/** Finds a theme by id: a built-in, one the look carries, or one in this browser's library. */
export function findTheme(id: string | null, look: Look, library: readonly ThemeDefinition[]): ThemeDefinition | null {
  if (id === null) return null
  return BUILT_IN_THEMES.find((t) => t.id === id) ?? look.themes.find((t) => t.id === id) ?? library.find((t) => t.id === id) ?? null
}

/** The colors one half paints. A half whose theme is gone, or cannot draw that mode, falls back to stock. */
export function colorsFor(look: Look, half: ThemeAppearance, library: readonly ThemeDefinition[]): ThemeColors {
  if (look[half] === WALLPAPER_ID && look.wallpaper) return wallpaperColors(look.wallpaper, half)
  const theme = findTheme(look[half], look, library)
  return (theme && colorsForMode(theme, half)) ?? monocodeColors(look.tint, half)
}

/** Gives the theme every half it can draw. Null puts the stock palette back on both. */
export function withTheme(look: Look, theme: ThemeDefinition | null): Look {
  if (theme === null) return { ...look, light: null, dark: null, themes: [], wallpaper: null }
  const next: Look = { ...look }
  for (const mode of ["light", "dark"] as const) if (colorsForMode(theme, mode)) next[mode] = theme.id
  return carry(next, theme)
}

/** Gives one half to a theme. */
export function withHalf(look: Look, half: ThemeAppearance, theme: ThemeDefinition | null): Look {
  return carry({ ...look, [half]: theme?.id ?? null }, theme)
}

/** Keeps the imported themes the halves name, and only those. */
function carry(look: Look, added: ThemeDefinition | null): Look {
  const pool = added && !isBuiltIn(added.id) ? [added, ...look.themes.filter((t) => t.id !== added.id)] : look.themes
  return { ...look, themes: pool.filter((t) => t.id === look.light || t.id === look.dark), wallpaper: matchesWallpaper(look) ? look.wallpaper : null }
}

/** Both halves follow the wallpaper's palette. */
export const withWallpaper = (look: Look, palette: WallpaperPalette): Look => ({ ...look, light: WALLPAPER_ID, dark: WALLPAPER_ID, wallpaper: palette, themes: [] })

/** True when a half on screen follows the wallpaper. */
export const matchesWallpaper = (look: Look) => look.light === WALLPAPER_ID || look.dark === WALLPAPER_ID

/**
 * The accent a half paints with: the person's own, or, while it matches the wallpaper, the
 * picture's, so the send button and your bubbles take the picture's color too.
 */
export function accentFor(look: Look, half: ThemeAppearance): string | null {
  if (look.accent) return look.accent
  if (look[half] === WALLPAPER_ID && look.wallpaper && look.wallpaper.accent.c >= 0.03) return wallpaperAccent(look.wallpaper, half)
  return null
}
