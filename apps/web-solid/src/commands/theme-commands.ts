import type { Imported } from "@kiko/theme/imported"
import type { Mode } from "@kiko/theme/look"
import { appearanceOf } from "@kiko/theme/apply"
import { ACCENT_IDS, ACCENTS, type AccentId, type ThemeAppearance } from "@kiko/theme/palette"
import type { Choice, Command } from "./registry"

const MODES: [Mode, string][] = [
  ["dark", "Dark mode"],
  ["light", "Light mode"],
  ["system", "Follow the system"],
]

/*
 * Switching the look from the palette: one submenu with the appearances, every theme (Kiko's own and
 * the imported VS Code ones) and the accents, and changing the open chat's avatar. Each look row
 * previews itself while highlighted. The pure table; `use-kat-commands.ts` wires it.
 */
export function themeCommands(deps: {
  mode: () => Mode
  accent: () => AccentId
  setMode: (mode: Mode) => void
  setAccent: (accent: AccentId) => void
  /** The imported themes and which one each appearance uses. */
  imported: () => Imported
  /** Saves a theme: its appearance becomes the mode, and `id` (or Kiko's own, for "") is that appearance's theme. */
  setTheme: (appearance: ThemeAppearance, id: string) => void
  /** Paints a look without saving it. Returns what paints the saved look back. */
  preview: (look: { mode?: Mode; accent?: AccentId; active?: Imported["active"] }) => () => void
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
      submenu: (): Choice[] => {
        const shown = appearanceOf(deps.mode())
        const imported = deps.imported()
        const themes: [ThemeAppearance, string, string, string?][] = [
          ["dark", "", "Kiko dark"],
          ["light", "", "Kiko light"],
          ...imported.themes.map((t): [ThemeAppearance, string, string, string] => [t.appearance, t.id, t.name, t.source]),
        ]
        return [
          ...MODES.map(([mode, title]): Choice => ({ id: `mode.${mode}`, title, icon: "appearance", group: "Mode", current: deps.mode() === mode, preview: () => deps.preview({ mode }), run: () => deps.setMode(mode) })),
          ...themes.map(([appearance, id, title, source]): Choice => ({
            id: `theme.${appearance}.${id || "kiko"}`,
            title,
            detail: source ?? `${appearance === "dark" ? "Dark" : "Light"} theme`,
            icon: "appearance",
            group: "Theme",
            current: shown === appearance && (imported.active[appearance] ?? "") === id,
            preview: () => deps.preview({ mode: appearance, active: { ...imported.active, [appearance]: id || undefined } }),
            run: () => deps.setTheme(appearance, id),
          })),
          ...ACCENT_IDS.map((id): Choice => ({ id: `accent.${id}`, title: `${ACCENTS[id].label} accent`, icon: "appearance", group: "Accent", swatch: ACCENTS[id].dark, current: deps.accent() === id, preview: () => deps.preview({ accent: id }), run: () => deps.setAccent(id) })),
        ]
      },
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
