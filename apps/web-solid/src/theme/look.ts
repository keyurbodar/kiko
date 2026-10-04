// A person's look: the appearance they picked, the theme, and the bird each agent wears.
// It is one JSON record, synced through the user socket's theme slot, so the server keeps
// it as opaque text. Parsing happens here, at the edge. Everything past it trusts the type.

import { DEFAULT_PRESET, PRESETS } from "./presets"
import { parseTheme, type Theme } from "./schema"

export type Mode = "system" | "light" | "dark"
export const MODES: readonly Mode[] = ["system", "light", "dark"]

export type ThemeChoice = { preset: string } | { custom: Theme }

/** Frost is translucent panels over a still scene. Solid is flat panels. */
export type Material = "frost" | "solid"
export const MATERIALS: readonly Material[] = ["frost", "solid"]

/** How much the theme's hue tints the greys, from 0 (pure grey) to 1. */
export const DEFAULT_TINT = 0.5
const clampTint = (n: number) => Math.min(1, Math.max(0, Math.round(n * 100) / 100))

export type Look = {
  mode: Mode
  material: Material
  tint: number
  theme: ThemeChoice
  /** An agent slug to the bird it wears. A slug without an entry gets the bird its slug seeds. */
  birds: Readonly<Record<string, string>>
}

export const DEFAULT_LOOK: Look = { mode: "system", material: "frost", tint: DEFAULT_TINT, theme: { preset: DEFAULT_PRESET }, birds: {} }

const MAX_BIRDS = 200
const BIRD_ID = /^[a-z0-9.-]{1,48}$/
const SLUG = /^[a-z0-9_-]{1,40}$/

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Reads stored text. Anything it cannot read falls back to the default look, never an error. */
export function parseLook(text: string | null): Look {
  if (!text) return DEFAULT_LOOK
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return DEFAULT_LOOK
  }
  if (!isObject(raw)) return DEFAULT_LOOK
  // Older records are a bare theme. They become a custom theme on the system appearance.
  if (raw.kind !== "look") {
    const t = parseTheme(raw)
    return t.ok ? { ...DEFAULT_LOOK, theme: { custom: t.theme } } : DEFAULT_LOOK
  }
  const mode = MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : "system"
  const material = MATERIALS.includes(raw.material as Material) ? (raw.material as Material) : DEFAULT_LOOK.material
  const tint = typeof raw.tint === "number" && Number.isFinite(raw.tint) ? clampTint(raw.tint) : DEFAULT_TINT
  let theme: ThemeChoice = DEFAULT_LOOK.theme
  if (typeof raw.preset === "string" && PRESETS[raw.preset]) theme = { preset: raw.preset }
  else if (raw.custom !== undefined) {
    const t = parseTheme(raw.custom)
    if (t.ok) theme = { custom: t.theme }
  }
  const birds: Record<string, string> = {}
  if (isObject(raw.birds)) {
    for (const [slug, id] of Object.entries(raw.birds).slice(0, MAX_BIRDS)) {
      if (SLUG.test(slug) && typeof id === "string" && BIRD_ID.test(id)) birds[slug] = id
    }
  }
  return { mode, material, tint, theme, birds }
}

export function formatLook(look: Look): string {
  const theme = "preset" in look.theme ? { preset: look.theme.preset } : { custom: look.theme.custom }
  return JSON.stringify({ version: 1, kind: "look", mode: look.mode, material: look.material, tint: look.tint, ...theme, birds: look.birds })
}

export const presetOf = (look: Look): string | null => ("preset" in look.theme ? look.theme.preset : null)

/*
 * The three looks the picker offers. Graphite and porcelain are the solid material fixed to one
 * appearance. Frost keeps whatever appearance the person picked.
 */
export type Style = "frost" | "graphite" | "porcelain"
export const STYLES: readonly Style[] = ["frost", "graphite", "porcelain"]

export function styleOf(look: Look, appearance: "dark" | "light"): Style {
  if (look.material === "frost") return "frost"
  return appearance === "light" ? "porcelain" : "graphite"
}

export function withStyle(look: Look, style: Style): Look {
  if (style === "frost") return { ...look, material: "frost" }
  return { ...look, material: "solid", mode: style === "porcelain" ? "light" : "dark" }
}
