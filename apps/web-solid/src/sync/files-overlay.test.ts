import { expect, test } from "bun:test"
import type { FileOp, FileRef } from "@yuki/protocol"
import { overlayFiles, type RoomPatch } from "./patches"

const file = (name: string): FileRef => ({ id: name, name, size: 1, type: "text/plain" })
const files = ["a.md", "docs/b.md", "docs/sub/c.md", "x.md"].map(file)
const patch = (op: FileOp): RoomPatch => ({ clientId: "c", at: 0, frame: { t: "files", op } })
const names = (ops: FileOp[]) => overlayFiles(files, ops.map(patch)).map((f) => `${f.id}=${f.name}`)

test("rm hides files and whole folders at once", () => {
  expect(names([{ op: "rm", paths: ["docs"], recursive: true }])).toEqual(["a.md=a.md", "x.md=x.md"])
  expect(names([{ op: "rm", paths: ["a.md", "x.md"] }])).toEqual(["docs/b.md=docs/b.md", "docs/sub/c.md=docs/sub/c.md"])
})

test("mv renames, moves into a folder keeping the name, moves a folder, and replaces a file, as the room does", () => {
  expect(names([{ op: "mv", from: "a.md", to: "z.md" }])).toContain("a.md=z.md")
  expect(names([{ op: "mv", from: "a.md", to: "docs" }])).toContain("a.md=docs/a.md")
  expect(names([{ op: "mv", from: "docs", to: "archive" }])).toEqual(["a.md=a.md", "docs/b.md=archive/b.md", "docs/sub/c.md=archive/sub/c.md", "x.md=x.md"])
  expect(names([{ op: "mv", from: "x.md", to: "a.md" }])).toEqual(["docs/b.md=docs/b.md", "docs/sub/c.md=docs/sub/c.md", "x.md=a.md"])
  // Never into itself.
  expect(names([{ op: "mv", from: "docs", to: "docs/sub" }])).toEqual(files.map((f) => `${f.id}=${f.name}`))
})

test("folders: mkdir -p adds parents, rm drops a tree, mv renames a tree and lands inside an existing folder", async () => {
  const { overlayFolders } = await import("./patches")
  const f = (ops: FileOp[], start = ["docs", "docs/sub", "empty"]) => overlayFolders(start, ops.map(patch))
  expect(f([{ op: "mkdir", path: "a/b/c" }])).toEqual(["a", "a/b", "a/b/c", "docs", "docs/sub", "empty"])
  expect(f([{ op: "rm", paths: ["docs"], recursive: true }])).toEqual(["empty"])
  expect(f([{ op: "mv", from: "docs", to: "archive" }])).toEqual(["archive", "archive/sub", "empty"])
  expect(f([{ op: "mv", from: "docs", to: "empty" }])).toEqual(["empty", "empty/docs", "empty/docs/sub"])
  // A file moved into an empty folder keeps its name.
  expect(overlayFiles([file("a.md")], [patch({ op: "mv", from: "a.md", to: "empty" })], ["empty"]).map((x) => x.name)).toEqual(["empty/a.md"])
})
