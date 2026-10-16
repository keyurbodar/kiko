import { describe, expect, test } from "bun:test"
import type { ImportedTheme } from "@kiko/theme/imported"
import { themeCommands } from "./theme-commands"

const dracula: ImportedTheme = {
  id: "dracula-theme.dracula/dracula",
  name: "Dracula",
  source: "dracula-theme.dracula",
  appearance: "dark",
  accent: "#bd93f9",
  palette: { canvas: "#282a36", sidebar: "#21222c", text: "#f8f8f2", muted: "#a0a4b8", faint: "#6272a4", action: "#bd93f9", actionHover: "#caa9fa", onAction: "#282a36", danger: "#ff5555", gold: "#f1fa8c" },
}

describe("theme commands", () => {
  const set: string[] = []
  const previews: unknown[] = []
  const list = themeCommands({
    mode: () => "dark",
    accent: () => "azure",
    setMode: (m) => set.push(m),
    setAccent: (a) => set.push(a),
    activeAgent: () => null,
    imported: () => ({ themes: [dracula], active: {} }),
    setTheme: (appearance, id) => set.push(`theme:${appearance}:${id}`),
    preview: (look) => {
      previews.push(look)
      return () => set.push("restore")
    },
    changeAvatar() {},
    openView: (id) => set.push(`view:${id}`),
  })
  const change = list.find((c) => c.id === "theme.change")!

  test("one submenu holds the appearances and the accents, and marks the ones in use", () => {
    const choices = change.submenu!()
    expect(choices.filter((c) => c.current).map((c) => c.title)).toEqual(["Dark mode", "Kiko dark", "Azure accent"])
    expect(choices.map((c) => c.title)).toContain("Follow the system")
    expect(choices.map((c) => c.title)).toContain("Matcha accent")
  })

  test("every theme is a row: Kiko's own and each imported one", () => {
    const themes = change.submenu!().filter((c) => c.group === "Theme")
    expect(themes.map((c) => c.title)).toEqual(["Kiko dark", "Kiko light", "Dracula"])
    expect(themes.filter((c) => c.current).map((c) => c.title)).toEqual(["Kiko dark"])
  })

  test("a theme previews its appearance and its own palette, and choosing it saves both", () => {
    const row = change.submenu!().find((c) => c.title === "Dracula")!
    previews.length = 0
    set.length = 0
    row.preview!()()
    row.run()
    expect(previews).toEqual([{ mode: "dark", active: { dark: dracula.id } }])
    expect(set).toEqual(["restore", `theme:dark:${dracula.id}`])
  })

  test("Kiko's own theme previews with no imported theme for its appearance", () => {
    previews.length = 0
    change.submenu!().find((c) => c.title === "Kiko light")!.preview!()
    expect(previews).toEqual([{ mode: "light", active: { light: undefined } }])
  })

  test("an accent previews itself", () => {
    previews.length = 0
    change.submenu!().find((c) => c.id === "accent.matcha")!.preview!()
    expect(previews).toEqual([{ accent: "matcha" }])
  })

  test("choosing sets the mode or the accent, and the command itself opens the submenu", () => {
    const choices = change.submenu!()
    choices.find((c) => c.id === "mode.light")!.run()
    choices.find((c) => c.id === "accent.matcha")!.run()
    change.run()
    expect(set.slice(-3)).toEqual(["light", "matcha", "view:theme.change"])
  })
})
