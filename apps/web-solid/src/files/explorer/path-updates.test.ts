import { describe, expect, it } from "vitest"
import { buildFileTreePathUpdates } from "./path-updates"

describe("buildFileTreePathUpdates", () => {
  it("adds new paths and removes gone ones without touching the rest", () => {
    expect(buildFileTreePathUpdates(["a.md", "docs/", "docs/one.md"], ["a.md", "docs/", "docs/two.md"])).toEqual([
      { type: "remove", path: "docs/one.md" },
      { type: "add", path: "docs/two.md" },
    ])
  })

  it("removes a whole folder once and skips its children", () => {
    expect(buildFileTreePathUpdates(["docs/", "docs/one.md", "docs/deep/two.md", "keep.md"], ["keep.md"])).toEqual([
      { type: "remove", path: "docs/", recursive: true },
    ])
  })

  it("adds parents before children regardless of input order", () => {
    expect(buildFileTreePathUpdates([], ["docs/deep/", "docs/deep/plan.md", "docs/"])).toEqual([
      { type: "add", path: "docs/" },
      { type: "add", path: "docs/deep/" },
      { type: "add", path: "docs/deep/plan.md" },
    ])
  })

  it("returns nothing for an unchanged tree", () => {
    expect(buildFileTreePathUpdates(["a.md"], ["a.md"])).toEqual([])
  })
})
