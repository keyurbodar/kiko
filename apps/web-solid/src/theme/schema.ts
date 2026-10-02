// The theme format, version 1, and the hand-written validator. User theming
// architecture: a theme is JSON. Every key maps to one CSS variable from
// `packages/ui/src/styles/tokens.md`. A missing key inherits from `extends`. There is no raw
// CSS field and no motion key. A theme with an error is never applied.
//
// No Effect, no DOM beyond `CSS.supports` when it exists. `docs/theming.md` is generated
// from `FIELDS` below by `apps/web-solid/scripts/gen-theme.ts`.

import { KNOWN_TOKENS } from "./known-tokens"

export const THEME_VERSION = 1
/** The same limit the server keeps. */
export const MAX_THEME_CHARS = 32 * 1024

export const PRESET_IDS = ["kat-dark", "kat-light", "ink", "paper"] as const
export type Appearance = "dark" | "light"
export type Group = "colors" | "radius" | "spacing" | "type" | "size"
export const GROUPS: readonly Group[] = ["colors", "radius", "spacing", "type", "size"]

export type Kind = "color" | "length" | "number" | "font" | "weight"

export type Field = {
  group: Group
  key: string
  variable: string
  kind: Kind
  min?: number
  max?: number
  /** Only for a length that a `scale` multiplies. A test keeps it equal to `kat.css`. */
  default?: string
  /** Which `scale` moves this length. */
  scaled?: "radius" | "spacing"
  note?: string
}

function color(key: string, variable: string, note?: string): Field {
  return { group: "colors", key, variable, kind: "color", note }
}
function num(group: Group, key: string, variable: string, min: number, max: number, note?: string, def?: string): Field {
  return { group, key, variable, kind: "number", min, max, note, default: def }
}
function len(group: Group, key: string, variable: string, min: number, max: number, def: string, scaled?: "radius" | "spacing", note?: string): Field {
  return { group, key, variable, kind: "length", min, max, default: def, scaled, note }
}

