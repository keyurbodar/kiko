import { useLocation } from "@tanstack/solid-router"
import { room } from "../state/room"

export type SectionId = "chat" | "recipes"

const SECTIONS: readonly { id: SectionId; label: string; href: string; paths: readonly string[] }[] = [
  { id: "chat", label: "Chat", href: "/chat", paths: ["", "chat", "settings"] },
  { id: "recipes", label: "Recipes", href: "/recipes", paths: ["recipes"] },
]

const CHAT_ROOM = /^\/chat\/([^/]+)\/?$/

const COVERING = new Set(["customize", "files", "recipes"])

export function sectionOf(pathname: string): SectionId | null {
  const first = pathname.split("/")[1] ?? ""
  return SECTIONS.find((section) => section.paths.includes(first))?.id ?? null
}

export function coversChat(pathname: string): boolean {
  return COVERING.has(pathname.split("/")[1] ?? "")
}

export function roomForRoute(previous: string | null, pathname: string, search: { room?: unknown }): string | null {
  return roomInUrl(pathname, search) ?? (coversChat(pathname) ? previous : null)
}

export function roomInUrl(pathname: string, search: { room?: unknown }): string | null {
  const id = CHAT_ROOM.exec(pathname)?.[1]
  if (id) return decodeURIComponent(id)
  if (sectionOf(pathname) === "chat") return room.resumeChat()
  return typeof search.room === "string" ? search.room : null
}

export function useChatInView(): () => string | null {
  const pathname = useLocation({ select: (location) => location.pathname })
  return () => (sectionOf(pathname()) === "chat" ? room.activeId() : null)
}
