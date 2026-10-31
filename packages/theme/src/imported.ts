import { PALETTE_KEYS, PALETTES, SYNTAX_KEYS, type Palette, type Syntax, type ThemeAppearance } from "./palette"

export type ImportedTheme = {
  id: string
  name: string
  source: string
  appearance: ThemeAppearance
  palette: Palette
  syntax?: Syntax
}

export type Imported = {
  themes: ImportedTheme[]
  active: Partial<Record<ThemeAppearance, string>>
}

export const IMPORTED_KEY = "kiko:imported-themes"
export const MAX_IMPORTED = 50
const HEX = /^#[0-9a-f]{6}$/i
const ID = /^[\w:./-]{1,160}$/
const ID_UNSAFE = /[^\w:./-]+/g
const ID_EDGE = /^[-.:/]+|[-.:/]+$/g
const APPEARANCES: readonly ThemeAppearance[] = ["light", "dark"]

export const EMPTY_IMPORTED: Imported = { themes: [], active: {} }

export function themeId(value: string): string {
  const cleaned = value.replace(ID_UNSAFE, "-").slice(0, 160).replace(ID_EDGE, "")
  return cleaned.length > 0 ? cleaned : "theme"
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

const LEGACY_KEYS = ["canvas", "sidebar", "text", "danger", "gold"] as const

function legacyPalette(raw: Record<string, unknown>, accent: unknown, appearance: ThemeAppearance): Palette | null {
  const old: Partial<Record<(typeof LEGACY_KEYS)[number], string>> = {}
  for (const key of LEGACY_KEYS) {
    const value = raw[key]
    if (typeof value !== "string" || !HEX.test(value)) return null
    old[key] = value
  }
  if (typeof accent !== "string" || !HEX.test(accent)) return null
  const fallback = PALETTES[appearance]
  return {
    ...fallback,
    chrome: old.canvas!,
    sidebar: old.sidebar!,
    editor: old.canvas!,
    base: old.text!,
    accent,
    focus: accent,
    warn: old.gold!,
    danger: old.danger!,
  }
}

function readPalette(raw: Record<string, unknown>, accent: unknown, appearance: ThemeAppearance): Palette | null {
  if ("canvas" in raw) return legacyPalette(raw, accent, appearance)
  const palette: Partial<Record<keyof Palette, string>> = {}
  for (const key of PALETTE_KEYS) {
    const value = raw[key]
    if (typeof value !== "string" || !HEX.test(value)) return null
    palette[key] = value
  }
  return palette as Palette
}

function readTheme(raw: unknown): ImportedTheme | null {
  if (!isObject(raw) || !isObject(raw.palette)) return null
  const { id, name, source, appearance } = raw
  if (typeof id !== "string" || !ID.test(id)) return null
  if (typeof name !== "string" || name.length === 0 || name.length > 48) return null
  if (typeof source !== "string" || source.length > 160) return null
  if (!APPEARANCES.includes(appearance as ThemeAppearance)) return null
  const palette = readPalette(raw.palette, raw.accent, appearance as ThemeAppearance)
  if (!palette) return null
  const theme: ImportedTheme = { id, name, source, appearance: appearance as ThemeAppearance, palette }
  const syntax = readSyntax(raw.syntax)
  return syntax ? { ...theme, syntax } : theme
}

function readSyntax(raw: unknown): Syntax | null {
  if (!isObject(raw)) return null
  const syntax: Partial<Syntax> = {}
  for (const key of SYNTAX_KEYS) {
    const value = raw[key]
    if (typeof value !== "string" || !HEX.test(value)) return null
    syntax[key] = value
  }
  return syntax as Syntax
}

export function parseImported(text: string | null): Imported {
  if (!text) return EMPTY_IMPORTED
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return EMPTY_IMPORTED
  }
  return readImported(raw)
}

export function readImported(raw: unknown): Imported {
  if (!isObject(raw) || raw.v !== 1 || !Array.isArray(raw.themes)) return EMPTY_IMPORTED
  const themes = uniqueThemes(raw.themes)
  const active: Imported["active"] = {}
  if (isObject(raw.active)) {
    for (const appearance of APPEARANCES) {
      const id = raw.active[appearance]
      if (themes.some((theme) => theme.id === id && theme.appearance === appearance)) active[appearance] = id as string
    }
  }
  return { themes, active }
}

function uniqueThemes(raw: unknown[]): ImportedTheme[] {
  const seen = new Set<string>()
  const themes: ImportedTheme[] = []
  for (const value of raw) {
    if (themes.length >= MAX_IMPORTED) break
    const theme = readTheme(value)
    if (!theme || seen.has(theme.id)) continue
    seen.add(theme.id)
    themes.push(theme)
  }
  return themes
}

export function formatImported(state: Imported): string {
  return JSON.stringify({ v: 1, themes: state.themes, active: state.active })
}

export const themeFor = (state: Imported, appearance: ThemeAppearance): ImportedTheme | undefined =>
  state.themes.find((theme) => theme.id === state.active[appearance])
