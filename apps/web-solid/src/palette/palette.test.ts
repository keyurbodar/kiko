import { describe, expect, test } from "bun:test"
import { testDeps } from "../commands/deps.fixture"
import { katCommands } from "../commands/kat-commands"
import { registerCommands, type Choice } from "../commands/registry"
import { runSlash, slashSuggestions } from "../composer/slash"
import { fileHits, listFiles } from "../files/go-to"
import { backspaceLeaves, emptyText, enterLabel, keyChips, listed, matchScore, rowScore, searchGroups, viewFor } from "./model"
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
    ])
  })

  test("sit under their group's heading, groups in registry order", () => {
    const groups = viewFor([], list).groups.map((g) => [g.label, g.items.map((i) => i.key)])
    expect(groups).toEqual([
      ["View", ["view.toggle-sidebar"]],
      ["Chat", ["chat.new", "chat.new-with", "chat.new-group", "chat.new-agent", "chat.reopen"]],
      ["Chats", ["chats.go"]],
      ["Recent chats", ["a", "b"]],
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
    expect(slashSuggestions().map((s) => s.label)).toEqual(["/new", "/remind", "/skill"])
    off()
    expect(slashSuggestions().map((s) => s.label)).toEqual(["/remind", "/skill"])
  })
})

describe("go to file", () => {
  const hits = fileHits(["src/app.ts", "notes/todo.md"], ["todo.txt"])
  const opened: string[] = []
  const mine = katCommands(
    testDeps({
      hasActiveChat: () => true,
      fileSearch: (query) =>
        listFiles(hits, query, []).map(({ hit, group }) => ({ id: hit.path, title: hit.name, detail: hit.shown, file: hit.path, group, run: () => opened.push(hit.path) })),
    }),
  )
  const command = mine.find((c) => c.id === "files.go")!

  test("sits in the root list with a chevron, and needs an open chat", () => {
    expect(viewFor([], mine).groups.flatMap((g) => g.items).find((i) => i.key === "files.go")).toMatchObject({ title: "Go to file…", submenu: "files.go", shortcut: "Mod+Shift+O" })
    expect(listed(katCommands(testDeps())).map((c) => c.id)).not.toContain("files.go")
  })

  test("its view takes its rows from the query, with a two line row and an Open file footer", () => {
    const view = viewFor(["files.go"], mine)
    expect([view.placeholder, enterLabel(view), view.groups]).toEqual(["Search files…", "Open file", []])
    const groups = searchGroups(view.parent!, "todo")
    expect(groups.map((g) => [g.label, g.items.map((i) => [i.title, i.detail, i.file])])).toEqual([
      ["This chat", [["todo.md", "notes/todo.md", "notes/todo.md"]]],
      ["Home", [["todo.txt", "todo.txt", "home/todo.txt"]]],
    ])
  })

  test("choosing a row opens that file", () => {
    searchGroups(command, "app")[0]!.items[0]!.run()
    expect(opened).toEqual(["src/app.ts"])
  })

  test("a view with no rows says why", () => {
    expect(emptyText(command, "")).toBe("No files yet")
    expect(emptyText(command, "zzz")).toBe("No matching files")
    expect(searchGroups(command, "zzz")).toEqual([])
    expect(enterLabel(viewFor([], mine))).toBe("Select")
  })
})

describe("chats in the root list", () => {
  const many = Array.from({ length: 8 }, (_, i) => choice(`c${i}`))
  const chats = katCommands(testDeps({ chatChoices: () => many }))
  const group = (typed: boolean) => viewFor([], chats, typed).groups.find((g) => g.items.some((i) => i.chat))

  test("nothing typed lists the five latest as recent chats", () => {
    expect([group(false)?.label, group(false)?.items.map((i) => i.key)]).toEqual(["Recent chats", ["c0", "c1", "c2", "c3", "c4"]])
  })

  test("typing offers every chat to search", () => {
    expect([group(true)?.label, group(true)?.items.length]).toEqual(["Chats", 8])
  })

  test("a leading > asks for commands only", () => {
    expect(rowScore(">new", "New chat", "Chat", false)).toBeGreaterThan(0)
    expect(rowScore(">new", "New project", "Chats", true)).toBe(0)
    expect(rowScore("new", "New project", "Chats", true)).toBeGreaterThan(0)
    expect(rowScore(">", "New chat", "Chat", false)).toBe(1)
  })
})

describe("marking a search", () => {
  test("a search view that highlights carries the query to every row", () => {
    const parent = { ...katCommands(testDeps({ hasActiveChat: () => true, fileSearch: () => [choice("x")] })).find((c) => c.id === "files.go")!, highlight: true }
    expect(searchGroups(parent, " Opt ")[0]!.items[0]!.mark).toBe("Opt")
    expect(searchGroups({ ...parent, highlight: false }, "Opt")[0]!.items[0]!.mark).toBeUndefined()
  })

  test("a late search says it is searching or cannot be reached, then falls back to its empty text", () => {
    const base = katCommands(testDeps({ hasActiveChat: () => true })).find((c) => c.id === "files.go")!
    expect(emptyText({ ...base, state: () => "loading" }, "a")).toBe("Searching…")
    expect(emptyText({ ...base, state: () => "error" }, "a")).toBe("Search is not reachable")
    expect(emptyText({ ...base, state: () => undefined }, "a")).toBe("No matching files")
  })
})

describe("slash openers", () => {
  test("/file opens the file search once a chat is open", () => {
    const off = registerCommands(katCommands(testDeps({ hasActiveChat: () => true, openView: (id) => openPalette(id) })))
    expect(slashSuggestions().map((s) => s.label)).toContain("/file")
    expect(runSlash("/file")).toBe(true)
    expect(paletteStack()).toEqual(["files.go"])
    closePalette()
    off()
    expect(slashSuggestions().map((s) => s.label)).not.toContain("/file")
  })
})

describe("message search view", () => {
  test("is the Mod+Shift+F command: a search view that asks for hits as you type and opens the message on Enter", async () => {
    const { messageSearchCommand } = await import("../commands/message-search")
    const command = messageSearchCommand({ open() {}, openView() {} })
    expect([command.id, command.shortcut, command.global, command.enter, command.highlight]).toEqual(["chats.search-all", "Mod+Shift+F", true, "Open message", undefined])
    expect(command.onQuery).toBeFunction()
    expect(command.search!("")).toEqual([])
    expect(emptyText(command, "")).toBe("Type to search every chat")
  })
})
