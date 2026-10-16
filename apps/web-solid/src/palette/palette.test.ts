import { describe, expect, test } from "bun:test"
import { testDeps } from "../commands/deps.fixture"
import { katCommands } from "../commands/kat-commands"
import { registerCommands, type Choice } from "../commands/registry"
import { runSlash, slashSuggestions } from "../composer/slash"
import { backspaceLeaves, keyChips, listed, matchScore, viewFor } from "./model"
import { backView, closePalette, enterView, openPalette, paletteStack } from "./state"

const choice = (id: string, run = () => {}): Choice => ({ id, title: `Option ${id}`, run })
const list = katCommands(testDeps({ chatChoices: () => [choice("a"), choice("b")], agentChoices: () => [choice("kiko")] }))

describe("palette rows", () => {
  test("keep registry order, drop disabled commands and the palette itself", () => {
    expect(listed(list).map((c) => c.title)).toEqual([
      "Toggle sidebar",
      "New chat",
      "New chat with…",
      "New group",
      "New agent",
      "Reopen closed chat",
      "Go to chat…",
      "Search all chats",
    ])
  })

  test("sit under their group's heading, groups in registry order", () => {
    const groups = viewFor([], list).groups.map((g) => [g.label, g.items.map((i) => i.key)])
    expect(groups).toEqual([
      ["View", ["view.toggle-sidebar"]],
      ["Chat", ["chat.new", "chat.new-with", "chat.new-group", "chat.new-agent", "chat.reopen"]],
      ["Chats", ["chats.go", "chats.search-all"]],
    ])
  })

  test("a command with a submenu shows a chevron target; the others run", () => {
    const items = viewFor([], list).groups.flatMap((g) => g.items)
    expect(items.filter((i) => i.submenu).map((i) => i.submenu)).toEqual(["chat.new-with", "chats.go"])
  })
})

describe("submenus", () => {
  test("entering a command lists its choices, with the command's search hint", () => {
    const view = viewFor(["chats.go"], list)
    expect(view.placeholder).toBe("Go to chat…")
    expect(view.groups).toHaveLength(1)
    expect(view.groups[0]!.label).toBeNull()
    expect(view.groups[0]!.items.map((i) => i.title)).toEqual(["Option a", "Option b"])
  })

  test("choosing an option runs it", () => {
    const ran: string[] = []
    const mine = katCommands(testDeps({ agentChoices: () => [choice("kiko", () => ran.push("kiko"))] }))
    viewFor(["chat.new-with"], mine).groups[0]!.items[0]!.run()
    expect(ran).toEqual(["kiko"])
  })

  test("a submenu whose command left or is disabled falls back to the root", () => {
    expect(viewFor(["nope"], list).groups.length).toBeGreaterThan(1)
  })

  test("the stack goes in and back out, and closing clears it", () => {
    openPalette()
    expect(paletteStack()).toEqual([])
    enterView("chats.go")
    expect(paletteStack()).toEqual(["chats.go"])
    backView()
    expect(paletteStack()).toEqual([])
    backView()
    expect(paletteStack()).toEqual([])
    openPalette("chats.go")
    expect(paletteStack()).toEqual(["chats.go"])
    closePalette()
    expect(paletteStack()).toBeNull()
    enterView("chats.go")
    expect(paletteStack()).toBeNull()
  })

  test("Backspace leaves a submenu only when the search is empty", () => {
    expect(backspaceLeaves(["chats.go"], "")).toBe(true)
    expect(backspaceLeaves(["chats.go"], "al")).toBe(false)
    expect(backspaceLeaves([], "")).toBe(false)
  })
})

describe("search", () => {
  test("matches the title, then its heading, then letters in order, and never an id", () => {
    expect(matchScore("", "New chat", "Chat")).toBe(1)
    expect(matchScore("new", "New chat", "Chat")).toBe(1)
    expect(matchScore("chat", "New chat", "Chat")).toBe(1)
    expect(matchScore("sett", "Open settings page…", "Settings")).toBeGreaterThan(matchScore("sett", "Models", "Settings"))
    expect(matchScore("ncw", "New chat with…", "Chat")).toBeGreaterThan(0)
    expect(matchScore("theme", "Choose model", "Chat")).toBe(0)
    expect(matchScore("new chat", "New chat with…", "Chat")).toBeGreaterThan(0)
  })
})

describe("key chips", () => {
  test("split a Windows or Linux chord by key and a Mac chord by symbol", () => {
    expect(keyChips("Ctrl+Shift+T")).toEqual(["Ctrl", "Shift", "T"])
    expect(keyChips("Ctrl+,")).toEqual(["Ctrl", ","])
    expect(keyChips("⌘⇧T")).toEqual(["⌘", "⇧", "T"])
    expect(keyChips("⌘⇧F2")).toEqual(["⌘", "⇧", "F2"])
    expect(keyChips("F2")).toEqual(["F2"])
  })
})

describe("slash commands", () => {
  test("/new runs chat.new and is consumed; /remind is sent as text", () => {
    let made = 0
    const off = registerCommands(katCommands(testDeps({ newChat: () => made++ })))
    expect(runSlash("/new")).toBe(true)
    expect(made).toBe(1)
    expect(runSlash("/remind me at 5")).toBe(false)
    expect(slashSuggestions().map((s) => s.label)).toEqual(["/new", "/remind", "/skill:"])
    off()
    expect(slashSuggestions().map((s) => s.label)).toEqual(["/remind", "/skill:"])
  })
})
