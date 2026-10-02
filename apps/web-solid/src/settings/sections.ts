/** The settings sections, in sidebar order. The URL is `/settings/<id>`. */
export const SETTINGS_SECTIONS = [
  { id: "providers", label: "providers" },
  { id: "models", label: "models" },
  { id: "integrations", label: "integrations" },
  { id: "skills", label: "skills" },
  { id: "appearance", label: "appearance" },
  { id: "account", label: "account" },
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"]
