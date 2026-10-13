import { describe, expect, test } from "bun:test"
import { newRoomId } from "../../sync/user-store"
import { formatBytes, shortDate, startedAt } from "./format"
import { closeFile, closeInfo, dropOpenFile, fileReveal, infoOpen, infoSections, infoView, moveOpenFile, openFile, openFilePath, openInfo, openSections, popInfo, pushInfo, registerInfoSection, setSectionOpen, showSection, toggleFiles, toggleInfo } from "./state"

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
  test("opens on home, a row pushes a list, back pops it", () => {
    closeInfo()
    expect(infoOpen()).toBe(false)
    toggleInfo()
    expect(infoOpen()).toBe(true)
    expect(infoView().kind).toBe("home")
    pushInfo({ kind: "plate" })
    expect(infoView().kind).toBe("plate")
    popInfo()
    popInfo()
    expect(infoView().kind).toBe("home")
    openInfo({ kind: "memory" })
    expect(infoView().kind).toBe("memory")
    popInfo()
    expect(infoView().kind).toBe("home")
    closeInfo()
  })

  test("showing a section opens it, pops a page, and the files command closes the panel when files already shows", () => {
    closeInfo()
    setSectionOpen("agents", false)
    openInfo({ kind: "memory" })
    showSection("agents")
    expect([infoOpen(), infoView().kind, openSections().has("agents")]).toEqual([true, "home", true])
    setSectionOpen("agents", false)
    expect(openSections().has("agents")).toBe(false)
    closeInfo()
    toggleFiles()
    expect([infoOpen(), openSections().has("files")]).toEqual([true, true])
    toggleFiles()
    expect(infoOpen()).toBe(false)
  })

  test("one file is open per chat, the back arrow returns to the tree, and another file replaces it", () => {
    closeInfo()
    openFile("room-a", "notes/plan.md")
    expect([infoOpen(), openSections().has("files"), openFilePath("room-a"), openFilePath("room-b")]).toEqual([true, true, "notes/plan.md", null])
    openFile("room-a", "notes/other.md")
    expect(openFilePath("room-a")).toBe("notes/other.md")
    openFile("room-a", null)
    expect(openFilePath("room-a")).toBe("notes/other.md")
    closeFile("room-a")
    expect([infoOpen(), openFilePath("room-a")]).toEqual([true, null])
    closeInfo()
  })

  test("a rename moves the open file under it, and a delete closes it", () => {
    const chat = "room-moves"
    openFile(chat, "docs/deep/b.md")
    moveOpenFile(chat, "docs", "notes")
    expect(openFilePath(chat)).toBe("notes/deep/b.md")
    moveOpenFile(chat, "other", "x")
    expect(openFilePath(chat)).toBe("notes/deep/b.md")
    dropOpenFile(chat, "notes/other")
    expect(openFilePath(chat)).toBe("notes/deep/b.md")
    dropOpenFile(chat, "notes/deep")
    expect(openFilePath(chat)).toBeNull()
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
