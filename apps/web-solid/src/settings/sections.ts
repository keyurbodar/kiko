/**
 * The settings sections, in sidebar order. The URL is `/settings/<id>`. A hint, where a section has
 * one, is the page's one line under its title.
 */
export const SETTINGS_SECTIONS = [
  { id: "models", group: "all", label: "Models", hint: "Connect providers and pick the models the chat offers.", keywords: "provider key api openai anthropic google opencode connect sign in disconnect model picker hide show" },
  { id: "tools", group: "all", label: "Tools", hint: "Apps, extensions, and skills your agents can use.", keywords: "integrations composio mcp apps browser kernel extension plugin addon tool hook script catalog install schedules skill" },
  { id: "appearance", group: "all", label: "Appearance", hint: undefined, keywords: "theme json dark light font radius spacing colors open vsx accent contrast" },
  { id: "general", group: "all", label: "General", hint: undefined, keywords: "initiative proactive nudge digest speak up memory capture auto off account profile sign out" },
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** The section list's groups, in order. */
export const SETTINGS_GROUPS = ["all"] as const

/** A section's tabs, in order. A section without tabs is one page. */
export function tabsOf(section: string): { id: string; label: string }[] {
  if (section === "tools") return [
    { id: "apps", label: "Apps" },
    { id: "extensions", label: "Extensions" },
    { id: "catalog", label: "Catalog" },
    { id: "skills", label: "Skills" },
  ]
  return []
}

/** Where a section that was merged into another now lives, so an old link still lands. */
export const SECTION_ALIAS: Record<string, { section: SettingsSection["id"]; tab?: string }> = {
  providers: { section: "models" },
  integrations: { section: "tools", tab: "apps" },
  extensions: { section: "tools", tab: "extensions" },
  skills: { section: "tools", tab: "skills" },
  initiative: { section: "general" },
  account: { section: "general" },
}

/** Sections whose label, hint, or keywords hold every word of the query. Without one, all of them. */
export function searchSections(query: string): readonly SettingsSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return SETTINGS_SECTIONS
  return SETTINGS_SECTIONS.filter((s) => words.every((w) => `${s.label} ${s.hint ?? ""} ${s.keywords}`.toLowerCase().includes(w)))
}
