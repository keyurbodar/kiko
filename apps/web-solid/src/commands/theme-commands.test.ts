import { describe, expect, test } from "bun:test"
import { themeCommands } from "./theme-commands"

describe("theme commands", () => {
  const set: string[] = []
  const list = themeCommands({
    mode: () => "dark",
    accent: () => "azure",
    setMode: (m) => set.push(m),
    setAccent: (a) => set.push(a),
    activeAgent: () => null,
    changeAvatar() {},
    openView: (id) => set.push(`view:${id}`),
  })
  const change = list.find((c) => c.id === "theme.change")!

  test("one submenu holds the appearances and the accents, and marks the ones in use", () => {
    const choices = change.submenu!()
    expect(choices.filter((c) => c.current).map((c) => c.title)).toEqual(["Dark mode", "Azure accent"])
    expect(choices.map((c) => c.title)).toContain("Follow the system")
    expect(choices.map((c) => c.title)).toContain("Matcha accent")
  })

  test("choosing sets the mode or the accent, and the command itself opens the submenu", () => {
    const choices = change.submenu!()
    choices.find((c) => c.id === "mode.light")!.run()
    choices.find((c) => c.id === "accent.matcha")!.run()
    change.run()
    expect(set).toEqual(["light", "matcha", "view:theme.change"])
  })
})
