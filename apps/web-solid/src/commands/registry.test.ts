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
  const list = katCommands({ toggleSidebar() {}, newChat() {}, newGroup() {}, closeChat() {}, hasActiveChat: () => false, toggleInfo() {}, toggleFiles() {}, openPalette() {}, openChats() {}, reopenClosed() {}, attach() {}, rename() {}, togglePin() {}, deleteChat() {}, canMove: () => false, goToChat() {}, stepChat() {}, chatCount: () => 0, searchChat() {}, searchAll() {}, })

  test("matches kat's map and leaves share out", () => {
    const map = Object.fromEntries(list.filter((c) => !c.unlisted).map((c) => [c.title, c.shortcut]))
    expect(map).toEqual({
      "Toggle sidebar": "Mod+S",
      "New chat": "Mod+N",
      "New group": undefined,
      "Reopen closed chat": "Mod+Shift+T",
      "Attach file…": "Mod+O",
      "Rename chat": "F2",
      "Pin chat": "Mod+D",
      "Details": "Mod+I",
      "Files": "Mod+Shift+E",
      "Close chat": "Mod+W",
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

  test("new chat answers to Mod+N and keeps Mod+T as an alias", () => {
    const c = list.find((x) => x.id === "chat.new")!
    expect([c.shortcut, c.alias]).toEqual(["Mod+N", "Mod+T"])
  })

  test("the sidebar toggle, chat info and files, chat stepping, search, and the palette are global", () => {
    expect(list.filter((c) => c.global && !c.unlisted).map((c) => c.id).sort()).toEqual(["chat.files", "chat.info", "chats.go", "chats.next", "chats.previous", "chats.search-all", "chats.search-current", "palette.open", "view.toggle-sidebar"])
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
    expect(ids).toContain("chat.close")
    expect(ids).not.toContain("chat.delete")
    off()
  })
})

describe("numbered chat jumps", () => {
  test("Mod+1 to Mod+9 open the sidebar's chats in order, only as many as there are", () => {
    const went: number[] = []
    const jumps = katCommands({ toggleSidebar() {}, newChat() {}, newGroup() {}, closeChat() {}, hasActiveChat: () => false, toggleInfo() {}, toggleFiles() {}, openPalette() {}, openChats() {}, reopenClosed() {}, attach() {}, rename() {}, togglePin() {}, deleteChat() {}, canMove: () => false, goToChat: (n) => went.push(n), stepChat() {}, chatCount: () => 2, searchChat() {}, searchAll() {} }).filter((c) => c.id.startsWith("chats.go-"))
    expect(jumps.map((c) => c.shortcut)).toEqual(["Mod+1", "Mod+2", "Mod+3", "Mod+4", "Mod+5", "Mod+6", "Mod+7", "Mod+8", "Mod+9"])
    expect(jumps.map((c) => c.when!())).toEqual([true, true, false, false, false, false, false, false, false])
    jumps[1]!.run()
    expect(went).toEqual([2])
    expect(jumps.every((c) => c.unlisted)).toBe(true)
  })
})
