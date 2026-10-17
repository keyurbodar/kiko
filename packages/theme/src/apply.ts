
import { displayVars } from "./display"
import { formatImported, IMPORTED_KEY, parseImported, themeFor, type Imported } from "./imported"
import { DEFAULT_LOOK, type Look } from "./look"
import { PALETTES, resolveAppearance, tokensFor, type ThemeAppearance, type ThemeMode } from "./palette"

export const CACHE_KEY = "kiko:look"

export type Cache = { v: 5; text: string; mode: ThemeMode; vars: Record<ThemeAppearance, Record<string, string>> }

const hasDom = () => typeof document !== "undefined" && !!document.documentElement
const systemDark = () => typeof matchMedia !== "function" || !matchMedia("(prefers-color-scheme: light)").matches

export const appearanceOf = (mode: ThemeMode): ThemeAppearance => resolveAppearance(mode, systemDark())

let imported: Imported = parseImported(storedImported())
// Imported themes belong to this browser, not to a person, so the signed-out screens skip them.
let importedOn = true

function storedImported(): string | null {
  try {
    return localStorage.getItem(IMPORTED_KEY)
  } catch {
    return null
  }
}

const half = (look: Look, h: ThemeAppearance) => ({
  ...tokensFor(h, look.accent, look.display.contrast, importedOn ? themeFor(imported, h) : undefined),
  ...displayVars(look.display),
})

export const resolveLook = (look: Look): Record<ThemeAppearance, Record<string, string>> => ({ light: half(look, "light"), dark: half(look, "dark") })

export const importedThemes = (): Imported => imported

export function saveImported(next: Imported): void {
  imported = next
  try {
    localStorage.setItem(IMPORTED_KEY, formatImported(next))
  } catch {}
  const cached = readCache()
  if (cached) writeCache(cached.text, committed)
  paint(committed)
}

let applied = new Set<string>()
let committed: Look = DEFAULT_LOOK
let watching = false

function paint(look: Look): void {
  if (!hasDom()) return
  const root = document.documentElement
  const appearance = appearanceOf(look.mode)
  const next = half(look, appearance)
  for (const name of applied) if (!(name in next)) root.style.removeProperty(name)
  for (const [name, value] of Object.entries(next)) root.style.setProperty(name, value)
  applied = new Set(Object.keys(next))
  root.classList.toggle("dark", appearance === "dark")
  root.style.colorScheme = appearance
  const canvas = PALETTES[appearance].canvas
  root.style.backgroundColor = canvas
  root.style.setProperty("--boot-bg", canvas)
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", canvas)
}

function watch(): void {
  if (watching || typeof matchMedia !== "function") return
  watching = true
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (committed.mode === "system") paint(committed)
  })
}

export function applyCommitted(look: Look, withImported = true): void {
  importedOn = withImported
  committed = look
  paint(look)
  watch()
}

export function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const value = raw ? (JSON.parse(raw) as Partial<Cache>) : null
    return value && value.v === 5 && typeof value.text === "string" && value.vars?.dark && value.vars.light ? (value as Cache) : null
  } catch {
    return null
  }
}

export function writeCache(text: string | null, look: Look): void {
  try {
    if (text === null) localStorage.removeItem(CACHE_KEY)
    else localStorage.setItem(CACHE_KEY, JSON.stringify({ v: 5, text, mode: look.mode, vars: resolveLook(look) } satisfies Cache))
  } catch {
  }
}
