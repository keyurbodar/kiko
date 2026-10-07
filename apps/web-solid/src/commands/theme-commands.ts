import type { Mode } from "../theme/look"
import type { Command } from "./registry"

/*
 * Switching the look from the palette: one command per appearance, and changing the open
 * chat's bird. The pure table; `use-kat-commands.ts` wires it. The one command per theme is
 * `themeChoiceCommands`, which `theme/live.ts` registers once the themes are loaded.
 */
export function themeCommands(deps: {
  setMode: (mode: Mode) => void
  activeAgent: () => string | null
  changeBird: (slug: string) => void
}): Command[] {
  const modes: [Mode, string][] = [
    ["dark", "theme: dark mode"],
    ["light", "theme: light mode"],
    ["system", "theme: follow the system"],
  ]
  return [
    ...modes.map(([mode, title]): Command => ({ id: `theme.mode.${mode}`, title, group: "theme", icon: "appearance", run: () => deps.setMode(mode) })),
    {
      id: "chat.change-bird",
      title: "chat: change bird",
      group: "chat",
      icon: "appearance",
      when: () => deps.activeAgent() !== null,
      run: () => {
        const slug = deps.activeAgent()
        if (slug) deps.changeBird(slug)
      },
    },
  ]
}

/** One command per theme, with null for t3code's stock palette. */
export function themeChoiceCommands(themes: readonly { id: string | null; label: string }[], setTheme: (id: string | null) => void): Command[] {
  return themes.map((t) => ({ id: `theme.use.${t.id ?? "default"}`, title: `theme: ${t.label.toLowerCase()}`, group: "theme", icon: "appearance", run: () => setTheme(t.id) }))
}
