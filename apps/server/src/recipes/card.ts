import type { RecipeCard } from "@kiko/protocol"
import { iconFor } from "./icons"
import type { Recipe } from "./recipe"

export function recipeCard(r: Recipe): RecipeCard {
  const { icon, glyph, tone } = iconFor(r.title, r.description, r.icon)
  return { slug: r.slug, title: r.title, description: r.description, when: r.when, apps: r.apps, tags: r.tags, icon, glyph, tone }
}
