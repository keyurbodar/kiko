import { describe, expect, it } from "vitest"
import { formatImported, parseImported, type ImportedTheme } from "./imported"

const theme: ImportedTheme = {
  id: "Catppuccin.catppuccin-vsc:extension/themes/mocha.json",
  name: "Catppuccin Mocha",
  source: "Catppuccin.catppuccin-vsc",
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
})
