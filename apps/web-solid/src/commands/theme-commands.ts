import type { Imported } from "@kiko/theme/imported"
import type { Mode } from "@kiko/theme/look"
import { appearanceOf } from "@kiko/theme/apply"
import { THEME_IDS, THEMES, type DarkThemeId, type ThemeId, type ThemeAppearance } from "@kiko/theme/palette"
import type { Choice, Command } from "./registry"

const MODES: [Mode, string][] = [
  ["dark", "Dark mode"],
  ["light", "Light mode"],
  ["system", "Follow the system"],
]

export function themeCommands(deps: {
  mode: () => Mode
  darkTheme: () => DarkThemeId
  setMode: (mode: Mode) => void
  setBuiltin: (id: ThemeId) => void
  imported: () => Imported
  setTheme: (appearance: ThemeAppearance, id: string) => void
  preview: (look: { mode?: Mode; darkTheme?: DarkThemeId; active?: Imported["active"] }) => () => void
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
        const themes: [ThemeAppearance, string, string, string?][] = imported.themes.map(
          (t): [ThemeAppearance, string, string, string] => [t.appearance, t.id, t.name, t.source],
        )
        return [
          ...MODES.map(([mode, title]): Choice => ({
            id: `mode.${mode}`,
            title,
            icon: "appearance",
            group: "Mode",
            current: deps.mode() === mode,
            preview: () => deps.preview({ mode }),
            run: () => deps.setMode(mode),
          })),
          ...themes.map(([appearance, id, title, source]): Choice => ({
            id: `theme.${appearance}.${id || "kiko"}`,
            title,
            detail: source ?? `${appearance === "dark" ? "Dark" : "Light"} theme`,
            icon: "appearance",
            group: "Theme",
            current: shown === appearance && (imported.active[appearance] ?? "") === id,
            preview: () =>
              deps.preview({ mode: appearance, active: { ...imported.active, [appearance]: id || undefined } }),
            run: () => deps.setTheme(appearance, id),
          })),
          ...THEME_IDS.map((id): Choice => {
            const mode = id === "snow" ? "light" : "dark"
            return {
              id: `builtin.${id}`,
              title: THEMES[id].label,
              icon: "appearance",
              group: "Theme",
              swatch: THEMES[id].accent,
              current: shown === mode && !imported.active[mode] && (id === "snow" || deps.darkTheme() === id),
              preview: () =>
                deps.preview({
                  mode,
                  ...(id === "snow" ? {} : { darkTheme: id }),
                  active: { ...imported.active, [mode]: undefined },
                }),
              run: () => deps.setBuiltin(id),
            }
          }),
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