export const FIELDS: readonly Field[] = [
  // colors. These are the final roles, so a value replaces the whole derived color.
  color("bg", "--bg", "the chat panel"),
  color("sidebar", "--bg-sidebar", "the rail and the sidebar, darker than the panel"),
  color("subtle", "--bg-subtle"),
  color("raised", "--surface-raised"),
  color("menu", "--menu-bg"),
  color("input", "--input-bg"),
  color("hover", "--hover-bg"),
  color("selected", "--selected-bg"),
  color("navActive", "--nav-active-bg"),
  color("navHover", "--nav-hover-bg"),
  color("tooltip", "--tooltip-bg"),
  color("tint", "--tint"),
  color("tintSubtle", "--tint-subtle"),
  color("tintStrong", "--tint-strong"),
  color("scrollbar", "--scrollbar-thumb"),
  color("scrollbarHover", "--scrollbar-thumb-hover"),
  color("text", "--text"),
  color("textMuted", "--text-muted"),
  color("textFaint", "--text-faint"),
  color("accent", "--accent", "marks, links, the reply bar"),
  color("accentFill", "--accent-fill", "filled buttons"),
  color("accentHover", "--accent-hover"),
  color("onAccent", "--on-accent", "text on a filled accent"),
  color("assistantBubble", "--assistant-bubble"),
  color("assistantBubbleText", "--assistant-bubble-text"),
  color("userBubble", "--user-bubble"),
  color("userBubbleDeep", "--user-bubble-deep", "the far end of the user bubble gradient"),
  color("userBubbleText", "--user-bubble-text"),
  color("danger", "--danger", "status"),
  color("success", "--success", "status"),
  color("gold", "--gold", "status and the approval card"),
  color("hairline", "--hairline"),
  color("button", "--btn-bg"),
  color("buttonHover", "--btn-bg-hover"),
  color("panelEdge", "--panel-edge"),
  color("scrim", "--scrim", "the dim behind a viewer"),
  color("accentWash", "--accent-wash"),
  color("accentWashStrong", "--accent-wash-strong"),
  color("accentWashFaint", "--accent-wash-faint"),
  color("textWash", "--text-wash"),
  color("dangerWash", "--danger-wash"),
  num("colors", "hue", "--hue", 0, 360, "the hue of every neutral and the accent"),
  num("colors", "userHue", "--h-orange-user", 0, 360, "the hue of the user bubble"),
  num("colors", "chroma", "--cm", 0, 4, "the one chroma multiplier. every derived color passes through it"),

  // radius. `scale` multiplies every length here except `field`, which stays a pill.
  len("radius", "bubble", "--radius-bubble", 0, 999, "18px", "radius", "message bubbles"),
  len("radius", "bubbleTight", "--radius-bubble-tight", 0, 999, "8px", "radius", "the corners where bubbles stack"),
  len("radius", "small", "--radius-sm", 0, 999, "8px", "radius", "menus, buttons, chips"),
  len("radius", "row", "--radius-row", 0, 999, "20px", "radius", "chat rows and tiles"),
  len("radius", "field", "--radius-field", 0, 9999, "999px", undefined, "inputs. a pill by default"),
  num("radius", "scale", "--radius-scale", 0, 4, "multiplies the radius lengths. 1 changes nothing", "1"),

  // spacing
  len("spacing", "bubblePadX", "--bubble-pad-x", 0, 48, "12px", "spacing", "bubble padding, sides"),
  len("spacing", "bubblePadY", "--bubble-pad-y", 0, 48, "7px", "spacing", "bubble padding, top and bottom"),
  len("spacing", "rowGap", "--row-gap", 0, 32, "1px", "spacing", "between messages in one run"),
  len("spacing", "runGap", "--run-gap", 0, 64, "8px", "spacing", "before a new run"),
  len("spacing", "boardColumnGap", "--board-column-gap", 0, 64, "12px", "spacing"),
  len("spacing", "boardCardGap", "--board-card-gap", 0, 64, "8px", "spacing"),
  len("spacing", "treeIndent", "--tree-indent", 4, 48, "16px", "spacing", "the file tree"),
  num("spacing", "scale", "--spacing-scale", 0, 3, "multiplies the spacing lengths. 1 changes nothing", "1"),

  // type
  { group: "type", key: "sans", variable: "--font-family-sans", kind: "font", note: "the interface font" },
  { group: "type", key: "mono", variable: "--font-family-mono", kind: "font", note: "code" },
  len("type", "tinySize", "--font-xs", 8, 24, "11px"),
  len("type", "smallSize", "--font-sm", 8, 24, "12px"),
  len("type", "mediumSize", "--font-md", 8, 28, "13px"),
  len("type", "baseSize", "--font-base", 10, 28, "14px", undefined, "message text and the composer"),
  num("type", "lineHeight", "--line-height", 1, 3, "unitless"),
  num("type", "codeLineHeight", "--line-height-code", 1, 3, "unitless"),
  { group: "type", key: "weightRegular", variable: "--font-weight-regular", kind: "weight", min: 100, max: 900 },
  { group: "type", key: "weightMedium", variable: "--font-weight-medium", kind: "weight", min: 100, max: 900 },
  { group: "type", key: "weightBold", variable: "--font-weight-bold", kind: "weight", min: 100, max: 900 },

  // size
  len("size", "railWidth", "--sidebar-nav-w", 40, 120, "60px"),
  len("size", "sidebarWidth", "--sidebar-content-w", 180, 520, "280px", undefined, "the default. dragging the sidebar still wins"),
  len("size", "contentMaxWidth", "--content-max-w", 480, 1400, "768px", undefined, "the chat column"),
  len("size", "topBarHeight", "--topbar-h", 36, 80, "50px"),
  len("size", "tabHeight", "--tab-h", 20, 48, "28px"),
  len("size", "treeRowHeight", "--tree-row-h", 20, 48, "30px"),
  len("size", "railTab", "--rail-tab", 28, 64, "44px"),
  len("size", "railIcon", "--rail-icon", 14, 32, "22px"),
  len("size", "pinCircle", "--pin-circle", 32, 72, "48px"),
  len("size", "pinAvatar", "--pin-avatar", 16, 48, "26px"),
  len("size", "rowAvatar", "--row-avatar", 20, 48, "28px"),
  len("size", "rowAvatarImage", "--row-avatar-img", 14, 40, "22px"),
]

// `--radius-scale` and `--spacing-scale` are not CSS variables. They are format keys that
// multiply the lengths at apply time, so the page never sees them.
const PSEUDO = new Set(["--radius-scale", "--spacing-scale"])

const FIELD_AT = new Map(FIELDS.map((f) => [`${f.group}.${f.key}`, f]))
const KEYS: Record<Group, Map<string, Field>> = { colors: new Map(), radius: new Map(), spacing: new Map(), type: new Map(), size: new Map() }
for (const f of FIELDS) KEYS[f.group].set(f.key, f)

