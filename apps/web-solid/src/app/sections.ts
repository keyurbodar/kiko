/*
 * The rail's five sections, as data. The URL is the only source of the active
 * one: `sectionOf` reads a pathname and nothing else, so the rail, the sidebar
 * and the top bar cannot disagree about where the user is.
 */
export type SectionId = "chat" | "files" | "board" | "memory" | "settings"

export const SECTIONS: readonly { id: SectionId; label: string; href: string }[] = [
  { id: "chat", label: "chat", href: "/chat" },
  { id: "files", label: "files", href: "/files" },
  { id: "board", label: "board", href: "/board" },
  { id: "memory", label: "memory", href: "/memory" },
  { id: "settings", label: "settings", href: "/settings" },
]

export function sectionOf(pathname: string): SectionId | null {
  const first = pathname.split("/")[1]
  return SECTIONS.find((section) => section.id === first)?.id ?? null
}
