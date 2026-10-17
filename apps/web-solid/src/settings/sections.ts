/**
 * The settings sections, in sidebar order. The URL is `/settings/<id>`. A hint, where a section has
 * one, is the page's one line under its title.
 */
export const SETTINGS_SECTIONS = [
  { id: "models", group: "all", label: "Models", hint: "Connect providers and pick the models the chat offers.", keywords: "provider key api openai anthropic google opencode connect sign in disconnect model picker hide show" },
  { id: "tools", group: "all", label: "Tools", hint: "Apps your agents can use.", keywords: "integrations composio mcp apps browser kernel tool" },
  { id: "appearance", group: "all", label: "Appearance", hint: undefined, keywords: "theme json dark light font radius spacing colors open vsx accent contrast" },
  { id: "general", group: "all", label: "General", hint: undefined, keywords: "initiative proactive nudge digest speak up memory capture auto off" },
  { id: "keyboard", group: "all", label: "Keyboard shortcuts", hint: "Change the key for any command.", keywords: "keybindings hotkeys keys shortcut bind record reset browser conflict" },
  { id: "account", group: "all", label: "Account", hint: undefined, keywords: "profile sign out backend address version update google github email" },
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** The section list's groups, in order. */
export const SETTINGS_GROUPS = ["all"] as const

/** Where a section that was merged into another now lives, so an old link still lands. */
export const SECTION_ALIAS: Record<string, SettingsSection["id"]> = {
  providers: "models",
  integrations: "tools",
  extensions: "tools",
  skills: "tools",
  initiative: "general",
}

/** Sections whose label, hint, or keywords hold every word of the query. Without one, all of them. */
export function searchSections(query: string): readonly SettingsSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return SETTINGS_SECTIONS
  return SETTINGS_SECTIONS.filter((s) => words.every((w) => `${s.label} ${s.hint ?? ""} ${s.keywords}`.toLowerCase().includes(w)))
}
