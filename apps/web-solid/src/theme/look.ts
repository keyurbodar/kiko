// A person's look: the appearance they picked, the theme, and the bird each agent wears.
// It is one JSON record, synced through the user socket's theme slot, so the server keeps
// it as opaque text. Parsing happens here, at the edge. Everything past it trusts the type.

import { DEFAULT_PRESET, PRESETS } from "./presets"
import { parseTheme, type Theme } from "./schema"

export type Mode = "system" | "light" | "dark"
export const MODES: readonly Mode[] = ["system", "light", "dark"]

export type ThemeChoice = { preset: string } | { custom: Theme }

export type Look = {
  mode: Mode
  theme: ThemeChoice
  /** An agent slug to the bird it wears. A slug without an entry gets the bird its slug seeds. */
  birds: Readonly<Record<string, string>>
}

export const DEFAULT_LOOK: Look = { mode: "system", theme: { preset: DEFAULT_PRESET }, birds: {} }

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
  return { mode, theme, birds }
}

export function formatLook(look: Look): string {
  const theme = "preset" in look.theme ? { preset: look.theme.preset } : { custom: look.theme.custom }
  return JSON.stringify({ version: 1, kind: "look", mode: look.mode, ...theme, birds: look.birds })
}

export const presetOf = (look: Look): string | null => ("preset" in look.theme ? look.theme.preset : null)
