// Turns a look into CSS on the root element: `data-appearance` picks the lightness scale in
// `kat.css`, and the theme's variables layer on top. It also keeps the cache the HTML shell
// reads before first paint, so the app opens in the right look with no flash.
//
// Every function here is a no-op without a DOM, so tests can import it.

import { setFavicon } from "../mascot/logo"
import { DEFAULT_LOOK, type Look, type Material, type Mode } from "./look"
import { DEFAULT_PRESET, presetFor } from "./presets"
import { parseTheme, resolveTheme, type ResolvedTheme, type Theme } from "./schema"
import { loadSharp } from "./wallpaper-store"

/** The key the inline script in `index.html` reads. Keep the two in step. */
export const CACHE_KEY = "kiko:look"

export type Appearance = "dark" | "light"
export type Cache = { v: 2; text: string; mode: Mode; material?: Material; tint?: number; wallpaper?: string | null; glass?: number; vars: ResolvedTheme }

export type Compiled = { ok: true; theme: Theme; notes: string[] } | { ok: false; errors: string[] }

/** Validates theme JSON a person brings. A failure never reaches the page. */
export function compileTheme(text: string): Compiled {
  const parsed = parseTheme(text)
  if (!parsed.ok) return parsed
  const r = resolveTheme(parsed.theme, presetFor)
  if (!r.ok) return { ok: false, errors: [r.error] }
  return { ok: true, theme: parsed.theme, notes: parsed.notes }
}

/** The variables a look sets. A theme that no longer resolves falls back to the default. */
export function resolveLook(look: Look): ResolvedTheme {
  const theme = "preset" in look.theme ? presetFor(look.theme.preset) : look.theme.custom
  const r = theme && resolveTheme(theme, presetFor)
  if (r && r.ok) return r.resolved
  const d = resolveTheme(presetFor(DEFAULT_PRESET)!, presetFor)
  return d.ok ? d.resolved : { dark: {}, light: {} }
}

const hasDom = () => typeof document !== "undefined" && !!document.documentElement
const systemLight = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches

export const appearanceOf = (mode: Mode): Appearance => (mode === "system" ? (systemLight() ? "light" : "dark") : mode)

let applied = new Set<string>()
let sharpFor: string | null = null
let sharpUrl: string | null = null

/**
 * Swaps in this device's sharp copy of the wallpaper once IndexedDB has it. Until then, and on
 * a device without it, kat.css shows the blurred copy the look carries.
 */
function syncSharp(root: HTMLElement, wallpaper: string | null): void {
  if (wallpaper === sharpFor) return
  sharpFor = wallpaper
  delete root.dataset.wallpaperSharp
  root.style.removeProperty("--wallpaper-sharp")
  if (sharpUrl) URL.revokeObjectURL(sharpUrl)
  sharpUrl = null
  if (!wallpaper || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return
  void loadSharp(wallpaper).then((blob) => {
    if (!blob || sharpFor !== wallpaper) return
    sharpUrl = URL.createObjectURL(blob)
    root.style.setProperty("--wallpaper-sharp", `url("${sharpUrl}")`)
    root.dataset.wallpaperSharp = ""
  })
}
let committed: Look = DEFAULT_LOOK
let watching = false

function paint(look: Look): void {
  if (!hasDom()) return
  const root = document.documentElement
  const appearance = appearanceOf(look.mode)
  const next = resolveLook(look)[appearance]
  for (const name of applied) if (!(name in next)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(next)) root.style.setProperty(name, value)
  applied = new Set(Object.keys(next))
  root.dataset.appearance = appearance
  root.dataset.material = look.material
  root.style.setProperty("--tinge", String(look.tint))
  // The wallpaper only shows under frost. kat.css turns the glass on when it is set.
  const wallpaper = look.material === "frost" ? look.wallpaper : null
  if (wallpaper) {
    root.dataset.wallpaper = ""
    root.style.setProperty("--wallpaper", `url("${wallpaper}")`)
  } else {
    delete root.dataset.wallpaper
    root.style.removeProperty("--wallpaper")
  }
  syncSharp(root, wallpaper ?? null)
  root.style.setProperty("--glass", String(look.glass))
  root.style.setProperty("--frost", `${look.frost}px`)
  root.style.setProperty("--grain", String(look.grain))
  root.dataset.frostWhere = look.frostWhere
  root.classList.toggle("dark", appearance === "dark")
  root.style.colorScheme = appearance
  // The boot screen and the overscroll area read this, so it follows the panel colour.
  const computed = typeof getComputedStyle === "function" ? getComputedStyle(root) : null
  const bg = computed?.getPropertyValue("--bg").trim() ?? ""
  // The tab icon is the kiko bird, so it wears the theme colour too.
  if (computed) setFavicon(Number(computed.getPropertyValue("--h-brand")) || 340, Number(computed.getPropertyValue("--cm") || 1))
  if (bg) {
    root.style.backgroundColor = bg
    root.style.setProperty("--boot-bg", bg)
  }
}

function watch(): void {
  if (watching || typeof matchMedia !== "function") return
  watching = true
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (committed.mode === "system") paint(committed)
  })
}

/** Applies a look as the saved one. */
export function applyCommitted(look: Look): void {
  committed = look
  paint(look)
  watch()
}

/** Shows a look without saving it. `endPreview` puts the saved one back. */
export function preview(look: Look): void {
  paint(look)
}

export function endPreview(): void {
  paint(committed)
}

export function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const value = raw ? (JSON.parse(raw) as Partial<Cache>) : null
    return value && value.v === 2 && typeof value.text === "string" && value.vars?.dark ? (value as Cache) : null
  } catch {
    return null
  }
}

export function writeCache(text: string | null, look: Look): void {
  try {
    if (text === null) localStorage.removeItem(CACHE_KEY)
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 2, text, mode: look.mode, material: look.material, tint: look.tint, wallpaper: look.wallpaper, glass: look.glass, vars: resolveLook(look) } satisfies Cache))
  } catch {
    // storage can be blocked. the look still applies for this page load.
  }
}
