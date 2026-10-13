import { describe, expect, test } from "bun:test"
import { navCommands } from "./nav-commands"

describe("nav commands", () => {
  const went: string[] = []
  const list = navCommands({ go: (h) => went.push(h), signOut() {}, chooseModel() {} })

  test("every title is sentence case with no group prefix, and every id is unique", () => {
    for (const c of list) expect(c.title).toMatch(/^[A-Z][^:A-Z]*$/)
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
  })

  test("each screen has a command that goes to its route", () => {
    for (const c of list.filter((x) => x.id.startsWith("go.") || x.id.startsWith("settings."))) c.run()
    expect(went).toEqual([
      "/chat", "/settings", "/settings/providers", "/settings/models",
      "/settings/integrations", "/settings/appearance", "/settings/account",
    ])
  })

  test("the first-run path has a command", () => {
    expect(list.find((c) => c.id === "settings.providers")?.title).toBe("Providers")
  })

  test("chats, settings and the model have shortcuts, and all work in a text field", () => {
    expect(list.filter((c) => c.shortcut).map((c) => [c.id, c.shortcut, c.global])).toEqual([
      ["settings.open", "Mod+,", true],
      ["chat.model", "Mod+Shift+M", true],
    ])
  })
})
