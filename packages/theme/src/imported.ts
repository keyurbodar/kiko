// The VS Code themes a person imported from Open VSX, kept in this browser under their own key so
// the look record (`look.ts`) and the server's theme slot stay as they are. Each appearance can
// use one imported theme. Parsing happens here, at the edge, like `look.ts`.

import { PALETTE_KEYS, type Palette, type ThemeAppearance } from "./palette"

export type ImportedTheme = {
  id: string
  name: string
  /** Where the theme came from, shown under its name, for example `dracula-theme.dracula`. */
  source: string
  appearance: ThemeAppearance
  accent: string
  palette: Palette
}

export type Imported = {
  themes: ImportedTheme[]
  active: Partial<Record<ThemeAppearance, string>>
}

export const IMPORTED_KEY = "kiko:imported-themes"
export const MAX_IMPORTED = 50
const HEX = /^#[0-9a-f]{6}$/i
const ID = /^[\w:./-]{1,160}$/
const APPEARANCES: readonly ThemeAppearance[] = ["light", "dark"]

export const EMPTY_IMPORTED: Imported = { themes: [], active: {} }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function readTheme(raw: unknown): ImportedTheme | null {
  if (!isObject(raw) || !isObject(raw.palette)) return null
  const { id, name, source, appearance, accent } = raw
  if (typeof id !== "string" || !ID.test(id)) return null
  if (typeof name !== "string" || name.length === 0 || name.length > 48) return null
  if (typeof source !== "string" || source.length > 160) return null
  if (!APPEARANCES.includes(appearance as ThemeAppearance)) return null
  if (typeof accent !== "string" || !HEX.test(accent)) return null
  const palette: Partial<Record<keyof Palette, string>> = {}
  for (const key of PALETTE_KEYS) {
    const value = raw.palette[key]
    if (typeof value !== "string" || !HEX.test(value)) return null
    palette[key] = value
  }
  return { id, name, source, appearance: appearance as ThemeAppearance, accent, palette: palette as Palette }
}

/** Reads stored text. Anything it cannot read is no imported themes, never an error. */
export function parseImported(text: string | null): Imported {
  if (!text) return EMPTY_IMPORTED
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return EMPTY_IMPORTED
  }
  if (!isObject(raw) || raw.v !== 1 || !Array.isArray(raw.themes)) return EMPTY_IMPORTED
  const themes = raw.themes.slice(0, MAX_IMPORTED).map(readTheme).filter((theme): theme is ImportedTheme => theme !== null)
  const active: Imported["active"] = {}
  if (isObject(raw.active)) {
    for (const appearance of APPEARANCES) {
      const id = raw.active[appearance]
      if (themes.some((theme) => theme.id === id && theme.appearance === appearance)) active[appearance] = id as string
    }
  }
  return { themes, active }
}

export function formatImported(state: Imported): string {
  return JSON.stringify({ v: 1, themes: state.themes, active: state.active })
}

export const themeFor = (state: Imported, appearance: ThemeAppearance): ImportedTheme | undefined =>
  state.themes.find((theme) => theme.id === state.active[appearance])
