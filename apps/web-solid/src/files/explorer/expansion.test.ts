import { describe, expect, it } from "vitest"
import { areAllDirectoriesExpanded, setAllDirectoriesExpanded } from "./expansion"

function directory(open: boolean) {
  return {
    open,
    isDirectory: () => true,
    isExpanded() {
      return this.open
    },
    expand() {
      this.open = true
    },
    collapse() {
      this.open = false
    },
  }
}

function modelOf(paths: Record<string, ReturnType<typeof directory>>) {
  return { getItem: (path: string) => paths[path] }
}

describe("areAllDirectoriesExpanded", () => {
  it("is false with no directories and when any one is closed", () => {
    expect(areAllDirectoriesExpanded(modelOf({}), [])).toBe(false)
    const docs = directory(true)
    const lib = directory(false)
    expect(areAllDirectoriesExpanded(modelOf({ "docs/": docs, "lib/": lib }), ["docs/", "lib/"])).toBe(false)
    lib.expand()
    expect(areAllDirectoriesExpanded(modelOf({ "docs/": docs, "lib/": lib }), ["docs/", "lib/"])).toBe(true)
  })

  it("counts a missing item as not expanded", () => {
    expect(areAllDirectoriesExpanded(modelOf({}), ["gone/"])).toBe(false)
  })
})

describe("setAllDirectoriesExpanded", () => {
  it("expands and collapses every directory", () => {
    const docs = directory(false)
    const lib = directory(false)
    const model = modelOf({ "docs/": docs, "lib/": lib })
    setAllDirectoriesExpanded(model, ["docs/", "lib/"], true)
    expect([docs.open, lib.open]).toEqual([true, true])
    setAllDirectoriesExpanded(model, ["docs/", "lib/"], false)
    expect([docs.open, lib.open]).toEqual([false, false])
  })
})
