/** The settings sections, in sidebar order. The URL is `/settings/<id>`. Each row shows its hint under the label. */
export const SETTINGS_SECTIONS = [
  { id: "providers", label: "providers", hint: "api keys and sign-ins", keywords: "key openai anthropic google opencode connect" },
  { id: "models", label: "models", hint: "the model new chats start with", keywords: "default model" },
  { id: "integrations", label: "integrations", hint: "executor and connected tools", keywords: "executor mcp tools apps" },
  { id: "skills", label: "skills", hint: "what your agents know how to do", keywords: "skill" },
  { id: "appearance", label: "appearance", hint: "theme, colors, and spacing", keywords: "theme json dark light font radius" },
  { id: "account", label: "account", hint: "sign out and delete account", keywords: "delete sign out email" },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]

/** Line icons for the sections, 16-unit paths. */
export const SECTION_ICON: Record<SettingsSectionId, string> = {
  providers: "M9.5 2.5a4 4 0 1 1-2.8 6.8L3 13v1.5H1.5V12l1-1H4V9.5h1.5l1-1A4 4 0 0 1 9.5 2.5zM10.5 5.5h.01",
  models: "M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z",
  integrations: "M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z",
  skills: "M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z",
  appearance: "M8 1.5a6.5 6.5 0 1 0 0 13c.9 0 1.3-.6 1.3-1.2 0-.8-.6-1-.6-1.8 0-.7.5-1.2 1.2-1.2h1.6a3 3 0 0 0 3-3C14.5 4.2 11.6 1.5 8 1.5zM4.8 7.2h.01M6.5 4.6h.01M9.7 4.6h.01",
  account: "M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5.5 6.5a5.5 5.5 0 0 1 11 0",
}

/** Sections whose label, hint, or keywords hold every word of the query. */
export function searchSections(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return SETTINGS_SECTIONS.filter((s) => words.every((w) => `${s.label} ${s.hint} ${s.keywords}`.includes(w)))
}
