import { formatHex, interpolate, parse, rgb, wcagContrast, wcagLuminance } from "culori"
import { themeId, type ImportedTheme } from "./imported"
import { THEMES, PALETTES, type ThemeAppearance } from "./palette"

export type VsCodeTheme = { type?: unknown; include?: unknown; colors?: Record<string, unknown>; [key: string]: unknown }

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
  wcagContrast(preferred, surface) >= TEXT_CONTRAST ? preferred : wcagContrast("#000000", surface) >= wcagContrast("#ffffff", surface) ? "#000000" : "#ffffff"

function ink(surface: string, min: number, candidates: ReadonlyArray<string | null>, fallback: string): string {
  return candidates.find((candidate): candidate is string => candidate !== null && wcagContrast(candidate, surface) >= min) ?? fallback
}

function appearanceOf(type: unknown, canvas: string): ThemeAppearance {
  const kind = typeof type === "string" ? type.toLowerCase() : ""
  if (kind === "light" || kind === "hc-light") return "light"
  if (kind === "dark" || kind === "hc-black") return "dark"
  return wcagLuminance(canvas) < 0.179 ? "dark" : "light"
}

export function themeFromVsCode(json: VsCodeTheme, meta: { id: string; name: string; source: string }): ImportedTheme {
  const colors = isObject(json.colors) ? json.colors : {}
  const firstOf = (candidates: ReadonlyArray<string | null>) => candidates.find((candidate) => candidate !== null) ?? null

  const canvas = firstOf([opaque(colors["editor.background"]), opaque(colors["editorPane.background"])])
  if (!canvas) throw new Error("That theme has no editor background, so there is nothing to build a palette from.")
  const appearance = appearanceOf(json.type, canvas)
  const fallback = PALETTES[appearance]
  const pick = (...keys: string[]) => keys.map((key) => flatten(colors[key], canvas))

  const text = ink(canvas, TEXT_CONTRAST, pick("editor.foreground", "foreground"), readableOn(canvas, fallback.text))
  const muted = ink(canvas, TEXT_CONTRAST, pick("descriptionForeground"), mix(text, canvas, 0.35))
  const action = ink(canvas, SHAPE_CONTRAST, pick("button.background"), text)
  const onAction = ink(action, TEXT_CONTRAST, pick("button.foreground"), readableOn(action, canvas))

  return {
    id: themeId(meta.id),
    name: meta.name.slice(0, 48),
    source: meta.source,
    appearance,
    accent: ink(canvas, SHAPE_CONTRAST, pick("focusBorder", "textLink.foreground", "button.background", "activityBarBadge.background"), THEMES[appearance === "dark" ? "glacier" : "snow"].accent),
    palette: {
      canvas,
      sidebar: firstOf(pick("sideBar.background", "activityBar.background")) ?? mix(canvas, text, 0.04),
      text,
      muted,
      faint: ink(canvas, SHAPE_CONTRAST, pick("disabledForeground"), mix(text, canvas, 0.55)),
      action,
      actionHover: mix(action, onAction, 0.12),
      onAction,
      danger: ink(canvas, TEXT_CONTRAST, pick("errorForeground", "editorError.foreground"), readableOn(canvas, fallback.danger)),
      gold: ink(canvas, TEXT_CONTRAST, pick("editorWarning.foreground"), readableOn(canvas, fallback.gold)),
    },
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

export async function readVsCodeTheme(path: string, read: (path: string) => Promise<VsCodeTheme>, depth = 0): Promise<VsCodeTheme> {
  if (depth >= MAX_INCLUDE_DEPTH) throw new Error("Theme includes are nested too deeply.")
  const value = await read(path)
  if (typeof value.include !== "string") return value
  const base = await readVsCodeTheme(packagePath(path, value.include), read, depth + 1)
  return { ...base, ...value, colors: { ...base.colors, ...value.colors } }
}

function stringEnd(text: string, start: number): number {
  let i = start + 1
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1
  return i + 1
}
