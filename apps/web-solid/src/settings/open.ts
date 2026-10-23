import { history, openChat } from "../app/history"
import { landingSection, type SettingsId } from "./sections"

export const inSettings = (pathname: string): boolean => pathname === "/settings" || pathname.startsWith("/settings/")

export function openSettings(id: SettingsId = "models"): void {
  history.push(`/settings/${landingSection(id)}`)
}

export function closeSettings(): void {
  if (inSettings(history.location.pathname)) openChat(null)
}

export function toggleSettings(): void {
  if (inSettings(history.location.pathname)) closeSettings()
  else openSettings()
}
