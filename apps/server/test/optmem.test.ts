import { expect, test } from "bun:test"
import { ancestors, capBytes, cleanLine, cover, type Item, isNode, LINE_BYTES, napPrompt, range, region, type Shape, type Span, tile, Tree } from "../src/lib/optmem"
import { sqlStorage } from "./sql-shim"

// Architecture section 13. memo's invariants (OptMem test.py), ported, plus kiko's departures. The
// compressor is fake (it joins and cuts), so the run is deterministic and costs no tokens.

const tiles = (spans: Span[], T: number) => {
  let at = 0
  for (const s of spans) {
    if (s.lo !== at) return false
    at = s.hi
  }
  return at === T
}

test("cover tiles [0,T) with aligned power-of-two blocks within budget, finer toward T", () => {
  for (const T of [...Array.from({ length: 300 }, (_, i) => i + 1), 1000, 4096, 10_000, 65_536, 100_003]) {
    for (const budget of [8, 24, 96]) {
      const c = cover(T, budget)
      expect(tiles(c, T)).toBe(true)
      expect(c.length).toBeLessThanOrEqual(Math.max(budget, 1))
      for (const s of c) expect(isNode(s, 1)).toBe(true)
      // Detail decays with age: block sizes never grow toward the present.
      for (let i = 1; i < c.length; i++) expect(c[i]!.hi - c[i]!.lo).toBeLessThanOrEqual(c[i - 1]!.hi - c[i - 1]!.lo)
      if (T <= budget) expect(c.every((s) => s.hi - s.lo === 1)).toBe(true)
    }
  }
})

const shape: Shape = { page: 8, floor: 40, budget: 64, retile: 48 }

test("the compressed region is whole pages before the floor", () => {
  expect(region(39, shape)).toBe(0)
  expect(region(48, shape)).toBe(8)
  expect(region(55, shape)).toBe(8)
  expect(region(56, shape)).toBe(16)
})

test("a sticky tiling keeps its old spans byte for byte until the budget overflows", () => {
  let prev: Span[] | null = null
  let retiles = 0
  let kept = 0
  for (let end = 0; end <= 8 * 4000; end += 8) {
    const next = tile(prev, end, shape)
    expect(tiles(next, end)).toBe(true)
    expect(next.length).toBeLessThanOrEqual(shape.budget)
    for (const s of next) expect(isNode(s, 8)).toBe(true)
    if (prev && next.length > 0 && JSON.stringify(next.slice(0, prev.length)) === JSON.stringify(prev)) kept++
    else if (prev?.length) retiles++
    prev = next
  }
  // A tiling lasts at least budget - retile pages (128 turns), so the cached prefix rarely breaks.
  expect(retiles).toBeLessThanOrEqual(4000 / (shape.budget - shape.retile) + 1)
  expect(kept).toBeGreaterThan(3700)
})

test("a stale tiling is replaced, never trusted", () => {
  const bad: Span[] = [{ lo: 0, hi: 24 }]
  expect(tile(bad, 64, shape).every((s) => isNode(s, 8))).toBe(true)
  expect(tiles(tile([{ lo: 0, hi: 128 }], 64, shape), 64)).toBe(true)
})

test("ancestors climb one node per level", () => {
  expect(ancestors(13, 64, 8)).toEqual([
    { lo: 8, hi: 16 },
    { lo: 0, hi: 16 },
    { lo: 0, hi: 32 },
    { lo: 0, hi: 64 },
  ])
})

// A fake log of `n` items and a fake compressor.
function fakeLog(n: number, tainted: (i: number) => boolean = () => false) {
  const log: Item[] = Array.from({ length: n }, (_, i) => ({ pos: i, at: Date.UTC(2026, 8, 1) + i * 3_600_000, text: `item ${i}`, tainted: tainted(i) }))
  const tree = new Tree(sqlStorage(), "t", shape, (lo, hi) => log.slice(lo, Math.min(hi, log.length)))
  const napAll = () => {
    let calls = 0
    for (;;) {
      const todo = tree.pending(log.length, 4)
      if (!todo.length) return calls
      for (const span of todo) {
        const input = tree.input(span)!
        const text = "items" in input ? input.items.map((i) => i.pos).join(",") : `${input.halves[0].text}|${input.halves[1].text}`
        tree.put(span, tree.nodeFor(input, text.slice(0, 60)))
        calls++
      }
    }
  }
  return { log, tree, napAll }
}

test("every node is built once, smallest first, about one call per four items", () => {
  const { tree, napAll } = fakeLog(1000)
  const calls = napAll()
  // 125 pages + 62 + 31 + 15 + 7 + 3 + 1 nodes.
  expect(calls).toBe(244)
  expect(napAll()).toBe(0)
  expect(tree.node({ lo: 0, hi: 512 })).not.toBeNull()
  // A repeated put is a no-op, as an alarm delivered twice must be.
  expect(tree.put({ lo: 0, hi: 8 }, { text: "again", tainted: false, from: 0, to: 0 })).toBe(false)
  expect(tree.node({ lo: 0, hi: 8 })!.text).toBe("0,1,2,3,4,5,6,7")
})

test("forgetting an old item rebuilds only its ancestors", () => {
  const { tree, napAll } = fakeLog(1000)
  napAll()
  expect(tree.forget(13)).toBe(7)
  expect(tree.node({ lo: 8, hi: 16 })).toBeNull()
  expect(tree.node({ lo: 16, hi: 24 })).not.toBeNull()
  expect(napAll()).toBe(7)
})

