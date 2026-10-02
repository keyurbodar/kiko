import { describe, expect, test } from "bun:test"
import { katCommands } from "../commands/kat-commands"
import { registerCommands } from "../commands/registry"
import { runSlash, slashSuggestions } from "../composer/slash"
import { paletteRows } from "./model"

const deps = (over: { newChat?: () => void } = {}) => ({
  toggleSidebar() {},
  newChat: over.newChat ?? (() => {}),
  closeChat() {},
  hasActiveChat: () => false,
  openPalette() {},
  openChats() {},
})

describe("palette rows", () => {
  const list = katCommands(deps())

  test("keep registry order, drop disabled commands and the palette itself", () => {
    const titles = paletteRows(list).map((c) => c.title)
    expect(titles).toEqual(["view: toggle sidebar", "chat: new", "chats: go to chat..."])
  })

  test("palette.open and chats.go are enabled", () => {
    expect(list.find((c) => c.id === "palette.open")?.when).toBeUndefined()
    expect(list.find((c) => c.id === "chats.go")?.when).toBeUndefined()
  })
})

describe("slash commands", () => {
  test("/new runs chat.new and is consumed; /remind is sent as text", () => {
    let made = 0
    const off = registerCommands(katCommands(deps({ newChat: () => made++ })))
    expect(runSlash("/new")).toBe(true)
    expect(made).toBe(1)
    expect(runSlash("/remind me at 5")).toBe(false)
    expect(slashSuggestions().map((s) => s.label)).toEqual(["/new", "/remind", "/skill:"])
    off()
    expect(slashSuggestions().map((s) => s.label)).toEqual(["/remind", "/skill:"])
  })
})
