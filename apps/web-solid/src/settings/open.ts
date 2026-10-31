import { history, openChat } from "../app/history"
import { landingSection, type SettingsId } from "./sections"

let covered: string | null = null

export const inSettings = (pathname: string): boolean => pathname === "/settings" || pathname.startsWith("/settings/")

export function openSettings(id: SettingsId = "models"): void {
  const { pathname, search } = history.location
  if (!inSettings(pathname)) covered = `${pathname}${search}`
  history.push(`/settings/${landingSection(id)}`)
}

export function closeSettings(): void {
  if (!inSettings(history.location.pathname)) return
  const back = covered
  covered = null
  if (back !== null) history.push(back)
  else openChat(null)
}

export function toggleSettings(): void {
  if (inSettings(history.location.pathname)) closeSettings()
  else openSettings()
}
