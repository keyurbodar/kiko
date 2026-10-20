export type SectionId = "chat" | "recipes"

export const SECTIONS: readonly { id: SectionId; label: string; href: string }[] = [
  { id: "chat", label: "Chat", href: "/chat" },
  { id: "recipes", label: "Recipes", href: "/recipes" },
]

export function sectionOf(pathname: string): SectionId | null {
  const first = pathname.split("/")[1]
  return SECTIONS.find((section) => section.id === first)?.id ?? null
}
