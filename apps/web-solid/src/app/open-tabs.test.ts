import { describe, expect, test } from "bun:test"
import { closeTab, nextAfterClose, openTab, parseTabs, stepTab } from "./open-tabs"

describe("open tabs", () => {
  test("opening appends once and keeps order", () => {
    expect(openTab(["a", "b"], "c")).toEqual(["a", "b", "c"])
    expect(openTab(["a", "b"], "a")).toEqual(["a", "b"])
  })

  test("closing the middle tab keeps the others in order", () => {
    expect(closeTab(["a", "b", "c"], "b")).toEqual(["a", "c"])
  })

  test("closing the active tab lands on its neighbour", () => {
    expect(nextAfterClose(["a", "b", "c"], "b", "b")).toBe("c")
    expect(nextAfterClose(["a", "b", "c"], "c", "c")).toBe("b")
    expect(nextAfterClose(["a"], "a", "a")).toBeNull()
  })

  test("closing an inactive tab keeps the active one", () => {
    expect(nextAfterClose(["a", "b", "c"], "a", "c")).toBe("c")
  })

  test("arrow steps wrap", () => {
    expect(stepTab(["a", "b", "c"], "c", 1)).toBe("a")
    expect(stepTab(["a", "b", "c"], "a", -1)).toBe("c")
    expect(stepTab([], "a", 1)).toBeNull()
  })

  test("storage that is damaged reads as empty", () => {
    expect(parseTabs(null)).toEqual([])
    expect(parseTabs("{")).toEqual([])
    expect(parseTabs('{"a":1}')).toEqual([])
    expect(parseTabs('["a",3,"a","b"]')).toEqual(["a", "b"])
  })
})
