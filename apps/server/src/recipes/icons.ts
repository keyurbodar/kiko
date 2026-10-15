/*
 * Picks an icon for a recipe from its words, with no model call: a synonym wins outright, otherwise the
 * curated icons are scored by their names and Phosphor tags. The glyphs and tones are generated into
 * icons.gen.ts by scripts/gen-recipes.ts, so this runs in the Worker.
 */
import type { RecipeTone } from "@kiko/protocol"
import { ICONS } from "./icons.gen"
import { SYNONYMS } from "./icon-words"

export type IconInfo = { glyph: string; tone: RecipeTone; words: readonly string[] }

const STOP = new Set("the and for you your with from into that this each every when about are its get using use based".split(" "))
export const stem = (w: string) => w.replace(/ies$/, "y").replace(/(ing|ers|es|s|ed)$/, "")
export const words = (s: string) => s.toLowerCase().replace(/follow-up/g, "followup").split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w))

/** Picks a curated icon from the recipe's words. An unknown topic gets the sparkle. */
export function pickIcon(title: string, description: string): string {
  for (const w of [...words(title), ...words(description)]) {
    const hit = SYNONYMS[w] ?? SYNONYMS[stem(w)]
    if (hit) return hit
  }
  const want = new Map<string, number>()
  for (const w of words(title)) want.set(stem(w), 3)
  for (const w of words(description)) if (!want.has(stem(w))) want.set(stem(w), 1)
  let best = "sparkle"
  let top = 0
  for (const [name, info] of Object.entries(ICONS)) {
    const own = new Set(name.split("-").map(stem))
    const tags = new Set(info.words)
    let score = 0
    for (const [w, weight] of want) score += own.has(w) ? 3 * weight : tags.has(w) ? weight : 0
    if (score > top) [best, top] = [name, score]
  }
  return top >= 3 ? best : "sparkle"
}

/** The icon a recipe shows: the one it names when it is in the set, else a pick from its words. */
export function iconFor(title: string, description: string, named: string | null): { icon: string } & IconInfo {
  const icon = named && ICONS[named] ? named : pickIcon(title, description)
  return { icon, ...(ICONS[icon] ?? ICONS.sparkle!) }
}
