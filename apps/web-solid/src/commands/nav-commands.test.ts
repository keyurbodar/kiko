import { beforeEach, describe, expect, test } from "bun:test"
import { closeSettings, settingsSection } from "../settings/dialog-state"
import { navCommands } from "./nav-commands"

describe("nav commands", () => {
  const went: string[] = []
  const list = navCommands({ go: (h) => went.push(h), signOut() {}, chooseModel() {}, openView() {}, canReason: () => true, reasoningChoices: () => [] })
  const command = (id: string) => {
    const found = list.find((c) => c.id === id)
    if (!found) throw new Error(`no command ${id}`)
    return found
  }
  const pages = () => command("settings.pages").submenu?.() ?? []

  beforeEach(() => {
    went.length = 0
    closeSettings()
  })

  test("every title is sentence case with no group prefix, and every id is unique", () => {
    for (const c of list) expect(c.title).toMatch(/^[A-Z][^:A-Z]*$/)
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
  })

  test("chats is a route, and the settings commands open the dialog without leaving the chat", () => {
    command("go.chat").run()
    expect(went).toEqual(["/chat"])
    command("settings.models").run()
    expect(settingsSection()).toBe("models")
    expect(went).toEqual(["/chat"])
  })

  test("the settings shortcut opens the dialog on models, and closes it when it is open on any section", () => {
    command("settings.open").run()
    expect(settingsSection()).toBe("models")
    command("settings.open").run()
    expect(settingsSection()).toBeNull()
    for (const page of pages()) if (page.id === "account") page.run()
    expect(settingsSection()).toBe("account")
    command("settings.open").run()
    expect(settingsSection()).toBeNull()
  })

  test("the settings submenu has every page and opens the dialog on it", () => {
    expect(pages().map((p) => p.title)).toEqual(["Models", "Tools", "Appearance", "General", "Keyboard shortcuts", "Account"])
    const opened = pages().map((p) => {
      p.run()
      return settingsSection()
    })
    expect(opened).toEqual(["models", "tools", "appearance", "general", "keyboard", "account"])
    expect(went).toEqual([])
  })

  test("the first-run path has a command", () => {
    expect(command("settings.models").title).toBe("Models and providers")
  })

  test("chats, settings and the model have shortcuts, and all work in a text field", () => {
    expect(list.filter((c) => c.shortcut).map((c) => [c.id, c.shortcut, c.global])).toEqual([
      ["settings.open", "Mod+,", true],
      ["chat.model", "Mod+Shift+M", true],
    ])
  })
})