test("a view is bounded, keeps the floor verbatim, and falls back to halves for missing nodes", () => {
  const { tree, napAll } = fakeLog(5000)
  const now = Date.UTC(2026, 9, 4)
  // Nothing summarized yet: the view still renders, from pages' items, and never waits.
  const cold = tree.view(200, null, now)
  expect(cold.lines.length).toBe(200)
  napAll()
  const warm = tree.view(5000, null, now)
  expect(warm.lines.length).toBeLessThanOrEqual(shape.budget + shape.floor + shape.page)
  expect(warm.lines.at(-1)).toContain("item 4999")
  expect(warm.lines.filter((l) => l.includes(" item ")).length).toBeGreaterThanOrEqual(shape.floor)
  // The next view keeps the old lines exactly.
  const next = tree.view(5008, warm.tiling, now)
  expect(next.lines.slice(0, warm.tiling.length)).toEqual(warm.lines.slice(0, warm.tiling.length))
})

test("taint climbs the tree", () => {
  const { tree, napAll } = fakeLog(64, (i) => i === 5)
  napAll()
  expect(tree.node({ lo: 0, hi: 8 })!.tainted).toBe(true)
  expect(tree.node({ lo: 0, hi: 64 })!.tainted).toBe(true)
  expect(tree.node({ lo: 8, hi: 16 })!.tainted).toBe(false)
  expect(tree.render({ lo: 0, hi: 64 }, Date.now())[0]).toContain("[outside]")
})

test("zoom opens a node into its halves, down to items", () => {
  const { tree, napAll } = fakeLog(64)
  napAll()
  const now = Date.UTC(2026, 9, 4)
  expect(tree.zoom({ lo: 0, hi: 64 }, 64, now).map((l) => l.split(" ")[0])).toEqual(["#0-31", "#32-63"])
  expect(tree.zoom({ lo: 0, hi: 8 }, 64, now)).toHaveLength(8)
})

test("the nap prompt and the answer cleaner", () => {
  const { tree } = fakeLog(16)
  const prompt = napPrompt(tree.input({ lo: 8, hi: 16 })!, "turns")
  // The stretch whole, a limit in words, and no ids anywhere: a model copies them into its line.
  expect(prompt).toStartWith("compress these turns into one line of at most 40 words.")
  expect(prompt).toEndWith(`\n\n${Array.from({ length: 8 }, (_, i) => `item ${i + 8}`).join("\n")}`)
  expect(prompt).not.toMatch(/#\d/)
  const long = "x".repeat(2_000)
  expect(napPrompt({ span: { lo: 0, hi: 8 }, items: [{ pos: 0, at: 0, text: long, tainted: false }] }, "turns")).toContain(long)
  expect(cleanLine('\n"#0-7 ada booked the flight"\nmore')).toBe("ada booked the flight")
  expect(cleanLine("   ")).toBeNull()
  expect(new TextEncoder().encode(capBytes("é".repeat(400), 280)).byteLength).toBeLessThanOrEqual(280)
  expect(range(Date.UTC(2026, 8, 20), Date.UTC(2026, 8, 28), Date.UTC(2026, 9, 4))).toBe("sep 20–28")
  expect(range(Date.UTC(2026, 8, 20), Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 4))).toBe("sep 20–oct 2")
})

test("a stretch that already fits a line is its own summary, word for word, with no model", () => {
  const { tree } = fakeLog(16)
  const input = tree.input({ lo: 0, hi: 8 })!
  expect(tree.free(input)).toBe("item 0; item 1; item 2; item 3; item 4; item 5; item 6; item 7")
  const long: Item[] = [{ pos: 0, at: 0, text: "x".repeat(LINE_BYTES + 1), tainted: false }]
  expect(tree.free({ span: { lo: 0, hi: 8 }, items: long })).toBeNull()
  expect(tree.free({ span: { lo: 0, hi: 16 }, halves: [{ text: "a", tainted: false, from: 0, to: 0 }, { text: "b", tainted: false, from: 0, to: 0 }] })).toBe("a; b")
})

test("a cut verbatim line says it was cut and how to see the rest", async () => {
  const { itemLine } = await import("../src/lib/optmem")
  expect(itemLine({ pos: 12, at: 0, text: "short", tainted: false }, 100)).not.toContain("cut")
  expect(itemLine({ pos: 12, at: 0, text: "long ".repeat(50), tainted: false }, 100)).toEndWith("… (cut, zoom chat:12)")
})

test("a node whose call failed while later ones were built is still built, and so are the nodes above it", () => {
  const { tree, napAll } = fakeLog(64)
  // Four pages run at once; the second one's call fails, the others are stored.
  for (const span of tree.pending(64, 4)) if (span.lo !== 8) tree.put(span, tree.nodeFor(tree.input(span)!, `page ${span.lo}`))
  expect(tree.node({ lo: 8, hi: 16 })).toBeNull()
  expect(tree.pending(64, 10)).toContainEqual({ lo: 8, hi: 16 })
  napAll()
  expect(tree.node({ lo: 8, hi: 16 })).not.toBeNull()
  expect(tree.node({ lo: 0, hi: 64 })).not.toBeNull()
})
