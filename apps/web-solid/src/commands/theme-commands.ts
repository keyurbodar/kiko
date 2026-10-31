import type { Imported } from "@kiko/theme/imported"
import type { Mode } from "@kiko/theme/look"
import { appearanceOf } from "@kiko/theme/apply"
import {
  appearanceOfTheme,
  THEME_IDS,
  THEMES,
  type DarkThemeId,
  type LightThemeId,
  type ThemeAppearance,
  type ThemeId,
} from "@kiko/theme/palette"
import type { Choice, Command, CommandId } from "./registry"

const MODES: [Mode, string][] = [
  ["dark", "Dark mode"],
  ["light", "Light mode"],
  ["system", "Follow the system"],
]

export function themeCommands(deps: {
  mode: () => Mode
  builtin: () => Record<ThemeAppearance, ThemeId>
  setMode: (mode: Mode) => void
  setBuiltin: (id: ThemeId) => void
  imported: () => Imported
  setTheme: (appearance: ThemeAppearance, id: string) => void
  preview: (look: {
    mode?: Mode
    darkTheme?: DarkThemeId
    lightTheme?: LightThemeId
    active?: Imported["active"]
  }) => () => void
  activeAgent: () => string | null
  changeAvatar: (slug: string) => void
  openView: (id: CommandId) => void
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
            const mode = appearanceOfTheme(id)
            return {
              id: `builtin.${id}`,
              title: THEMES[id].label,
              icon: "appearance",
              group: "Theme",
              swatch: THEMES[id].palette.accent,
              current: shown === mode && !imported.active[mode] && deps.builtin()[mode] === id,
              preview: () =>
                deps.preview({
                  mode,
                  [mode === "dark" ? "darkTheme" : "lightTheme"]: id,
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
