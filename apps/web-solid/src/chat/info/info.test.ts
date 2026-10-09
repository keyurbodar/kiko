import { describe, expect, test } from "bun:test"
import { newRoomId } from "../../sync/user-store"
import { formatBytes, shortDate, startedAt } from "./format"
import { clampWidth, closeFile, closeInfo, DEFAULT_WIDTH, dropFileTabs, FILE_DEFAULT_WIDTH, fileReveal, fileTabsOf, infoOpen, infoSections, infoTab, infoView, moveFileTabs, openFile, openFilePath, openInfo, panelWidth, popInfo, pushInfo, registerInfoSection, reopenClosedFile, setActiveFile, toggleFiles, toggleInfo } from "./state"

describe("header text", () => {
  test("a room id carries its start time", () => {
    const at = Date.UTC(2026, 9, 2, 12)
    expect(startedAt(newRoomId(at))).toBe(at)
    expect(startedAt("01JZ8Q4T6M0000000000000001")).toBe(Date.parse("2025-07-03T18:00:25.556Z"))
    expect(startedAt("short")).toBeNull()
    expect(startedAt("!!!!!!!!!!0000000000000000")).toBeNull()
  })

  test("a chat started reads back as its date", () => {
    const at = new Date(2026, 9, 2, 12).getTime()
    expect(shortDate(startedAt(newRoomId(at))!)).toBe("Oct 2, 2026")
  })

  test("sizes", () => {
    expect([formatBytes(12), formatBytes(3482), formatBytes(2_500_000)]).toEqual(["12 B", "3.4 KB", "2.4 MB"])
  })
})

describe("panel state", () => {
  test("opens on home, a card pushes a list, back pops it, and the width is clamped", () => {
    closeInfo()
    expect(infoOpen()).toBe(false)
    toggleInfo()
    expect(infoOpen()).toBe(true)
    expect(infoView().kind).toBe("home")
    pushInfo({ kind: "tasks" })
    expect(infoView().kind).toBe("tasks")
    popInfo()
    popInfo()
    expect(infoView().kind).toBe("home")
    openInfo({ kind: "memory" })
    expect(infoView().kind).toBe("memory")
    popInfo()
    expect(infoView().kind).toBe("home")
    expect([clampWidth(10), clampWidth(400), clampWidth(9999)]).toEqual([280, 400, 560])
    closeInfo()
  })

  test("cmd+i and cmd+shift+e switch tabs, and close the panel only from their own tab", () => {
    closeInfo()
    toggleFiles()
    expect([infoOpen(), infoTab()]).toEqual([true, "files"])
    toggleInfo()
    expect([infoOpen(), infoTab()]).toEqual([true, "info"])
    toggleInfo()
    expect(infoOpen()).toBe(false)
    toggleFiles()
    toggleFiles()
    expect(infoOpen()).toBe(false)
  })

  test("open files widen the panel for their chat only, and closing the last restores the width", () => {
    closeInfo()
    openFile("room-a", "notes/plan.md")
    expect([infoOpen(), infoTab(), openFilePath("room-a"), openFilePath("room-b")]).toEqual([true, "files", "notes/plan.md", null])
    expect([panelWidth("room-a"), panelWidth("room-b")]).toEqual([FILE_DEFAULT_WIDTH, DEFAULT_WIDTH])
    openInfo()
    expect(panelWidth("room-a")).toBe(DEFAULT_WIDTH)
    // No path opens the files tab and leaves the tabs alone.
    openFile("room-a", null)
    expect([infoTab(), openFilePath("room-a")]).toEqual(["files", "notes/plan.md"])
    closeFile("room-a")
    expect([infoOpen(), openFilePath("room-a"), panelWidth("room-a")]).toEqual([true, null, DEFAULT_WIDTH])
    closeInfo()
  })

  test("each file is one tab, closing activates a neighbour, and closed tabs reopen newest first", () => {
    const chat = "room-tabs"
    openFile(chat, "a.ts")
    openFile(chat, "b.md")
    openFile(chat, "c.csv")
    openFile(chat, "a.ts")
    expect(fileTabsOf(chat).tabs).toEqual(["a.ts", "b.md", "c.csv"])
    expect(openFilePath(chat)).toBe("a.ts")
    setActiveFile(chat, "b.md")
    closeFile(chat)
    // The right neighbour takes over, then the left one at the end of the row.
    expect([fileTabsOf(chat).tabs, openFilePath(chat)]).toEqual([["a.ts", "c.csv"], "c.csv"])
    closeFile(chat, "c.csv")
    expect(openFilePath(chat)).toBe("a.ts")
    expect(reopenClosedFile(chat)).toBe(true)
    expect([fileTabsOf(chat).tabs, openFilePath(chat)]).toEqual([["a.ts", "c.csv"], "c.csv"])
    expect(reopenClosedFile(chat)).toBe(true)
    expect(fileTabsOf(chat).tabs).toEqual(["a.ts", "c.csv", "b.md"])
    expect(reopenClosedFile(chat)).toBe(false)
    closeInfo()
  })

  test("a rename moves the tabs under it, and a delete closes them for good", () => {
    const chat = "room-moves"
    openFile(chat, "docs/a.md")
    openFile(chat, "docs/deep/b.md")
    openFile(chat, "top.txt")
    moveFileTabs(chat, "docs", "notes")
    expect(fileTabsOf(chat).tabs).toEqual(["notes/a.md", "notes/deep/b.md", "top.txt"])
    setActiveFile(chat, "notes/deep/b.md")
    dropFileTabs(chat, "notes/deep")
    expect([fileTabsOf(chat).tabs, openFilePath(chat)]).toEqual([["notes/a.md", "top.txt"], "top.txt"])
    expect(reopenClosedFile(chat)).toBe(false)
    closeInfo()
  })

  test("a line asked for is revealed in that file only, and each ask is new", () => {
    openFile("room-line", "src/app.ts", 42)
    const first = fileReveal("room-line", "src/app.ts")
    expect(first?.line).toBe(42)
    expect(fileReveal("room-line", "other.ts")).toBeNull()
    openFile("room-line", "src/app.ts", 42)
    expect(fileReveal("room-line", "src/app.ts")!.n).toBe(first!.n + 1)
    closeInfo()
  })

  test("a registered section is listed until it leaves", () => {
    const off = registerInfoSection({ id: "notes", title: "notes", render: () => null })
    expect(infoSections().map((s) => s.id)).toEqual(["notes"])
    off()
    expect(infoSections()).toEqual([])
  })
})

import { groupTasks } from "./tasks"
import { openTasks } from "./tasks-model"

test("tasks group by status, doing first, and only open ones count", () => {
  const t = (id: string, status: "todo" | "doing" | "done" | "blocked") => ({ id, title: id, status, dependsOn: [] })
  const tasks = [t("a", "done"), t("b", "todo"), t("c", "doing"), t("d", "blocked")]
  expect(groupTasks(tasks).map((g) => g.status)).toEqual(["doing", "blocked", "todo", "done"])
  expect(openTasks(tasks).map((x) => x.id)).toEqual(["b", "c", "d"])
})
