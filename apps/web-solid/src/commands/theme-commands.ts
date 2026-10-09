import type { Mode } from "../theme/look"
import type { Command } from "./registry"

/*
 * Switching the look from the palette: one command per appearance, and changing the open
 * chat's bird. The pure table; `use-kat-commands.ts` wires it.
 */
export function themeCommands(deps: {
  setMode: (mode: Mode) => void
  activeAgent: () => string | null
  changeBird: (slug: string) => void
}): Command[] {
  const modes: [Mode, string][] = [
    ["dark", "Dark mode"],
    ["light", "Light mode"],
    ["system", "Follow the system"],
  ]
  return [
    ...modes.map(([mode, title]): Command => ({ id: `theme.mode.${mode}`, title, group: "theme", icon: "appearance", run: () => deps.setMode(mode) })),
    {
      id: "chat.change-bird",
      title: "Change bird",
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
