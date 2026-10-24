import {
  AppearanceIcon,
  CommandIcon,
  type Glyph,
  LinkIcon,
  ModelIcon,
  MonitorIcon,
  SettingsIcon,
  UserIcon,
} from "@kiko/ui/icons"
import type { FileRouteTypes } from "../routeTree.gen"

type SettingsPath = Exclude<Extract<FileRouteTypes["to"], `/settings/${string}`>, "/settings/$">
export type SettingsId = SettingsPath extends `/settings/${infer Id}` ? Id : never

type SectionMeta = { group: SettingsGroup; label: string; hint: string; icon: Glyph; keywords: string }

export const SETTINGS_GROUPS = ["You", "Your team", "Connections", "Kiko"] as const
type SettingsGroup = (typeof SETTINGS_GROUPS)[number]

const SECTIONS: { [Id in SettingsId]: SectionMeta } = {
  models: {
    group: "Your team",
    label: "Models",
    hint: "Connect providers and pick the models the chat offers.",
    icon: ModelIcon,
    keywords: "provider key api openai anthropic google opencode connect sign in disconnect model picker hide show",
  },
  tools: {
    group: "Connections",
    label: "Tools",
    hint: "Apps your agents can use.",
    icon: LinkIcon,
    keywords: "integrations composio mcp apps browser kernel tool",
  },
  computers: {
    group: "Connections",
    label: "Computers",
    hint: "Machines your agents can use, and that you can watch and take over.",
    icon: MonitorIcon,
    keywords: "computer pc mac linux windows desktop remote screen pair install daemon vps server takeover",
  },
  appearance: {
    group: "Kiko",
    label: "Appearance",
    hint: "How Kiko looks on this device.",
    icon: AppearanceIcon,
    keywords: "theme json dark light font radius spacing colors open vsx accent contrast",
  },
  general: {
    group: "Kiko",
    label: "General",
    hint: "How your agents behave between messages.",
    icon: SettingsIcon,
    keywords: "initiative proactive nudge digest speak up memory capture auto off",
  },
  keyboard: {
    group: "Kiko",
    label: "Keyboard shortcuts",
    hint: "Change the key for any command.",
    icon: CommandIcon,
    keywords: "keybindings hotkeys keys shortcut bind record reset browser conflict",
  },
  account: {
    group: "You",
    label: "Account",
    hint: "You, and where your Kiko lives.",
    icon: UserIcon,
    keywords:
      "profile sign out backend address version update google github email storage object r2 archive history space full",
  },
}

export type SettingsSection = SectionMeta & { id: SettingsId; to: SettingsPath }

export const SETTINGS_SECTIONS: readonly SettingsSection[] = (Object.keys(SECTIONS) as SettingsId[]).map((id) => ({
  ...SECTIONS[id],
  id,
  to: `/settings/${id}`,
}))

const SECTION_ALIAS: Record<string, SettingsId> = {
  providers: "models",
  integrations: "tools",
  extensions: "tools",
  skills: "tools",
  initiative: "general",
}

export function landingSection(id = ""): SettingsId {
  if (Object.hasOwn(SECTIONS, id)) return id as SettingsId
  return Object.hasOwn(SECTION_ALIAS, id) ? SECTION_ALIAS[id]! : "models"
}

export function sectionAt(pathname: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => pathname === s.to || pathname.startsWith(`${s.to}/`))
}

export function searchSections(query: string): readonly SettingsSection[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return SETTINGS_SECTIONS
  return SETTINGS_SECTIONS.filter((s) =>
    words.every((w) => `${s.label} ${s.hint} ${s.keywords}`.toLowerCase().includes(w)),
  )
}
