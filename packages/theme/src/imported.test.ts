import { describe, expect, it } from "vitest"
import { formatImported, parseImported, type ImportedTheme } from "./imported"
import { PALETTES } from "./palette"

const theme: ImportedTheme = {
  id: "Catppuccin.catppuccin-vsc:extension/themes/mocha.json",
  name: "Catppuccin Mocha",
  source: "Catppuccin.catppuccin-vsc",
  appearance: "dark",
  palette: {
    ...PALETTES.dark,
    chrome: "#11111b",
    sidebar: "#181825",
    editor: "#1e1e2e",
    base: "#cdd6f4",
    accent: "#cba6f7",
    danger: "#f38ba8",
    warn: "#fab387",
  },
}

describe("imported themes", () => {
  it("keeps syntax colours through a save and reload", () => {
    const syntax = { keyword: "#cba6f7", string: "#a6e3a1", func: "#89b4fa", comment: "#9399b2" }
    const saved = formatImported({ themes: [{ ...theme, syntax }], active: { dark: theme.id } })
    expect(parseImported(saved).themes[0]?.syntax).toEqual(syntax)
  })

  it("still reads themes saved before syntax colours existed", () => {
    const saved = formatImported({ themes: [theme], active: {} })
    expect(parseImported(saved).themes).toEqual([theme])
  })

  it("carries a theme saved with the old ten-colour palette onto the new seeds", () => {
    const saved = JSON.stringify({
      v: 1,
      active: { dark: theme.id },
      themes: [
        {
          id: theme.id,
          name: theme.name,
          source: theme.source,
          appearance: "dark",
          accent: "#cba6f7",
          palette: {
            canvas: "#1e1e2e",
            sidebar: "#181825",
            text: "#cdd6f4",
            muted: "#cdd6f4",
            faint: "#a6adc8",
            action: "#cba6f7",
            actionHover: "#b495dc",
            onAction: "#11111b",
            danger: "#f38ba8",
            gold: "#fab387",
          },
        },
      ],
    })
    const [read] = parseImported(saved).themes
    expect(read?.palette).toMatchObject({
      editor: "#1e1e2e",
      sidebar: "#181825",
      base: "#cdd6f4",
      accent: "#cba6f7",
      danger: "#f38ba8",
      warn: "#fab387",
    })
    expect(parseImported(saved).active.dark).toBe(theme.id)
  })
})
