// A person's look: the appearance mode, the accent, the avatar each agent wears, and the display
// settings. It is one JSON record, synced through the user socket's theme slot, so the server
// keeps it as opaque text. Parsing happens here, at the edge. Everything past it trusts the type.

import { CHARM_NAMES, EYE_NAMES, FLAVOUR_NAMES, LEAF_NAMES, OUTFIT_NAMES, type CharmName, type EyeName, type FlavourName, type LeafName, type OutfitName } from "@kiko/avatar"
import { DEFAULT_DISPLAY, readDisplay, type Display } from "./display"
import { DEFAULT_ACCENT, isAccentId, type AccentId, type ThemeMode } from "./palette"

export type Mode = ThemeMode
export const MODES: readonly Mode[] = ["system", "light", "dark"]

/** What a person chose for one avatar. Only the choices are stored; the rest is generated from the name. */
export type AvatarPins = {
  flavour?: FlavourName
  leaf?: LeafName
  eye?: EyeName
  charm?: CharmName | "none"
  outfit?: OutfitName | "none"
}

export type Look = {
  mode: Mode
  accent: AccentId
  /** An agent slug to what it wears. A slug without an entry gets the avatar its slug generates. */
  avatars: Readonly<Record<string, AvatarPins>>
  /** Contrast, text size, chat width, fonts (display.ts). */
  display: Display
}

export const DEFAULT_LOOK: Look = { mode: "dark", accent: DEFAULT_ACCENT, avatars: {}, display: DEFAULT_DISPLAY }

const MAX_AVATARS = 200
const SLUG = /^[a-z0-9_-]{1,40}$/

/** Version 2 chose one of Kiko's birds per agent, as `flavor.outfit`. Each one maps to the nearest avatar choice. */
const BIRD_FLAVOURS: Record<string, FlavourName> = {
  kiko: "fubuki", matcha: "matcha", sakura: "sakura", hojicha: "hojicha", ichigo: "ichigo", kinako: "kinako",
  ramune: "ramune", yuzu: "yuzu", mintchoco: "chocomint", peach: "momo", lavender: "ajisai", earlgrey: "usuzumi", sesame: "goma",
}
const BIRD_OUTFITS: Record<string, Pick<AvatarPins, "charm" | "leaf">> = {
  beret: { charm: "beret" }, phones: { charm: "headphones" }, bow: { charm: "ribbon" }, snowcap: { charm: "snowflake" },
  crown: { charm: "camellia" }, blossom: { charm: "cherries" }, momiji: { leaf: "momiji" },
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const one = <T extends string>(value: unknown, names: readonly T[]): T | undefined => names.find((name) => name === value)

function readPins(raw: unknown): AvatarPins | null {
  if (!isObject(raw)) return null
  const pins: AvatarPins = {
    flavour: one(raw.flavour, FLAVOUR_NAMES),
    leaf: one(raw.leaf, LEAF_NAMES),
    eye: one(raw.eye, EYE_NAMES),
    charm: one(raw.charm, ["none", ...CHARM_NAMES]),
    outfit: one(raw.outfit, ["none", ...OUTFIT_NAMES]),
  }
  const kept = Object.fromEntries(Object.entries(pins).filter(([, value]) => value !== undefined))
  return Object.keys(kept).length ? kept : null
}

function fromBird(id: unknown): AvatarPins | null {
  if (typeof id !== "string") return null
  const [flavour = "", outfit = ""] = id.split(".")
  const pins: AvatarPins = { ...BIRD_OUTFITS[outfit], flavour: BIRD_FLAVOURS[flavour] }
  return readPins(pins)
}

function readAvatars(raw: Record<string, unknown>, convert: boolean): Record<string, AvatarPins> {
  const avatars: Record<string, AvatarPins> = {}
  for (const [slug, value] of Object.entries(raw).slice(0, MAX_AVATARS)) {
    const pins = convert ? fromBird(value) : readPins(value)
    if (SLUG.test(slug) && pins) avatars[slug] = pins
  }
  return avatars
}

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
  const avatars = isObject(raw.avatars) ? readAvatars(raw.avatars, false) : isObject(raw.birds) ? readAvatars(raw.birds, true) : {}
  return {
    mode: MODES.includes(raw.mode as Mode) ? (raw.mode as Mode) : DEFAULT_LOOK.mode,
    accent: isAccentId(raw.accent) ? raw.accent : DEFAULT_ACCENT,
    avatars,
    display: readDisplay(raw.display),
  }
}

export function formatLook(look: Look): string {
  return JSON.stringify({ version: 3, kind: "look", mode: look.mode, accent: look.accent, avatars: look.avatars, display: look.display })
}
