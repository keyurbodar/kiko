// A person's look: the appearance mode, the accent, the bird each agent wears, and the display
// settings. It is one JSON record, synced through the user socket's theme slot, so the server
// keeps it as opaque text. Parsing happens here, at the edge. Everything past it trusts the type.

import { DEFAULT_DISPLAY, readDisplay, type Display } from "./display"
import { DEFAULT_ACCENT, isAccentId, type AccentId, type ThemeMode } from "./palette"

export type Mode = ThemeMode
export const MODES: readonly Mode[] = ["system", "light", "dark"]

export type Look = {
  mode: Mode
  accent: AccentId
  /** An agent slug to the bird it wears. A slug without an entry gets the bird its slug seeds. */
  birds: Readonly<Record<string, string>>
  /** Contrast, text size, chat width, fonts (display.ts). */
  display: Display
}

export const DEFAULT_LOOK: Look = { mode: "dark", accent: DEFAULT_ACCENT, birds: {}, display: DEFAULT_DISPLAY }

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
  if (!isObject(raw) || raw.kind !== "look") return DEFAULT_LOOK
  const birds: Record<string, string> = {}
  if (isObject(raw.birds)) {
    for (const [slug, id] of Object.entries(raw.birds).slice(0, MAX_BIRDS)) {
      if (SLUG.test(slug) && typeof id === "string" && BIRD_ID.test(id)) birds[slug] = id
    }
  }
  return {
    mode: MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : DEFAULT_LOOK.mode,
    accent: isAccentId(raw.accent) ? raw.accent : DEFAULT_ACCENT,
    birds,
    display: readDisplay(raw.display),
  }
}

export function formatLook(look: Look): string {
  return JSON.stringify({ version: 2, kind: "look", mode: look.mode, accent: look.accent, birds: look.birds, display: look.display })
}
