import { describe, expect, test } from "bun:test"
import { hotkeyOptions } from "./hotkeys"
import { katCommands } from "./kat-commands"
import { commands, registerCommands, runCommand, shortcuts, type Command } from "./registry"

const make = (id: string, extra: Partial<Command> = {}): Command => ({
  id, title: `chat: ${id}`, group: "chat", icon: "plus", run: () => {}, ...extra,
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
  const list = katCommands({ toggleSidebar() {}, newChat() {}, newGroup() {}, closeChat() {}, hasActiveChat: () => false, toggleInfo() {}, toggleFiles() {}, openPalette() {}, openChats() {}, reopenClosed() {}, attach() {}, rename() {}, togglePin() {}, deleteChat() {}, canMove: () => false, })

  test("matches kat's map and leaves share out", () => {
    const map = Object.fromEntries(list.map((c) => [c.title, c.shortcut]))
    expect(map).toEqual({
      "view: toggle sidebar": "Mod+S",
      "chat: new": "Mod+N",
      "chat: new group": undefined,
      "chat: reopen closed": "Mod+Shift+T",
      "chat: attach file...": "Mod+O",
      "chat: rename": "F2",
      "chat: pin": "Mod+D",
      "chat: info": "Mod+I",
      "chat: files": "Mod+Shift+E",
      "chat: close": "Mod+W",
      "chat: delete": undefined,
      "chats: go to chat...": "Mod+P",
      "palette: open": "Mod+K",
    })
    for (const c of list) expect(c.title).toBe(c.title.toLowerCase())
  })

  test("new chat answers to Mod+N and keeps Mod+T as an alias", () => {
    const c = list.find((x) => x.id === "chat.new")!
    expect([c.shortcut, c.alias]).toEqual(["Mod+N", "Mod+T"])
  })

  test("only the sidebar toggle, chat info and files, and the palette are global", () => {
    expect(list.filter((c) => c.global).map((c) => c.id).sort()).toEqual(["chat.files", "chat.info", "chats.go", "palette.open", "view.toggle-sidebar"])
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
