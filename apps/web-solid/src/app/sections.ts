/*
 * The rail's two sections, as data. The URL is the only source of the active
 * one: `sectionOf` reads a pathname and nothing else, so the rail, the sidebar
 * and the top bar cannot disagree about where the user is.
 */
export type SectionId = "chat" | "settings"

export const SECTIONS: readonly { id: SectionId; label: string; href: string }[] = [
  { id: "chat", label: "chat", href: "/chat" },
  { id: "settings", label: "settings", href: "/settings" },
]

/*
 * Memory and files are not sections. Both live in the chat's right panel (`chat/info`), and
 * `/memory` and `/files` redirect there.
 */
export function sectionOf(pathname: string): SectionId | null {
  const first = pathname.split("/")[1]
  return SECTIONS.find((section) => section.id === first)?.id ?? null
}
