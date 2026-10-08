// Turns a look into CSS on the root element: `data-appearance` picks kat.css's light or dark
// scale, and the palette's tokens for that half layer on top. It also keeps the cache the HTML
// shell reads before first paint, so the app opens in the right look with no flash.
//
// Every function here is a no-op without a DOM, so tests can import it.

import { setFavicon } from "../mascot/logo"
import { accentFor, colorsFor, DEFAULT_LOOK, type Look } from "./look"
import { accentChroma, oklchOf, resolveAppearance, tokensFor, type ThemeAppearance, type ThemeDefinition, type ThemeMode } from "./palette"

/** The key the inline script in `index.html` reads. Keep the two in step. */
export const CACHE_KEY = "kiko:look"

/** What the shell paints from: the saved text, the mode, and the tokens for each half. */
export type Cache = { v: 3; text: string; mode: ThemeMode; vars: Record<ThemeAppearance, Record<string, string>> }

const hasDom = () => typeof document !== "undefined" && !!document.documentElement
const systemDark = () => typeof matchMedia !== "function" || !matchMedia("(prefers-color-scheme: light)").matches

export const appearanceOf = (mode: ThemeMode): ThemeAppearance => resolveAppearance(mode, systemDark())

/** The tokens each half paints. */
export function resolveLook(look: Look, library: readonly ThemeDefinition[]): Record<ThemeAppearance, Record<string, string>> {
  return { light: tokensFor(colorsFor(look, "light", library), "light", accentFor(look, "light")), dark: tokensFor(colorsFor(look, "dark", library), "dark", accentFor(look, "dark")) }
}

let applied = new Set<string>()
let committed: { look: Look; library: readonly ThemeDefinition[] } = { look: DEFAULT_LOOK, library: [] }
let watching = false

function paint(look: Look, library: readonly ThemeDefinition[]): void {
  if (!hasDom()) return
  const root = document.documentElement
  const appearance = appearanceOf(look.mode)
  const colors = colorsFor(look, appearance, library)
  const accent = accentFor(look, appearance)
  const next = tokensFor(colors, appearance, accent)
  for (const name of applied) if (!(name in next)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(next)) root.style.setProperty(name, value)
  applied = new Set(Object.keys(next))
  root.dataset.appearance = appearance
  root.classList.toggle("dark", appearance === "dark")
  root.style.colorScheme = appearance
  // The boot screen and the overscroll area follow the canvas.
  root.style.backgroundColor = colors.canvas
  root.style.setProperty("--boot-bg", colors.canvas)
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", colors.canvas)
  // The tab icon is the kiko bird, so it wears the accent too.
  const brand = accent ?? colors.accent
  setFavicon(oklchOf(brand)?.h ?? 340, accentChroma(brand))
}

function watch(): void {
  if (watching || typeof matchMedia !== "function") return
  watching = true
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (committed.look.mode === "system") paint(committed.look, committed.library)
  })
}

/** Applies a look as the saved one. */
export function applyCommitted(look: Look, library: readonly ThemeDefinition[]): void {
  committed = { look, library }
  paint(look, library)
  watch()
}

/** Shows a look without saving it. `endPreview` puts the saved one back. */
export function preview(look: Look, library: readonly ThemeDefinition[] = committed.library): void {
  paint(look, library)
}

export function endPreview(): void {
  paint(committed.look, committed.library)
}

export function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const value = raw ? (JSON.parse(raw) as Partial<Cache>) : null
    return value && value.v === 3 && typeof value.text === "string" && value.vars?.dark && value.vars.light ? (value as Cache) : null
  } catch {
    return null
  }
}

export function writeCache(text: string | null, look: Look, library: readonly ThemeDefinition[]): void {
  try {
    if (text === null) localStorage.removeItem(CACHE_KEY)
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 3, text, mode: look.mode, vars: resolveLook(look, library) } satisfies Cache))
  } catch {
    // storage can be blocked. the look still applies for this page load.
  }
}
