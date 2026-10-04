// A bird as pixels: the same flock as `birds.ts`, drawn on a small grid for the pixel scenes.
// Pure data. Colours stay CSS strings; the stage resolves them, so the kiko bird can still
// follow the theme through `var(--h-brand)`.

import { bodyColor, SPECIES, type BirdSpec } from "../birds"

/** A grid of cells, row by row. `null` is empty. Facing right. */
export type Pixels = { readonly w: number; readonly h: number; readonly cells: readonly (string | null)[] }

/* c crest, h head, b body, w belly, e eye, k beak, f feet. Head cells are body unless a species marks them. */
const SHAPE = [
  "....cc....",
  "...hhhh...",
  "..hhhhhh..",
  ".bbbbbebk.",
  ".bbbbbbbkk",
  ".bbbwwwbb.",
  "..bwwwwb..",
  "...bbbb...",
  "...f..f...",
]

export const BIRD_W = SHAPE[0]!.length
export const BIRD_H = SHAPE.length

const INK = "#221A20"
const ORANGE = "#FFA14A"

/** Species whose head is not their body: a cap, a hood. */
const HEAD: Partial<Record<keyof typeof SPECIES, string>> = { chickadee: "#2E2C34", mallard: "#3A9A62", puffin: "oklch(0.3 0.01 280)" }

/* What a bird wears, as cells on its head row or above it: [col, row, colour], row -1 is above the sprite. */
const WEAR: Record<string, readonly (readonly [number, number, string])[]> = {
  leaf: [[4, -1, "#7DCB68"], [5, -1, "#5FB04F"]],
  bow: [[6, 0, "#FF6F91"], [7, 0, "#FF6F91"]],
  flower: [[3, 0, "#FFFFFF"], [3, -1, "#FFC93C"]],
  cap: [[3, 0, "#E5484D"], [4, 0, "#E5484D"], [5, 0, "#E5484D"], [6, 0, "#E5484D"], [7, 1, "#B92F35"]],
  beanie: [[3, 0, "#4C7BD9"], [4, 0, "#4C7BD9"], [5, 0, "#4C7BD9"], [6, 0, "#4C7BD9"], [4, -1, "#FBF4E8"]],
  party: [[4, -1, "#B98CF5"], [5, -1, "#B98CF5"], [4, 0, "#FFD84D"]],
  crown: [[3, 0, "#FFD84D"], [5, 0, "#FFD84D"], [6, 0, "#FFD84D"], [4, -1, "#FFD84D"]],
  headphones: [[2, 2, "#2E2C34"], [7, 2, "#2E2C34"], [3, 1, "#2E2C34"], [6, 1, "#2E2C34"]],
  glasses: [[5, 3, "#2E2C34"], [7, 3, "#2E2C34"]],
  scarf: [[2, 6, "#E5484D"], [3, 6, "#E5484D"], [6, 6, "#E5484D"], [7, 6, "#E5484D"]],
  bandana: [[2, 2, "#2E8B57"], [3, 1, "#2E8B57"], [4, 1, "#2E8B57"], [5, 1, "#2E8B57"]],
}

const cache = new Map<string, Pixels>()

/** The pixel bird for a spec. Rows grow by one when it wears something above its head. */
export function birdPixels(spec: BirdSpec): Pixels {
  const key = `${spec.species}.${spec.tint}.${spec.accessory}`
  const hit = cache.get(key)
  if (hit) return hit
  const s = SPECIES[spec.species] as { belly: string; beak: string; crest?: string }
  const body = bodyColor(spec)
  const head = HEAD[spec.species] ?? body
  const beak = s.beak === ORANGE || !s.beak ? ORANGE : s.beak
  const feet = beak === "#3A3340" || beak === "#2A2024" || beak === "#4A4450" ? ORANGE : beak
  const wear = WEAR[spec.accessory] ?? []
  const top = wear.some(([, r]) => r < 0) ? 1 : 0
  const w = BIRD_W
  const h = BIRD_H + top
  const cells: (string | null)[] = Array.from({ length: w * h }, () => null)
  const set = (c: number, r: number, color: string) => {
    if (c >= 0 && c < w && r + top >= 0 && r + top < h) cells[(r + top) * w + c] = color
  }
  SHAPE.forEach((line, r) => {
    for (let c = 0; c < w; c++) {
      const ch = line[c]
      if (ch === "." || ch === undefined) continue
      if (ch === "c" && !s.crest) continue
      const color = ch === "w" ? s.belly : ch === "k" ? beak : ch === "f" ? feet : ch === "e" ? INK : ch === "h" ? head : body
      set(c, r, color)
    }
  })
  for (const [c, r, color] of wear) set(c, r, color)
  const out = { w, h, cells }
  cache.set(key, out)
  return out
}
