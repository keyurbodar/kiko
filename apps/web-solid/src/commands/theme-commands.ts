import { SWATCHES } from "../theme/presets"
import type { Mode } from "../theme/look"
import type { Command } from "./registry"

/*
 * Switching the look from the palette: one command per swatch, one per appearance, and
 * changing the open chat's bird. The pure table; `use-kat-commands.ts` wires it.
 */
export function themeCommands(deps: {
  setPreset: (id: string) => void
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
    ...SWATCHES.map((s): Command => ({ id: `theme.preset.${s.id}`, title: `theme: ${s.label}`, group: "theme", icon: "appearance", run: () => deps.setPreset(s.id) })),
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
