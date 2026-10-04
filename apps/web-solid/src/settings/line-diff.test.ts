import { expect, test } from "bun:test"
import { lineDiff } from "./line-diff"

test("marks only the lines that changed", () => {
  expect(lineDiff("a\nb\nc\n", "a\nx\nc\n")).toEqual([
    { kind: "same", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "x" },
    { kind: "same", text: "c" },
  ])
})

test("a new file is all additions and a removed one all deletions", () => {
  expect(lineDiff("", "a\nb")).toEqual([{ kind: "add", text: "a" }, { kind: "add", text: "b" }])
  expect(lineDiff("a", "")).toEqual([{ kind: "del", text: "a" }])
})
