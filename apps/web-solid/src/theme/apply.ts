// Turns a validated theme into CSS variables on the root element, the way t3code's
// `applyThemePalette` does, and keeps the cache the HTML shell reads before first paint.
//
// Every function here is a no-op without a DOM, so tests can import it.

import { parseTheme, resolveTheme, type Appearance, type ResolvedTheme, type Resolved } from "./schema"
import { presetFor } from "./presets"

/** The key the inline script in `index.html` reads. Keep the two in step. */
export const CACHE_KEY = "kiko:theme"
const SHELL_BG = "#1c1b1f"

export type Cache = { v: 1; text: string; theme: ResolvedTheme }

export type Compiled =
  | { ok: true; resolved: ResolvedTheme; notes: string[] }
  | { ok: false; errors: string[] }

/** Validates and resolves theme text in one step. A failure never reaches the page. */
export function compileTheme(text: string): Compiled {
  const parsed = parseTheme(text)
  if (!parsed.ok) return parsed
  const r = resolveTheme(parsed.theme, presetFor)
  if (!r.ok) return { ok: false, errors: [r.error] }
  return { ok: true, resolved: r.resolved, notes: parsed.notes }
}

let applied = new Set<string>()
let committed: ResolvedTheme | null = null
let watching = false

const hasDom = () => typeof document !== "undefined" && !!document.documentElement

function prefersLight(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches
}

function pick(theme: ResolvedTheme): Resolved {
  return theme.light && prefersLight() ? theme.light : theme.base
}

function paint(r: Resolved | null): void {
  if (!hasDom()) return
  const root = document.documentElement
  const next = r?.vars ?? {}
  for (const name of applied) if (!(name in next)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(next)) root.style.setProperty(name, value)
  applied = new Set(Object.keys(next))
  const appearance: Appearance = r?.appearance ?? "dark"
  root.classList.toggle("dark", appearance === "dark")
  root.style.colorScheme = appearance
  const bg = next["--bg"] ?? SHELL_BG
  root.style.backgroundColor = bg
  root.style.setProperty("--boot-bg", bg)
}

function watch(): void {
  if (watching || typeof matchMedia !== "function") return
  watching = true
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (committed) paint(pick(committed))
  })
}

/** Applies a theme as the saved one. Null goes back to kat. */
export function applyCommitted(theme: ResolvedTheme | null): void {
  committed = theme
  paint(theme ? pick(theme) : null)
  watch()
}

/** Shows a draft without saving it. `endPreview` puts the saved theme back. */
export function preview(theme: ResolvedTheme): void {
  paint(pick(theme))
}

export function endPreview(): void {
  paint(committed ? pick(committed) : null)
}

export function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const value = raw ? (JSON.parse(raw) as Partial<Cache>) : null
    return value && value.v === 1 && typeof value.text === "string" && value.theme?.base ? (value as Cache) : null
  } catch {
    return null
  }
}

export function writeCache(text: string | null, theme: ResolvedTheme | null): void {
  try {
    if (text === null || theme === null) localStorage.removeItem(CACHE_KEY)
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 1, text, theme } satisfies Cache))
  } catch {
    // storage can be blocked. the theme still applies for this page load.
  }
}
