import { describe, expect, test } from "bun:test"
import { newRoomId } from "../../sync/user-store"
import { formatBytes, shortDate, startedAt } from "./format"
import { clampWidth, closeFile, closeInfo, DEFAULT_WIDTH, FILE_DEFAULT_WIDTH, infoOpen, infoSections, infoTab, infoView, openFile, openFilePath, openInfo, panelWidth, popInfo, pushInfo, registerInfoSection, toggleFiles, toggleInfo } from "./state"

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

  test("an open file widens the panel for its chat only, and closing it restores the width", () => {
    closeInfo()
    openFile("room-a", "notes/plan.md")
    expect([infoOpen(), infoTab(), openFilePath("room-a"), openFilePath("room-b")]).toEqual([true, "files", "notes/plan.md", null])
    expect([panelWidth("room-a"), panelWidth("room-b")]).toEqual([FILE_DEFAULT_WIDTH, DEFAULT_WIDTH])
    openInfo()
    expect(panelWidth("room-a")).toBe(DEFAULT_WIDTH)
    openFile("room-a", null)
    expect(openFilePath("room-a")).toBeNull()
    openFile("room-a", "x.ts")
    closeFile("room-a")
    expect([infoOpen(), openFilePath("room-a"), panelWidth("room-a")]).toEqual([true, null, DEFAULT_WIDTH])
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
