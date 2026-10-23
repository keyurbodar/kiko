import { useLocation } from "@tanstack/solid-router"
import { useApp } from "../lib/store"

export type SectionId = "chat" | "recipes"

export const SECTIONS: readonly { id: SectionId; label: string; href: string; paths: readonly string[] }[] = [
  { id: "chat", label: "Chat", href: "/chat", paths: ["", "chat", "settings"] },
  { id: "recipes", label: "Recipes", href: "/recipes", paths: ["recipes"] },
]

const CHAT_ROOM = /^\/chat\/([^/]+)\/?$/

export function sectionOf(pathname: string): SectionId | null {
  const first = pathname.split("/")[1] ?? ""
  return SECTIONS.find((section) => section.paths.includes(first))?.id ?? null
}

export function roomInUrl(pathname: string, search: { room?: unknown }): string | null {
  const id = CHAT_ROOM.exec(pathname)?.[1]
  if (id) return decodeURIComponent(id)
  if (sectionOf(pathname) === "chat") return useApp.resumeChat()
  return typeof search.room === "string" ? search.room : null
}

export function useChatInView(): () => string | null {
  const pathname = useLocation({ select: (location) => location.pathname })
  return () => (sectionOf(pathname()) === "chat" ? useApp.activeThreadId() : null)
}
