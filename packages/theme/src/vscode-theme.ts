import { formatHex, interpolate, parse, rgb, wcagContrast, wcagLuminance } from "culori"
import { themeId, type ImportedTheme } from "./imported"
import { PALETTES, type Palette, type Syntax, type ThemeAppearance } from "./palette"

export type VsCodeTheme = {
  type?: unknown
  include?: unknown
  colors?: Record<string, unknown>
  tokenColors?: unknown
  [key: string]: unknown
}

const MAX_COLOR_LENGTH = 128
const MAX_INCLUDE_DEPTH = 8
const TEXT_CONTRAST = 4.5
const SHAPE_CONTRAST = 3

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const clamp = (n: number) => Math.min(1, Math.max(0, n))

function colorOf(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_COLOR_LENGTH) return null
  const color = parse(value.trim())
  return color ? rgb(color) : null
}

function opaque(value: unknown): string | null {
  const top = colorOf(value)
  if (!top || (top.alpha ?? 1) === 0) return null
  return formatHex({ mode: "rgb", r: top.r, g: top.g, b: top.b })
}

function flatten(value: unknown, base: string): string | null {
  const top = colorOf(value)
  const under = colorOf(base)
  if (!top || !under) return null
  const a = top.alpha ?? 1
  const mixed = (t: number | undefined, u: number | undefined) => clamp((t ?? 0) * a + (u ?? 0) * (1 - a))
  return formatHex({ mode: "rgb", r: mixed(top.r, under.r), g: mixed(top.g, under.g), b: mixed(top.b, under.b) })
}

const mix = (from: string, to: string, share: number) => formatHex(interpolate([from, to], "rgb")(share))
const readableOn = (surface: string, preferred: string) =>
  wcagContrast(preferred, surface) >= TEXT_CONTRAST
    ? preferred
    : wcagContrast("#000000", surface) >= wcagContrast("#ffffff", surface)
      ? "#000000"
      : "#ffffff"

function ink(surface: string, min: number, candidates: ReadonlyArray<string | null>, fallback: string): string {
  return (
    candidates.find(
      (candidate): candidate is string => candidate !== null && wcagContrast(candidate, surface) >= min,
    ) ?? fallback
  )
}

const KINDS: Record<string, ThemeAppearance> = {
  vs: "light",
  "hc-light": "light",
  light: "light",
  "vs-dark": "dark",
  "hc-black": "dark",
  dark: "dark",
}

function appearanceOf(uiTheme: unknown, type: unknown, canvas: string): ThemeAppearance {
  const kindOf = (value: unknown) => (typeof value === "string" ? KINDS[value.toLowerCase()] : undefined)
  return kindOf(uiTheme) ?? kindOf(type) ?? (wcagLuminance(canvas) < 0.179 ? "dark" : "light")
}

const SYNTAX_SCOPES: Record<keyof Syntax, string> = {
  keyword: "keyword.control",
  string: "string.quoted.double",
  func: "entity.name.function",
  comment: "comment.line.double-slash",
}

function selectorsOf(scope: unknown): string[] {
  const list = Array.isArray(scope) ? scope : typeof scope === "string" ? scope.split(",") : []
  return list.flatMap((item) =>
    typeof item === "string" && item.trim() && !/\s/.test(item.trim()) ? [item.trim()] : [],
  )
}

function tokenColor(rules: unknown[], scope: string): unknown {
  let best: unknown = null
  let score = 0
  for (const rule of rules) {
    if (!isObject(rule) || !isObject(rule.settings) || rule.settings.foreground === undefined) continue
    for (const selector of selectorsOf(rule.scope)) {
      if ((scope === selector || scope.startsWith(`${selector}.`)) && selector.length >= score) {
        best = rule.settings.foreground
        score = selector.length
      }
    }
  }
  return best
}

function syntaxOf(tokenColors: unknown, canvas: string, text: string): Syntax {
  const rules = Array.isArray(tokenColors) ? tokenColors : []
  const color = (key: keyof Syntax) => {
    const found = flatten(tokenColor(rules, SYNTAX_SCOPES[key]), canvas)
    return found && wcagContrast(found, canvas) >= 1.5 ? found : text
  }
  return { keyword: color("keyword"), string: color("string"), func: color("func"), comment: color("comment") }
}

