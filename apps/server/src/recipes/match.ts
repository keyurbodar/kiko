import type { Recipe } from "./recipe"

export type RecipeHint = { slug: string; title: string; description: string }

const STOP = new Set([
  "about",
  "after",
  "agent",
  "also",
  "always",
  "and",
  "any",
  "assistant",
  "are",
  "ask",
  "can",
  "daily",
  "for",
  "from",
  "get",
  "give",
  "have",
  "help",
  "into",
  "just",
  "keep",
  "like",
  "make",
  "need",
  "that",
  "the",
  "their",
  "them",
  "then",
  "they",
  "this",
  "what",
  "when",
  "with",
  "will",
  "want",
  "your",
  "you",
  "every",
  "each",
  "something",
  "someone",
  "things",
  "thing",
])

const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ers|er|es|s|ed)$/, "") : w)
const words = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem))

export function matchRecipes(description: string, recipes: readonly Recipe[], limit = 3): RecipeHint[] {
  const wanted = words(description)
  if (!wanted.size) return []
  return recipes
    .map((r) => {
      const have = words(
        `${r.title} ${r.description} ${r.slug.replaceAll("-", " ")} ${r.tags.join(" ")} ${r.apps.join(" ")}`,
      )
      let score = 0
      for (const w of wanted) if (have.has(w)) score++
      return { r, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title))
    .slice(0, limit)
    .map(({ r }) => ({ slug: r.slug, title: r.title, description: r.description }))
}
