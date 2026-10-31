import { describe, expect, it } from "vitest"
import { type Item, ROOM_SHAPE, Tree } from "./optmem"

function tree(items: (lo: number, hi: number) => Item[]) {
  const sql = {
    exec: () => ({ toArray: () => [], one: () => undefined, rowsWritten: 0 }),
  } as unknown as SqlStorage
  return new Tree(sql, "memory_tree", ROOM_SHAPE, items)
}

const AT = Date.UTC(2025, 11, 24, 9, 0)
const NOW = Date.UTC(2026, 9, 30, 12, 0)
const item: Item = { pos: 3, at: AT, text: "moved to lisbon" }

describe("memory lines", () => {
  it("prints the year from the real now in view, render and zoom", () => {
    const t = tree(() => [item])
    expect(t.view(1, null, NOW).lines).toEqual(["#3 dec 24 2025 09:00 moved to lisbon"])
    expect(t.render({ lo: 0, hi: 1 }, NOW)).toEqual(["#3 dec 24 2025 09:00 moved to lisbon"])
    expect(t.zoom({ lo: 0, hi: 1 }, 1, NOW)).toEqual(["#3 dec 24 2025 09:00 moved to lisbon"])
  })

  it("omits the year when the memory is from this year", () => {
    const t = tree(() => [item])
    expect(t.view(1, null, AT).lines).toEqual(["#3 dec 24 09:00 moved to lisbon"])
  })
})

describe("paged items", () => {
  it("renders every page and the tail from the one snapshot", () => {
    const pages: [number, number][] = []
    const tails: [number, number][] = []
    const t = tree(() => {
      throw new Error("the default items callback should not run")
    })
    const { lines } = t.view(
      100,
      null,
      NOW,
      (lo, hi) => {
        tails.push([lo, hi])
        return []
      },
      (lo, hi) => {
        pages.push([lo, hi])
        return []
      },
    )
    expect(lines).toEqual([])
    expect(pages).toEqual([
      [0, 16],
      [16, 32],
      [32, 48],
      [48, 64],
    ])
    expect(tails).toEqual([[64, 100]])
  })
})
