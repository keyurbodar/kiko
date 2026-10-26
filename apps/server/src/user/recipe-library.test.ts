import { describe, expect, it } from "vitest"
import type { FsEntry } from "../files/file-index"
import type { FileBucket } from "../files/store"
import { RecipeLibrary } from "./recipe-library"

function libraryWith(text: string) {
  const entry: FsEntry = {
    kind: "file",
    path: "recipes/weekly-review/RECIPE.md",
    id: "f1",
    size: text.length,
    type: "text/markdown",
    sha256: "s1",
    r2Key: "k1",
    at: 0,
  }
  const files = {
    get: async () => ({ arrayBuffer: async () => new TextEncoder().encode(text).buffer }),
  } as unknown as FileBucket
  return new RecipeLibrary({
    sql: {} as SqlStorage,
    files,
    userId: () => "owner",
    list: () => [entry],
    put: () => ({ drop: null, entry: null }),
    remove: () => ({ ok: true }),
  })
}

describe("recipe library", () => {
  it("never stands a built-in in for the human's broken recipe of the same name", async () => {
    const lib = await libraryWith("---\nname: weekly-review\n---\nno title").read()
    expect(lib.recipes.find((r) => r.slug === "weekly-review")).toBeUndefined()
    expect(lib.problems.get("weekly-review")).toContain("title is required")
  })
})
