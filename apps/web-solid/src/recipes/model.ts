import type { RecipeCard, RecipeInstall } from "@kiko/protocol"

/** The tags in the order the gallery shows their chips. A tag not listed here comes after, in the order the catalog has it. */
const TAG_ORDER = ["mornings", "inbox", "money", "health", "fun", "thinking", "home", "work", "travel"]

/** The five tiles an empty chat shows, in order. Any that the catalog lacks is replaced by the next recipe. */
const TILE_ORDER = ["morning-briefing", "decision-council", "follow-up-nudges", "daily-weather", "meme-machine"]
const TILE_COUNT = 5

/** The gallery's tag filter: every recipe, or the recipes with one tag. */
export type TagFilter = "all" | (string & {})

/** The tags the catalog uses, in chip order. */
export function recipeTags(cards: readonly RecipeCard[]): string[] {
  const present = new Set(cards.flatMap((c) => c.tags))
  const known = TAG_ORDER.filter((t) => present.has(t))
  const rest = [...present].filter((t) => !TAG_ORDER.includes(t))
  return [...known, ...rest]
}

/** A chip's label: the tag with its first letter capitalized. */
export function tagLabel(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1)
}

/** The recipes with the tag, and whose title, description, tags, or apps hold every word of the query. */
export function filterRecipes(cards: readonly RecipeCard[], query: string, tag: TagFilter): RecipeCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return cards.filter(
    (c) =>
      (tag === "all" || c.tags.includes(tag)) &&
      words.every((w) => `${c.title} ${c.description} ${c.apps.join(" ")} ${c.tags.join(" ")}`.toLowerCase().includes(w)),
  )
}

/** The slugs of the recipes already added, for the "Added" mark. */
export function installedSlugs(installs: readonly RecipeInstall[]): ReadonlySet<string> {
  return new Set(installs.map((i) => i.slug))
}

/** The recipes an empty chat offers: the preferred five that the catalog has, filled in order from the rest. */
export function starterTiles(cards: readonly RecipeCard[]): RecipeCard[] {
  const bySlug = new Map(cards.map((c) => [c.slug, c]))
  const picked = TILE_ORDER.flatMap((slug) => bySlug.get(slug) ?? [])
  const fill = cards.filter((c) => !picked.includes(c))
  return [...picked, ...fill].slice(0, TILE_COUNT)
}

/** The line under a recipe's title in its sheet: when it runs, then the apps it needs. */
export function sheetLine(card: RecipeCard): string {
  return card.apps.length ? `${card.when} · ${card.apps.join(", ")}` : card.when
}

/** The recipe a routine came from. Routine names are stored lowercased, so the title is compared lowercased. */
export function recipeForRoutine(cards: readonly RecipeCard[], routineName: string): RecipeCard | undefined {
  return cards.find((c) => c.title.toLowerCase() === routineName)
}
