/**
 * The settings sections, in sidebar order, each in its group. The URL is `/settings/<id>`. The
 * hint is the page's one line under its title.
 */
export const SETTINGS_SECTIONS = [
  { id: "models", group: "agents", label: "models", hint: "the providers your agents think with, and the model a new chat starts on.", keywords: "provider key api openai anthropic google opencode connect sign in default model" },
  { id: "integrations", group: "agents", label: "integrations", hint: "the apps your agents can reach, through executor.", keywords: "executor mcp tools apps" },
  { id: "extensions", group: "agents", label: "extensions", hint: "new tools, instructions, and schedules for your agents.", keywords: "extension plugin addon tool hook script catalog install" },
  { id: "skills", group: "agents", label: "skills", hint: "what your agents know how to do.", keywords: "skill" },
  { id: "appearance", group: "you", label: "appearance", hint: "theme, colors, glass, and the picture behind your chats.", keywords: "theme json dark light font radius spacing wallpaper background glass blur" },
  { id: "account", group: "you", label: "account", hint: "who you are signed in as, and leaving kiko.", keywords: "delete sign out email profile" },
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
  return SETTINGS_SECTIONS.filter((s) => words.every((w) => `${s.label} ${s.hint} ${s.keywords}`.includes(w)))
}
