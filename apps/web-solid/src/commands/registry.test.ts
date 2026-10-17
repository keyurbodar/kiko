import { describe, expect, test } from "bun:test"
import { hotkeyOptions } from "./hotkeys"
import { testDeps } from "./deps.fixture"
import { katCommands } from "./kat-commands"
import { bindKey, resetAllKeys } from "./bindings"
import { commands, keysOf, registerCommands, runCommand, shortcutOf, type Command } from "./registry"

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
  const list = katCommands(testDeps())

  test("matches kat's map and leaves share out", () => {
    const map = Object.fromEntries(list.filter((c) => !c.unlisted).map((c) => [c.title, c.shortcut]))
    expect(map).toEqual({
      "Toggle sidebar": "Mod+\\",
      "Toggle right panel": undefined,
      "New chat": "Mod+Shift+O",
      "New chat with…": undefined,
      "New group": undefined,
      "New agent": undefined,
      "Reopen closed chat": undefined,
      "Attach file…": "Mod+O",
      "Rename chat": "F2",
      "Pin chat": undefined,
      "Chat details": "Mod+I",
      "Open files": undefined,
      "Open memory": undefined,
      "Open routines": undefined,
      "Copy chat link": undefined,
      "Close chat": undefined,
      "Delete chat": undefined,
      "Go to chat…": "Mod+P",
      "Go to file…": "Mod+Shift+E",
      "Previous chat": "Alt+ArrowUp",
      "Next chat": "Alt+ArrowDown",
      "Search messages in this chat": "Mod+F",
      "Open command palette": "Mod+K",
    })
    // Sentence case, and no group prefix: the palette shows the group as a heading.
    for (const c of list) expect(c.title).toMatch(/^[A-Z][^:A-Z]*$/)
  })

  test("no default key is one the browser keeps or one that switches its tabs", () => {
    for (const mac of [true, false]) {
      const keys = katCommands(testDeps({ mac })).flatMap((c) => [c.shortcut, c.alias]).filter(Boolean)
      for (const k of ["Mod+N", "Mod+T", "Mod+W", "Mod+Shift+N", "Mod+Shift+T", "Mod+Shift+W", ...Array.from({ length: 9 }, (_, i) => `Mod+${i + 1}`)]) expect(keys).not.toContain(k)
    }
  })

  test("the sidebar toggle, new chat, chat info, chat stepping, search, and the palette are global", () => {
    expect(list.filter((c) => c.global && !c.unlisted).map((c) => c.id).sort()).toEqual(["chat.attach", "chat.new", "chats.go", "chats.next", "chats.previous", "chats.search-current", "files.go", "palette.open", "view.toggle-sidebar"])
  })

  test("non-global shortcuts ignore text fields, global ones do not", () => {
    for (const c of list) expect(hotkeyOptions(c).ignoreInputs).toBe(!c.global)
  })

  test("a passive shortcut leaves the key for the dialog above it, and others consume it", () => {
    const passive = hotkeyOptions({ id: "x", title: "x: y", group: "chat", icon: "close", shortcut: "Escape", passive: true, run() {} })
    expect([passive.preventDefault, passive.stopPropagation]).toEqual([false, false])
    for (const c of list) expect([hotkeyOptions(c).preventDefault, hotkeyOptions(c).stopPropagation]).toEqual([true, true])
  })

  test("every command id is unique, so a saved key names one command", () => {
    const ids = list.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("Mod+K opens the palette from anywhere", () => {
  test("it fires even while a text field has focus, so the rich composer cannot swallow it", () => {
    const command = katCommands(testDeps()).find((c) => c.id === "palette.open")!
    expect(command.shortcut).toBe("Mod+K")
    expect(command.global).toBe(true)
    expect(command.when).toBeUndefined()
  })
})

describe("numbered chat jumps", () => {
  test("Control+1 to 9 on a Mac and Alt+1 to 9 elsewhere open the sidebar's chats in order, only as many as there are", () => {
    const went: number[] = []
    const jumps = katCommands(testDeps({ goToChat: (n) => went.push(n), chatCount: () => 2 })).filter((c) => c.id.startsWith("chats.go-"))
    expect(jumps.map((c) => c.shortcut)).toEqual(["Alt+1", "Alt+2", "Alt+3", "Alt+4", "Alt+5", "Alt+6", "Alt+7", "Alt+8", "Alt+9"])
    expect(katCommands(testDeps({ mac: true })).find((c) => c.id === "chats.go-1")!.shortcut).toBe("Control+1")
    expect(jumps.map((c) => c.when!())).toEqual([true, true, false, false, false, false, false, false, false])
    jumps[1]!.run()
    expect(went).toEqual([2])
    expect(jumps.every((c) => c.unlisted)).toBe(true)
  })
})

describe("the owner's own keys", () => {
  const c = make("k", { shortcut: "Mod+K", alias: "Mod+Shift+P" })

  test("a command answers to its defaults until the owner picks a key, which replaces both", () => {
    resetAllKeys()
    expect(keysOf(c)).toEqual(["Mod+K", "Mod+Shift+P"])
    bindKey("k", "Mod+J")
    expect(keysOf(c)).toEqual(["Mod+J"])
    expect(shortcutOf(c)).toBe("Mod+J")
    resetAllKeys()
  })

  test("a removed key leaves the command with none, and a reset brings the default back", () => {
    bindKey("k", null)
    expect(keysOf(c)).toEqual([])
    expect(shortcutOf(c)).toBeUndefined()
    resetAllKeys()
    expect(shortcutOf(c)).toBe("Mod+K")
  })
})