const HUE_KEYS = {
  red: "terminal.ansiRed",
  orange: "terminal.ansiBrightRed",
  yellow: "terminal.ansiYellow",
  green: "terminal.ansiGreen",
  cyan: "terminal.ansiCyan",
  blue: "terminal.ansiBlue",
  magenta: "terminal.ansiMagenta",
  purple: "terminal.ansiBrightMagenta",
} as const satisfies Partial<Record<keyof Palette, string>>

export function themeFromVsCode(
  json: VsCodeTheme,
  meta: { id: string; name: string; source: string; uiTheme?: string },
): ImportedTheme {
  const colors = isObject(json.colors) ? json.colors : {}
  const firstOf = (candidates: ReadonlyArray<string | null>) =>
    candidates.find((candidate) => candidate !== null) ?? null

  const editor = firstOf([opaque(colors["editor.background"]), opaque(colors["editorPane.background"])])
  if (!editor) throw new Error("That theme has no editor background, so there is nothing to build a palette from.")
  const appearance = appearanceOf(meta.uiTheme, json.type, editor)
  const fallback = PALETTES[appearance]
  const pick = (...keys: string[]) => keys.map((key) => flatten(colors[key], editor))

  const base = ink(editor, TEXT_CONTRAST, pick("editor.foreground", "foreground"), readableOn(editor, fallback.base))
  const accent = ink(
    editor,
    SHAPE_CONTRAST,
    pick("focusBorder", "textLink.foreground", "button.background", "activityBarBadge.background"),
    fallback.accent,
  )
  const sidebar = firstOf(pick("sideBar.background", "activityBar.background")) ?? mix(editor, base, 0.04)
  const shape = (key: keyof Palette, ...keys: string[]) => ink(editor, SHAPE_CONTRAST, pick(...keys), fallback[key])
  const hues = Object.fromEntries(
    Object.entries(HUE_KEYS).map(([hue, key]) => [hue, shape(hue as keyof Palette, key)]),
  ) as Pick<Palette, keyof typeof HUE_KEYS>

  return {
    id: themeId(meta.id),
    name: meta.name.slice(0, 48),
    source: meta.source,
    appearance,
    palette: {
      ...hues,
      chrome: firstOf(pick("titleBar.activeBackground", "activityBar.background")) ?? sidebar,
      sidebar,
      editor,
      base,
      accent,
      onPrimary: readableOn(accent, ink(accent, TEXT_CONTRAST, pick("button.foreground"), fallback.onPrimary)),
      focus: accent,
      success: shape("success", "gitDecoration.addedResourceForeground", "terminal.ansiGreen"),
      warn: ink(editor, TEXT_CONTRAST, pick("editorWarning.foreground"), readableOn(editor, fallback.warn)),
      danger: ink(
        editor,
        TEXT_CONTRAST,
        pick("errorForeground", "editorError.foreground"),
        readableOn(editor, fallback.danger),
      ),
    },
    syntax: syntaxOf(json.tokenColors, editor, base),
  }
}

export function parseJsonc(text: string): unknown {
  let out = ""
  let comma = -1
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === '"') {
      const end = stringEnd(text, i)
      out += text.slice(i, end)
      i = end
      comma = -1
      continue
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end < 0 ? text.length : end + 2
      continue
    }
    if (c === "}" || c === "]") {
      if (comma >= 0) out = out.slice(0, comma) + out.slice(comma + 1)
      comma = -1
    } else if (c === ",") comma = out.length
    else if (!/\s/.test(c)) comma = -1
    out += c
    i++
  }
  return JSON.parse(out)
}

export function packagePath(from: string, relative: string): string {
  const parts = from.split("/").slice(0, -1)
  for (const part of relative.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue
    if (part !== "..") parts.push(part)
    else if (parts.length > 1) parts.pop()
    else throw new Error("A theme path leaves the extension package.")
  }
  return parts.join("/")
}

export async function readVsCodeTheme(
  path: string,
  read: (path: string) => Promise<VsCodeTheme>,
  depth = 0,
): Promise<VsCodeTheme> {
  if (depth >= MAX_INCLUDE_DEPTH) throw new Error("Theme includes are nested too deeply.")
  const value = await read(path)
  if (typeof value.include !== "string") return value
  const base = await readVsCodeTheme(packagePath(path, value.include), read, depth + 1)
  const tokens = (theme: VsCodeTheme) => (Array.isArray(theme.tokenColors) ? theme.tokenColors : [])
  return {
    ...base,
    ...value,
    colors: { ...base.colors, ...value.colors },
    tokenColors: [...tokens(base), ...tokens(value)],
  }
}

function stringEnd(text: string, start: number): number {
  let i = start + 1
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1
  return i + 1
}
