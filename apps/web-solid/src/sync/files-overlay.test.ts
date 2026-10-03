import { expect, test } from "bun:test"
import type { FileOp, FileRef } from "@kiko/protocol"
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
