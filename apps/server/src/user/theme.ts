import { deleteSetting, getSetting, setSetting } from "../lib/settings"

// The user's one theme record. It is the JSON text the client validated, kept as a
// string in the `settings` table. The server checks the size and that it is a version 1
// object. The client does the full check, and never applies a theme that fails it.

export const THEME_KEY = "theme"
export const THEME_MAX_CHARS = 32 * 1024

export function getTheme(sql: SqlStorage): string | null {
  return getSetting(sql, THEME_KEY)
}

/** True when `text` may be stored: small, valid JSON, an object with `version` 1. */
export function isStorableTheme(text: unknown): text is string {
  if (typeof text !== "string" || text.length > THEME_MAX_CHARS) return false
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { version?: unknown }).version === 1
  } catch {
    return false
  }
}

/** Stores or clears the theme. Returns false when nothing changed or the text is refused. */
export function setTheme(sql: SqlStorage, theme: string | null): boolean {
  if (theme !== null && !isStorableTheme(theme)) return false
  if (getTheme(sql) === theme) return false
  if (theme === null) deleteSetting(sql, THEME_KEY)
  else setSetting(sql, THEME_KEY, theme)
  return true
}