// --- values -------------------------------------------------------------------------

// Anything that could leave a value: a statement end, a block, a comment, a URL, a
// variable reference (a cycle would blank the role), an escape.
const FORBIDDEN = /[;{}<>\\@\u0000-\u001f]|\/\*|\*\/|url\(|image\(|image-set\(|expression\(|javascript:|!important|var\(|env\(|attr\(/i
const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer)$/i
// Used only where `CSS.supports` does not exist, such as under `bun test`.
const NAMED = /^(transparent|black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta|brown|gold|silver|navy|teal|olive|lime|maroon|aqua|fuchsia|coral|salmon|tomato|crimson|indigo|violet|khaki|ivory|beige|tan|plum)$/i
const FUNCTIONAL = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\((?:[^()]|\([^()]*\))*\)$/i
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function balanced(v: string): boolean {
  let depth = 0
  for (const c of v) {
    if (c === "(") depth++
    else if (c === ")" && --depth < 0) return false
  }
  return depth === 0 && (v.match(/"/g)?.length ?? 0) % 2 === 0 && (v.match(/'/g)?.length ?? 0) % 2 === 0
}

function isSafe(v: string, max = 400): boolean {
  return v.length > 0 && v.length <= max && !FORBIDDEN.test(v) && balanced(v)
}

function supports(property: string, value: string): boolean | null {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return null
  return CSS.supports(property, value)
}

export function isColor(v: string): boolean {
  const t = v.trim()
  if (!isSafe(t) || CSS_WIDE.test(t)) return false
  return supports("color", t) ?? (HEX.test(t) || NAMED.test(t) || FUNCTIONAL.test(t))
}

const LENGTH = /^(-?\d*\.?\d+)(px|rem|em)$/i

/** What a value looks like in the error message. */
function show(v: unknown): string {
  const s = typeof v === "string" ? JSON.stringify(v) : (JSON.stringify(v) ?? String(v))
  return s.length > 40 ? `${s.slice(0, 37)}...` : s
}

type Checked = { value: string | number; note?: string } | { error: string }

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

const trimNumber = (n: number) => String(Math.round(n * 1000) / 1000)

function checkLength(raw: unknown, min: number, max: number, path: string): Checked {
  let n: number
  let unit = "px"
  if (typeof raw === "number" && Number.isFinite(raw)) n = raw
  else if (typeof raw === "string" && raw.trim() === "0") n = 0
  else if (typeof raw === "string" && LENGTH.test(raw.trim())) {
    const m = LENGTH.exec(raw.trim())!
    n = Number(m[1])
    unit = m[2]!.toLowerCase()
  } else return { error: `${path}: expected a length, got ${show(raw)}` }
  const px = unit === "px" ? n : n * 16
  if (px < min || px > max) {
    const to = clamp(px, min, max)
    return { value: `${trimNumber(to)}px`, note: `${path}: clamped to ${trimNumber(to)}px` }
  }
  return { value: `${trimNumber(n)}${unit}` }
}

function checkNumber(raw: unknown, min: number, max: number, path: string, integer = false): Checked {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return { error: `${path}: expected a number, got ${show(raw)}` }
  const to = clamp(integer ? Math.round(raw) : raw, min, max)
  return to === raw ? { value: to } : { value: to, note: `${path}: clamped to ${trimNumber(to)}` }
}

function checkField(f: Field, raw: unknown, path: string): Checked {
  switch (f.kind) {
    case "color":
      return typeof raw === "string" && isColor(raw) ? { value: raw.trim() } : { error: `${path}: expected a color, got ${show(raw)}` }
    case "length":
      return checkLength(raw, f.min ?? 0, f.max ?? 4096, path)
    case "number":
      return checkNumber(raw, f.min ?? 0, f.max ?? 1000, path)
    case "weight":
      return checkNumber(raw, f.min ?? 100, f.max ?? 900, path, true)
    case "font": {
      const ok = typeof raw === "string" && isSafe(raw.trim(), 200) && (supports("font-family", raw.trim()) ?? true)
      return ok ? { value: (raw as string).trim() } : { error: `${path}: expected a font family list, got ${show(raw)}` }
    }
  }
}

/** Checks a value for a `tokens` entry by the kind the generated table records for it. */
function checkToken(name: string, raw: unknown, path: string): Checked {
  const kind = KNOWN_TOKENS[name]
  if (kind === undefined) return { error: `${path}: unknown token, expected one of the variables in tokens.md` }
  if (kind === "any") {
    return typeof raw === "string" && isSafe(raw.trim()) ? { value: raw.trim() } : { error: `${path}: expected a CSS value, got ${show(raw)}` }
  }
  let range: [number, number] = [-1000, 1000]
  if (/^--(light-)?l-/.test(name)) range = [0, 1]
  else if (/^--(light-)?c-/.test(name)) range = [0, 0.5]
  else if (/^--h-|^--hue$/.test(name)) range = [0, 360]
  else if (name === "--cm") range = [0, 4]
  else if (kind === "length") range = [0, 4096]
  else if (kind === "weight") range = [100, 900]
  return checkField({ group: "colors", key: name, variable: name, kind, min: range[0], max: range[1] }, raw, path)
}

// --- the format ---------------------------------------------------------------------

export type Values = Record<string, string | number>
export type Layer = {
  colors?: Values
  radius?: Values
  spacing?: Values
  type?: Values
  size?: Values
  tokens?: Record<string, string | number>
}
export type Theme = Layer & {
  version: 1
  name: string
  extends?: string
  appearance?: Appearance
  variants?: { light?: Layer }
}

export type ParseResult = { ok: true; theme: Theme; notes: string[] } | { ok: false; errors: string[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function parseLayer(raw: Record<string, unknown>, prefix: string, errors: string[], notes: string[], allowed: readonly string[]): Layer {
  const layer: Layer = {}
  for (const [key, value] of Object.entries(raw)) {
    const path = prefix + key
    if (!allowed.includes(key)) {
      errors.push(`${path}: unknown key`)
      continue
    }
    if (!isObject(value)) {
      errors.push(`${path}: expected an object, got ${show(value)}`)
      continue
    }
    if (key === "tokens") {
      const out: Record<string, string | number> = {}
      for (const [name, v] of Object.entries(value)) {
        const r = checkToken(name, v, `${path}.${name}`)
        if ("error" in r) errors.push(r.error)
        else {
          out[name] = r.value
          if (r.note) notes.push(r.note)
        }
      }
      layer.tokens = out
      continue
    }
    const group = key as Group
    const out: Values = {}
    for (const [k, v] of Object.entries(value)) {
      const field = KEYS[group].get(k)
      if (!field) {
        errors.push(`${path}.${k}: unknown key`)
        continue
      }
      const r = checkField(field, v, `${path}.${k}`)
      if ("error" in r) errors.push(r.error)
      else {
        out[k] = r.value
        if (r.note) notes.push(r.note)
      }
    }
    layer[group] = out
  }
  return layer
}

const LAYER_KEYS = [...GROUPS, "tokens"] as const
const TOP_KEYS = ["version", "name", "extends", "appearance", "variants", ...LAYER_KEYS] as const

/**
 * Validates a theme. Takes JSON text or a parsed value. Every problem is one string that
 * starts with the key path, for example `radius.bubble: expected a length, got "big"`.
 * A result with errors has no theme, so nothing can apply it.
 */
export function parseTheme(input: unknown, presetIds: readonly string[] = PRESET_IDS): ParseResult {
  let raw = input
  if (typeof input === "string") {
    if (input.length > MAX_THEME_CHARS) return { ok: false, errors: [`json: the theme is larger than ${MAX_THEME_CHARS / 1024} KB`] }
    try {
      raw = JSON.parse(input)
    } catch (e) {
      return { ok: false, errors: [`json: ${e instanceof Error ? e.message.toLowerCase() : "not valid json"}`] }
    }
  }
  if (!isObject(raw)) return { ok: false, errors: [`json: expected an object, got ${show(raw)}`] }

  const errors: string[] = []
  const notes: string[] = []
  const theme = {} as Theme

  for (const key of Object.keys(raw)) if (!(TOP_KEYS as readonly string[]).includes(key)) errors.push(`${key}: unknown key`)

  if (raw.version !== THEME_VERSION) errors.push(`version: expected ${THEME_VERSION}, got ${show(raw.version)}`)
  else theme.version = THEME_VERSION

  if (typeof raw.name !== "string" || raw.name.trim().length < 1 || raw.name.trim().length > 48) {
    errors.push(`name: expected 1 to 48 characters, got ${show(raw.name)}`)
  } else theme.name = raw.name.trim()

  if (raw.extends !== undefined) {
    if (typeof raw.extends === "string" && presetIds.includes(raw.extends)) theme.extends = raw.extends
    else errors.push(`extends: expected one of ${presetIds.join(", ")}, got ${show(raw.extends)}`)
  }
  if (raw.appearance !== undefined) {
    if (raw.appearance === "dark" || raw.appearance === "light") theme.appearance = raw.appearance
    else errors.push(`appearance: expected "dark" or "light", got ${show(raw.appearance)}`)
  }

  const { variants, ...rest } = raw
  Object.assign(theme, parseLayer(Object.fromEntries(Object.entries(rest).filter(([k]) => (LAYER_KEYS as readonly string[]).includes(k))), "", errors, notes, LAYER_KEYS))

  if (variants !== undefined) {
    if (!isObject(variants)) errors.push(`variants: expected an object, got ${show(variants)}`)
    else {
      for (const key of Object.keys(variants)) if (key !== "light") errors.push(`variants.${key}: unknown key, only "light" is allowed`)
      if (variants.light !== undefined) {
        if (!isObject(variants.light)) errors.push(`variants.light: expected an object, got ${show(variants.light)}`)
        else theme.variants = { light: parseLayer(variants.light, "variants.light.", errors, notes, LAYER_KEYS) }
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, theme, notes }
}

// --- resolving ----------------------------------------------------------------------

export type Vars = Record<string, string>
export type Resolved = { appearance: Appearance; vars: Vars }
export type ResolvedTheme = { base: Resolved; light?: Resolved }
export type ResolveResult = { ok: true; resolved: ResolvedTheme } | { ok: false; error: string }

function mergeInto(target: Layer, layer: Layer): void {
  for (const key of LAYER_KEYS) {
    const from = layer[key]
    if (from) target[key] = { ...target[key], ...from }
  }
}

function compile(layer: Layer): Vars {
  const vars: Vars = {}
  const scales = { radius: Number(layer.radius?.scale ?? 1), spacing: Number(layer.spacing?.scale ?? 1) }
  for (const f of FIELDS) {
    if (PSEUDO.has(f.variable)) continue
    const set = layer[f.group]?.[f.key]
    const scale = f.scaled ? scales[f.scaled] : 1
    if (set === undefined && scale === 1) continue
    let value: string = set === undefined ? f.default! : String(set)
    if (scale !== 1) {
      const m = LENGTH.exec(value)
      if (m) value = `${trimNumber(clamp(Number(m[1]) * scale, 0, f.max ?? 4096))}${m[2]}`
    }
    vars[f.variable] = value
  }
  for (const [name, v] of Object.entries(layer.tokens ?? {})) vars[name] = String(v)
  return vars
}

const MAX_DEPTH = 6

/**
 * Turns a theme and its `extends` chain into the CSS variables to set. Only variables the
 * theme changes appear. A theme with a `variants.light` also resolves a second set for
 * people whose system prefers light.
 */
export function resolveTheme(theme: Theme, getPreset: (id: string) => Theme | undefined): ResolveResult {
  const chain: Theme[] = []
  let cur: Theme | undefined = theme
  while (cur) {
    chain.unshift(cur)
    if (chain.length > MAX_DEPTH) return { ok: false, error: "extends: the chain is too long" }
    if (cur.extends === undefined) break
    const next = getPreset(cur.extends)
    if (!next) return { ok: false, error: `extends: unknown theme ${show(cur.extends)}` }
    cur = next
  }
  if (cur === theme && theme.extends === undefined) {
    const base = getPreset("kat-dark")
    if (base) chain.unshift(base)
  }
  const merged: Layer = {}
  let appearance: Appearance = "dark"
  for (const t of chain) {
    mergeInto(merged, t)
    if (t.appearance) appearance = t.appearance
  }
  const lights = chain.map((t) => t.variants?.light).filter((l): l is Layer => l !== undefined)
  const base: Resolved = { appearance, vars: compile(merged) }
  if (!lights.length) return { ok: true, resolved: { base } }
  const lightLayer: Layer = {}
  mergeInto(lightLayer, merged)
  for (const l of lights) mergeInto(lightLayer, l)
  return { ok: true, resolved: { base, light: { appearance: "light", vars: compile(lightLayer) } } }
}

/** The text a person edits: two-space JSON. */
export function formatTheme(theme: Theme): string {
  return JSON.stringify(theme, null, 2)
}

export function fieldFor(path: string): Field | undefined {
  return FIELD_AT.get(path)
}
