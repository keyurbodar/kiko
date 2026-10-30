import { describe, expect, it } from "vitest"
import { breadcrumbPathOf, fileCrumbs, retainedBreadcrumbTrail, trailChildOf } from "./path"

const folders = (...paths: string[]) => new Set(paths)

describe("fileCrumbs", () => {
  it("starts every path at the scope crumb", () => {
    expect(fileCrumbs("notes.md", folders())).toEqual([
      { path: "", label: "Files", kind: "root" },
      { path: "notes.md", label: "notes.md", kind: "file" },
    ])
  })

  it("names folders and files along a nested path", () => {
    expect(fileCrumbs("docs/guides/setup.md", folders("docs", "docs/guides"))).toEqual([
      { path: "", label: "Files", kind: "root" },
      { path: "docs", label: "docs", kind: "directory" },
      { path: "docs/guides", label: "guides", kind: "directory" },
      { path: "docs/guides/setup.md", label: "setup.md", kind: "file" },
    ])
  })

  it("ends on a folder crumb when the trail is a folder", () => {
    expect(fileCrumbs("docs", folders("docs"))).toEqual([
      { path: "", label: "Files", kind: "root" },
      { path: "docs", label: "docs", kind: "directory" },
    ])
  })

  it("uses the labels the explorer already shows for attachments and home", () => {
    expect(fileCrumbs("attachments/mvmm766u-notes.md", folders("attachments"))).toEqual([
      { path: "", label: "Files", kind: "root" },
      { path: "attachments", label: "From this chat", kind: "directory" },
      { path: "attachments/mvmm766u-notes.md", label: "notes.md", kind: "file" },
    ])
    expect(fileCrumbs("home/plan.md", folders("home"))).toEqual([
      { path: "", label: "Files", kind: "root" },
      { path: "home", label: "Home", kind: "directory" },
      { path: "home/plan.md", label: "plan.md", kind: "file" },
    ])
  })

  it("keeps a trailing slash from splitting an empty crumb", () => {
    expect(breadcrumbPathOf("docs/")).toBe("docs")
    expect(fileCrumbs("docs/", folders("docs")).at(-1)?.path).toBe("docs")
  })
})

describe("retainedBreadcrumbTrail", () => {
  it.each([
    ["apps/web/src", "apps/web", "apps/web/src"],
    ["apps/web/src", "", "apps/web/src"],
    ["apps/web/src", "apps/web/src", "apps/web/src"],
    ["apps/web/src", "apps/mobile", "apps/mobile"],
    ["src/lib", "src-old", "src-old"],
    ["apps/web", "apps/web/src/main.tsx", "apps/web/src/main.tsx"],
    ["attachments/notes.md", "attachments", "attachments/notes.md"],
  ])("from trail %j to %j keeps %j", (trail, path, expected) => {
    expect(retainedBreadcrumbTrail(trail, path)).toBe(expected)
  })

  it("starts a trail at the path when there is none", () => {
    expect(retainedBreadcrumbTrail(undefined, "docs/plan.md")).toBe("docs/plan.md")
  })
})

describe("trailChildOf", () => {
  it("names the segment directly below a folder in the trail", () => {
    expect(trailChildOf("apps", "apps/web/src")).toBe("web")
    expect(trailChildOf("apps/web", "apps/web/src")).toBe("src")
    expect(trailChildOf("apps/web/src", "apps/web/src")).toBeNull()
    expect(trailChildOf("other", "apps/web")).toBeNull()
    expect(trailChildOf("", "apps/web")).toBe("apps")
  })
})
