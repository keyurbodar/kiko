/**
 * The settings sections, in sidebar order, each in its group. The URL is `/settings/<id>`. A
 * hint, where a section has one, is the page's one line under its title.
 */
export const SETTINGS_SECTIONS = [
  { id: "providers", group: "agents", label: "Providers", hint: undefined, keywords: "provider key api openai anthropic google opencode connect sign in disconnect" },
  { id: "models", group: "agents", label: "Models", hint: "The models the chat picker offers.", keywords: "model picker hide show default" },
  { id: "integrations", group: "agents", label: "Integrations", hint: "Apps your agents reach through Composio.", keywords: "composio mcp tools apps" },
  { id: "initiative", group: "agents", label: "Initiative", hint: "How much Yuki speaks up without being asked.", keywords: "initiative proactive nudge digest speak up memory capture auto always off loops" },
  { id: "extensions", group: "agents", label: "Extensions", hint: undefined, keywords: "extension plugin addon tool hook script catalog install instructions schedules" },
  { id: "skills", group: "agents", label: "Skills", hint: undefined, keywords: "skill" },
  { id: "appearance", group: "you", label: "Appearance", hint: undefined, keywords: "theme json dark light font radius spacing wallpaper background glass blur colors picture" },
  { id: "account", group: "you", label: "Account", hint: undefined, keywords: "sign out profile leave" },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

/** The section list's groups, in order. */
export const SETTINGS_GROUPS = ["agents", "you"] as const

/** Every section, for the phone's tab row. */
export const NAV_SECTIONS = SETTINGS_SECTIONS

/** Sections whose label, hint, or keywords hold every word of the query. Without one, all of them. */
export function searchSections(query: string): readonly SettingsSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return SETTINGS_SECTIONS
  return SETTINGS_SECTIONS.filter((s) => words.every((w) => `${s.label} ${s.hint ?? ""} ${s.keywords}`.toLowerCase().includes(w)))
}
