/**
 * The settings sections, in sidebar order. The URL is `/settings/<id>`. Account has no row of
 * its own: the profile card at the top of the sidebar opens it.
 */
export const SETTINGS_SECTIONS = [
  { id: "models", label: "models", hint: "providers and the default model", keywords: "provider key api openai anthropic google opencode connect sign in default model" },
  { id: "integrations", label: "integrations", hint: "executor and tools", keywords: "executor mcp tools apps" },
  { id: "skills", label: "skills", hint: "what agents can do", keywords: "skill" },
  { id: "appearance", label: "appearance", hint: "theme and colors", keywords: "theme json dark light font radius spacing" },
  { id: "account", label: "account", hint: "sign out or delete your account", keywords: "delete sign out email profile" },
] as const

/** The rows the section list draws. Account is reached from the profile card instead. */
export const NAV_SECTIONS = SETTINGS_SECTIONS.filter((s) => s.id !== "account")

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]

/** Sections whose label, hint, or keywords hold every word of the query. Without one, the nav rows. */
export function searchSections(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return NAV_SECTIONS
  return SETTINGS_SECTIONS.filter((s) => words.every((w) => `${s.label} ${s.hint} ${s.keywords}`.includes(w)))
}
