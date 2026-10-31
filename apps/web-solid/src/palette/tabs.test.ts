import { describe, expect, it } from "vitest"
import type { Choice } from "../commands/registry"
import type { Item } from "./model"
import type { FileEntry } from "./sources"
import { sinceLabel, tabGroups, type TabData } from "./tabs"

const NOW = Date.UTC(2026, 9, 24, 12)
const DAY = 24 * 60 * 60 * 1000

const chat = (id: string, title: string, ago: number, extra: Partial<Choice> = {}): Choice => ({
  id,
  title,
  chatId: id,
  detail: `last words in ${title}`,
  at: NOW - ago,
  run: () => undefined,
  ...extra,
})

const command = (key: string, title: string): Item => ({ key, title, icon: "plus", run: () => undefined })

const file = (path: string, size = 1024): FileEntry => ({
  path,
  name: path,
  size,
  fileId: path,
  space: "room",
  home: false,
})

const data = (over: Partial<TabData> = {}): TabData => ({
  chats: [chat("a", "Tokyo trip", 1000), chat("b", "March invoices", 3 * DAY), chat("c", "Old plans", 20 * DAY)],
  unread: [],
  agents: [{ id: "kiko", title: "Kiko", detail: "Idle", run: () => undefined }],
  recipes: [
    { id: "r1", title: "Morning briefing", detail: "Your calendar", group: "Yours", run: () => undefined },
    { id: "r2", title: "Inbox zero", detail: "Sorts replies", group: "Templates", run: () => undefined },
  ],
  settings: [{ id: "models", title: "Models", detail: "Connect providers", run: () => undefined }],
  messages: [],
  files: [file("budget.xlsx"), file("tokyo/receipts/hotel.jpg", 2048), file("tokyo/notes.md")],
  recent: ["budget.xlsx"],
  folder: [],
  commands: [command("chat.new", "New chat"), command("chat.model", "Choose model")],
  doCommands: [command("chat.new", "New chat"), command("chat.model", "Choose model")],
  agentDo: [],
  settingsDo: [],
  now: NOW,
  open: () => undefined,
  enter: () => undefined,
  ...over,
})

const labels = (groups: { label: string | null }[]) => groups.map((g) => g.label)

describe("sinceLabel", () => {
  it("buckets a chat by how long ago it moved", () => {
    expect(sinceLabel(NOW - 1000, NOW)).toBe("Today")
    expect(sinceLabel(NOW - 3 * DAY, NOW)).toBe("This week")
    expect(sinceLabel(NOW - 20 * DAY, NOW)).toBe("Earlier")
  })

  it("changes bucket at midnight, not after 24 hours", () => {
    const earlyToday = new Date(2026, 9, 24, 0, 10).getTime()
    expect(sinceLabel(new Date(2026, 9, 23, 23, 50).getTime(), earlyToday)).toBe("This week")
    expect(sinceLabel(new Date(2026, 9, 17, 23, 50).getTime(), earlyToday)).toBe("Earlier")
  })
})

describe("All tab", () => {
  it("opens on what needs you, then recent chats, then things to do", () => {
    const needs = chat("needs.n", "Refund", 0, { chatId: "n" })
    const groups = tabGroups("all", "", data({ unread: [needs] }))
    expect(labels(groups)).toEqual(["Needs you", "Recent", "Do"])
    expect(groups[1]?.items.map((i) => i.title)).not.toContain("Refund")
  })

  it("leaves the needs-you section out when nothing waits", () => {
    expect(labels(tabGroups("all", "", data()))).toEqual(["Recent", "Do"])
  })

  it("answers a typed query with every kind of result, best match first", () => {
    const groups = tabGroups("all", "tokyo", data())
    expect(labels(groups)).toEqual(["Chats", "Files"])
    expect(groups[0]?.items[0]?.title).toBe("Tokyo trip")
  })

  it("puts commands first when the words are a command's name", () => {
    expect(labels(tabGroups("all", "new chat", data()))[0]).toBe("Commands")
  })

  it("lists only commands after a > prefix", () => {
    const groups = tabGroups("all", ">model", data())
    expect(labels(groups)).toEqual(["Commands"])
    expect(groups[0]?.items[0]?.title).toBe("Choose model")
  })

  it("finds nothing for words that match nowhere", () => {
    expect(tabGroups("all", "sushi rokkon", data())).toEqual([])
  })
})

describe("Chats tab", () => {
  it("groups chats under Today, This week and Earlier", () => {
    expect(labels(tabGroups("chats", "", data()))).toEqual(["Today", "This week", "Earlier"])
  })

  it("filters by the typed words", () => {
    const groups = tabGroups("chats", "march", data())
    expect(groups.flatMap((g) => g.items.map((i) => i.title))).toEqual(["March invoices"])
  })
})

describe("Recipes tab", () => {
  it("separates the recipes you run from the templates", () => {
    expect(labels(tabGroups("recipes", "", data()))).toEqual(["Yours", "Templates"])
  })
})

describe("Files tab", () => {
  it("starts with recent files and folders", () => {
    const groups = tabGroups("files", "", data())
    expect(labels(groups)).toEqual(["Recent", "Folders"])
    expect(groups[1]?.items[0]).toMatchObject({ title: "tokyo", folder: true, meta: "2 files" })
  })

  it("lists a folder's own folders and files with their sizes", () => {
    const groups = tabGroups("files", "", data({ folder: ["tokyo"] }))
    expect(groups.flatMap((g) => g.items.map((i) => i.title))).toEqual(["receipts", "notes.md"])
    expect(groups[0]?.items[1]?.meta).toBe("1.0 KB")
  })

  it("searches every file by name once words are typed", () => {
    const groups = tabGroups("files", "hotel", data())
    expect(groups[0]?.items.map((i) => i.title)).toEqual(["hotel.jpg"])
  })
})
