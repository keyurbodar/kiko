import { describe, expect, it } from "vitest"
import {
  activateSurface,
  closeAll,
  closeOthers,
  closeRightOf,
  closeSurface,
  deactivate,
  dropFiles,
  EMPTY_NAV,
  fileSurface,
  moveFiles,
  moveSurface,
  openSurface,
  showInActive,
} from "./desk-nav"

const memory = { id: "memory", kind: "memory" } as const
const files = { id: "files", kind: "files" } as const
const a = fileSurface("notes/a.md")
const b = fileSurface("notes/b.md")

describe("desk navigation", () => {
  it("opens surfaces as tabs in order, activating the newest", () => {
    const nav = openSurface(openSurface(openSurface(EMPTY_NAV, memory), a), b)
    expect(nav.surfaces.map((surface) => surface.id)).toEqual(["memory", a.id, b.id])
    expect(nav.active).toBe(b.id)
  })

  it("reopening an open surface focuses its tab instead of adding a second one", () => {
    const nav = openSurface(openSurface(EMPTY_NAV, a), b)
    expect(openSurface(nav, a)).toEqual({ surfaces: [a, b], active: a.id })
    expect(openSurface({ surfaces: [a], active: a.id }, a)).toEqual({ surfaces: [a], active: a.id })
  })

  it("activating a tab and clearing the active one", () => {
    const nav = openSurface(openSurface(EMPTY_NAV, a), b)
    expect(activateSurface(nav, a.id).active).toBe(a.id)
    expect(activateSurface(nav, "missing")).toBe(nav)
    expect(deactivate(nav)).toEqual({ surfaces: [a, b], active: null })
    expect(deactivate({ surfaces: [a], active: null }).active).toBeNull()
  })

  it("closing the active tab shows its neighbour, and the last close empties the panel", () => {
    const nav = openSurface(openSurface(EMPTY_NAV, a), b)
    const one = closeSurface(nav, b.id)
    expect(one.active).toBe(a.id)
    expect(closeSurface(one, a.id)).toEqual({ surfaces: [], active: null })
  })

  it("closing a background tab keeps the current one", () => {
    const nav = openSurface(openSurface(EMPTY_NAV, a), b)
    expect(closeSurface(nav, a.id)).toEqual({ surfaces: [b], active: b.id })
  })

  it("closes other tabs, tabs to the right, and all tabs", () => {
    const nav = openSurface(openSurface(openSurface(EMPTY_NAV, memory), a), b)
    expect(closeOthers(nav, a.id)).toEqual({ surfaces: [a], active: a.id })
    expect(closeRightOf(nav, a.id)).toEqual({ surfaces: [memory, a], active: a.id })
    expect(closeAll(nav)).toEqual({ surfaces: [], active: null })
    expect(closeAll(EMPTY_NAV)).toBe(EMPTY_NAV)
  })

  it("reorders tabs by dropping one onto another", () => {
    const nav = openSurface(openSurface(openSurface(EMPTY_NAV, memory), a), b)
    expect(moveSurface(nav, b.id, "memory").surfaces.map((surface) => surface.id)).toEqual([b.id, "memory", a.id])
    expect(moveSurface(nav, "missing", "memory")).toBe(nav)
  })

  it("follows a moved folder and drops files under a deleted one", () => {
    const nav = openSurface(EMPTY_NAV, a)
    const moved = moveFiles(nav, "notes", "docs")
    expect(moved.surfaces).toEqual([fileSurface("docs/a.md")])
    expect(moved.active).toBe(fileSurface("docs/a.md").id)
    expect(dropFiles(moved, "docs")).toEqual({ surfaces: [], active: null })
  })

  it("keeps a fixed surface when its files are dropped", () => {
    const nav = openSurface(openSurface(EMPTY_NAV, files), a)
    expect(dropFiles(nav, "notes")).toEqual({ surfaces: [files], active: files.id })
  })

  it("shows another file in the active file tab, or jumps to the tab that already has it", () => {
    const nav = openSurface(openSurface(openSurface(EMPTY_NAV, memory), a), files)
    const onA = activateSurface(nav, a.id)
    const c = fileSurface("notes/c.md")
    expect(showInActive(onA, c.path)).toEqual({ surfaces: [memory, c, files], active: c.id })
    const both = openSurface(onA, b)
    expect(showInActive(activateSurface(both, a.id), b.path)).toEqual({ surfaces: [memory, a, files, b], active: b.id })
    expect(showInActive(onA, a.path)).toBe(onA)
    expect(showInActive(activateSurface(nav, memory.id), c.path)).toEqual(openSurface(nav, c))
  })
})
