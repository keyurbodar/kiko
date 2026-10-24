import { describe, expect, it } from "vitest"
import {
  back,
  closeFile,
  closeFiles,
  closeRightOf,
  dropFiles,
  EMPTY_NAV,
  fileSurface,
  keepOnly,
  moveFiles,
  openView,
} from "./desk-nav"

const memory = { id: "memory", kind: "memory" } as const
const files = { id: "files", kind: "files" } as const
const a = fileSurface("notes/a.md")
const b = fileSurface("notes/b.md")

describe("desk navigation", () => {
  it("drills into a section and goes back to the overview", () => {
    const into = openView(EMPTY_NAV, memory)
    expect(into.view).toEqual(memory)
    expect(back(into).view).toBeNull()
  })

  it("stacks files and goes back from a file to the Files list", () => {
    const nav = openView(openView(EMPTY_NAV, a), b)
    expect(nav.files.map((f) => f.id)).toEqual([a.id, b.id])
    expect(nav.view).toEqual(b)
    const out = back(nav)
    expect(out.view).toEqual(files)
    expect(out.files).toHaveLength(2)
    expect(back(out).view).toBeNull()
  })

  it("reopening a file does not add a second tab", () => {
    const nav = openView(openView(openView(EMPTY_NAV, a), b), a)
    expect(nav.files.map((f) => f.id)).toEqual([a.id, b.id])
    expect(nav.view).toEqual(a)
  })

  it("closing the open file shows its neighbour, then the Files list", () => {
    const nav = openView(openView(EMPTY_NAV, a), b)
    const one = closeFile(nav, b.id)
    expect(one.view).toEqual(a)
    expect(closeFile(one, a.id)).toEqual({ files: [], view: files })
  })

  it("closing a background tab keeps the current view", () => {
    const nav = openView(openView(EMPTY_NAV, a), b)
    expect(closeFile(nav, a.id)).toEqual({ files: [b], view: b })
  })

  it("closes other tabs, tabs to the right, and all tabs", () => {
    const nav = openView(openView(EMPTY_NAV, a), b)
    expect(keepOnly(nav, a.id)).toEqual({ files: [a], view: a })
    expect(closeRightOf(nav, a.id)).toEqual({ files: [a], view: a })
    expect(closeFiles(nav)).toEqual({ files: [], view: files })
    expect(closeFiles(openView(nav, memory))).toEqual({ files: [], view: memory })
  })

  it("follows a moved folder and leaves the Files list when its file is deleted", () => {
    const nav = openView(EMPTY_NAV, a)
    const moved = moveFiles(nav, "notes", "docs")
    expect(moved.view).toEqual(fileSurface("docs/a.md"))
    expect(dropFiles(moved, "docs")).toEqual({ files: [], view: files })
  })
})
