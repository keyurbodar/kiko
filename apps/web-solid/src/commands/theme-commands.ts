import type { Mode } from "@kiko/theme/look"
import { ACCENT_IDS, ACCENTS, type AccentId } from "@kiko/theme/palette"
import type { Choice, Command } from "./registry"

const MODES: [Mode, string][] = [
  ["dark", "Dark mode"],
  ["light", "Light mode"],
  ["system", "Follow the system"],
]

/*
 * Switching the look from the palette: one submenu with the appearances and the accents, and
 * changing the open chat's avatar. The pure table; `use-kat-commands.ts` wires it.
 */
export function themeCommands(deps: {
  mode: () => Mode
  accent: () => AccentId
  setMode: (mode: Mode) => void
  setAccent: (accent: AccentId) => void
  activeAgent: () => string | null
  changeAvatar: (slug: string) => void
  openView: (id: string) => void
}): Command[] {
  return [
    {
      id: "theme.change",
      title: "Change theme…",
      group: "theme",
      icon: "appearance",
      placeholder: "Change theme…",
      submenu: (): Choice[] => [
        ...MODES.map(([mode, title]): Choice => ({ id: `mode.${mode}`, title, icon: "appearance", current: deps.mode() === mode, run: () => deps.setMode(mode) })),
        ...ACCENT_IDS.map((id): Choice => ({ id: `accent.${id}`, title: `${ACCENTS[id].label} accent`, icon: "appearance", swatch: ACCENTS[id].dark, current: deps.accent() === id, run: () => deps.setAccent(id) })),
      ],
      run: () => deps.openView("theme.change"),
    },
    {
      id: "chat.change-avatar",
      title: "Change avatar",
      group: "chat",
      icon: "appearance",
      when: () => deps.activeAgent() !== null,
      run: () => {
        const slug = deps.activeAgent()
        if (slug) deps.changeAvatar(slug)
      },
    },
  ]
}
