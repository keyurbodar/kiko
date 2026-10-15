import { describe, expect, test } from "bun:test"
import { hotkeyOptions } from "./hotkeys"
import { katCommands } from "./kat-commands"
import { commands, registerCommands, runCommand, shortcuts, type Command } from "./registry"

const make = (id: string, extra: Partial<Command> = {}): Command => ({
  id, title: `Run ${id}`, group: "chat", icon: "plus", run: () => {}, ...extra,
})

describe("registry", () => {
  test("a registered command runs, and leaves when unregistered", () => {
    let ran = 0
    const off = registerCommands([make("a", { run: () => ran++ })])
    expect(runCommand("a")).toBe(true)
    expect(ran).toBe(1)
    off()
    expect(runCommand("a")).toBe(false)
    expect(ran).toBe(1)
  })

  test("a disabled command does not run", () => {
    let ran = 0
    const off = registerCommands([make("b", { when: () => false, run: () => ran++ })])
    expect(runCommand("b")).toBe(false)
    expect(ran).toBe(0)
    off()
  })

  test("a stale unregister does not remove a newer entry with the same id", () => {
    const off1 = registerCommands([make("c")])
    const off2 = registerCommands([make("c")])
    off1()
    expect(commands().filter((x) => x.id === "c")).toHaveLength(1)
    off2()
    expect(commands().filter((x) => x.id === "c")).toHaveLength(0)
  })
})

describe("kat commands", () => {
  const list = katCommands({ toggleSidebar() {}, newChat() {}, closeChat() {}, hasActiveChat: () => false, toggleCard() {}, openFiles() {}, openPalette() {}, openChats() {}, reopenClosed() {}, attach() {}, rename() {}, togglePin() {}, deleteChat() {}, canMove: () => false, goToChat() {}, stepChat() {}, chatCount: () => 0, searchChat() {}, searchAll() {}, inRichEditor: () => false })

  test("matches kat's map and leaves share out", () => {
    const map = Object.fromEntries(list.filter((c) => !c.unlisted).map((c) => [c.title, c.shortcut]))
    expect(map).toEqual({
      "Toggle sidebar": "Mod+\\",
      "New chat": "Mod+N",
      "New group": undefined,
      "Reopen closed chat": undefined,
      "Attach file…": "Mod+O",
      "Rename chat": "F2",
      "Pin chat": undefined,
      "Chat details": "Mod+I",
      "Files": undefined,
      "Close chat": undefined,
      "Delete chat": undefined,
      "Go to chat…": "Mod+P",
      "Previous chat": "Alt+ArrowUp",
      "Next chat": "Alt+ArrowDown",
      "Search messages in this chat": "Mod+F",
      "Search all chats": "Mod+Shift+F",
      "Open command palette": "Mod+K",
    })
    // Sentence case, and no group prefix: the palette shows the group as a heading.
    for (const c of list) expect(c.title).toMatch(/^[A-Z][^:A-Z]*$/)
  })

  test("new chat answers to Mod+N and has no alias", () => {
    const c = list.find((x) => x.id === "chat.new")!
    expect([c.shortcut, c.alias]).toEqual(["Mod+N", undefined])
  })

  test("the sidebar toggle, new chat, chat info, chat stepping, search, and the palette are global", () => {
    expect(list.filter((c) => c.global && !c.unlisted).map((c) => c.id).sort()).toEqual(["chat.info", "chat.new", "chats.go", "chats.next", "chats.previous", "chats.search-all", "chats.search-current", "palette.open", "view.toggle-sidebar"])
  })

  test("non-global shortcuts ignore text fields, global ones do not", () => {
    for (const c of list) expect(hotkeyOptions(c).ignoreInputs).toBe(!c.global)
  })

  test("a passive shortcut leaves the key for the dialog above it, and others consume it", () => {
    const passive = hotkeyOptions({ id: "x", title: "x: y", group: "chat", icon: "close", shortcut: "Escape", passive: true, run() {} })
    expect([passive.preventDefault, passive.stopPropagation]).toEqual([false, false])
    for (const c of list) expect([hotkeyOptions(c).preventDefault, hotkeyOptions(c).stopPropagation]).toEqual([true, true])
  })

  test("the cheatsheet lists every shortcut once", () => {
    const off = registerCommands(list)
    const ids = shortcuts().map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("view.toggle-sidebar")
    expect(ids).not.toContain("chat.delete")
    off()
  })
})

describe("the palette steps aside for the rich editor's link key", () => {
  const kat = (inRichEditor: boolean, openPalette: () => void) =>
    katCommands({ toggleSidebar() {}, newChat() {}, closeChat() {}, hasActiveChat: () => false, toggleCard() {}, openFiles() {}, openPalette, openChats() {}, reopenClosed() {}, attach() {}, rename() {}, togglePin() {}, deleteChat() {}, canMove: () => false, goToChat() {}, stepChat() {}, chatCount: () => 0, searchChat() {}, searchAll() {}, inRichEditor: () => inRichEditor })

  test("Mod+K does not open the palette while focus is in the composer", () => {
    let opened = 0
    const off = registerCommands(kat(true, () => opened++))
    expect(runCommand("palette.open")).toBe(false)
    expect(opened).toBe(0)
    off()
  })

  test("Mod+K still opens the palette everywhere else", () => {
    let opened = 0
    const off = registerCommands(kat(false, () => opened++))
    expect(runCommand("palette.open")).toBe(true)
    expect(opened).toBe(1)
    off()
  })
})

describe("numbered chat jumps", () => {
  test("Mod+1 to Mod+9 open the sidebar's chats in order, only as many as there are", () => {
    const went: number[] = []
    const jumps = katCommands({ toggleSidebar() {}, newChat() {}, closeChat() {}, hasActiveChat: () => false, toggleCard() {}, openFiles() {}, openPalette() {}, openChats() {}, reopenClosed() {}, attach() {}, rename() {}, togglePin() {}, deleteChat() {}, canMove: () => false, goToChat: (n) => went.push(n), stepChat() {}, chatCount: () => 2, searchChat() {}, searchAll() {}, inRichEditor: () => false }).filter((c) => c.id.startsWith("chats.go-"))
    expect(jumps.map((c) => c.shortcut)).toEqual(["Mod+1", "Mod+2", "Mod+3", "Mod+4", "Mod+5", "Mod+6", "Mod+7", "Mod+8", "Mod+9"])
    expect(jumps.map((c) => c.when!())).toEqual([true, true, false, false, false, false, false, false, false])
    jumps[1]!.run()
    expect(went).toEqual([2])
    expect(jumps.every((c) => c.unlisted)).toBe(true)
  })
})
