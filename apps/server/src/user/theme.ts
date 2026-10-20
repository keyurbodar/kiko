import { deleteSetting, getSetting, setSetting } from "../lib/settings"

export const THEME_KEY = "theme"
export const THEME_MAX_CHARS = 32 * 1024

export function getTheme(sql: SqlStorage): string | null {
  return getSetting(sql, THEME_KEY)
}

export function isStorableTheme(text: unknown): text is string {
  if (typeof text !== "string" || text.length > THEME_MAX_CHARS) return false
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === "object" && value !== null && !Array.isArray(value) && (value as { version?: unknown }).version === 1
  } catch {
    return false
  }
}

export function setTheme(sql: SqlStorage, theme: string | null): boolean {
  if (theme !== null && !isStorableTheme(theme)) return false
  if (getTheme(sql) === theme) return false
  if (theme === null) deleteSetting(sql, THEME_KEY)
  else setSetting(sql, THEME_KEY, theme)
  return true
}
