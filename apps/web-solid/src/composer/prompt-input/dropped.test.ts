import { expect, test } from "bun:test"
import { type EntryLike, hasFolder, MAX_WALKED, walkEntries } from "./dropped"

const file = (name: string, body = "x"): EntryLike => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(new File([body], name, { type: "text/plain" })) })
// A reader hands entries back in batches of two and then an empty batch, as a browser's does in hundreds.
const dir = (name: string, ...children: EntryLike[]): EntryLike => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let at = 0
    return {
      readEntries: (ok) => {
        const batch = children.slice(at, at + 2)
        at += 2
        ok(batch)
      },
    }
  },
})

test("a dropped folder's files keep their path from the folder, however many batches the reader needs", async () => {
  const tree = dir("proj", file("a.txt"), dir("src", file("b.ts"), file("c.ts"), file("d.ts")), file("e.md"))
  const { files, folders, truncated } = await walkEntries([tree, file("loose.txt")])
  expect(files.map((f) => f.name)).toEqual(["proj/a.txt", "proj/src/b.ts", "proj/src/c.ts", "proj/src/d.ts", "proj/e.md", "loose.txt"])
  expect(folders).toBe(2)
  expect(truncated).toBe(false)
  expect(await files[1]!.text()).toBe("x")
  expect(hasFolder([tree])).toBe(true)
  expect(hasFolder([file("a")])).toBe(false)
})

test("system clutter, .git and node_modules are left out, and an empty folder yields nothing", async () => {
  const tree = dir("p", file(".DS_Store"), dir(".git", file("HEAD")), dir("node_modules", file("x.js")), dir("empty"), file("keep.txt"))
  expect((await walkEntries([tree])).files.map((f) => f.name)).toEqual(["p/keep.txt"])
})

test("the walk stops at the cap and says it was cut", async () => {
  const many = dir("big", ...Array.from({ length: 30 }, (_, i) => file(`f${i}.txt`)))
  const { files, truncated } = await walkEntries([many], 10)
  expect(files).toHaveLength(10)
  expect(truncated).toBe(true)
})

test("a tree with more entries than the walk reads is cut, not walked to the end", async () => {
  const wide = dir("w", ...Array.from({ length: MAX_WALKED + 50 }, (_, i) => dir(`d${i}`)))
  const { truncated } = await walkEntries([wide], 100_000)
  expect(truncated).toBe(true)
})

test("a file that cannot be read is skipped and the rest are kept", async () => {
  const bad: EntryLike = { isFile: true, isDirectory: false, name: "bad", file: (_, fail) => fail(new Error("nope")) }
  expect((await walkEntries([dir("p", bad, file("ok.txt"))])).files.map((f) => f.name)).toEqual(["p/ok.txt"])
})
