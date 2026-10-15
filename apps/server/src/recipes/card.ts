import type { RecipeApp, RecipeCard } from "@kiko/protocol"
import { iconFor } from "./icons"
import type { Recipe } from "./recipe"

/** The toolkit slug Composio uses for an app name: "Google Calendar" is "googlecalendar". */
const toolkitSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")

/** `connected` is null for every app when Composio cannot say which apps are connected. */
export function recipeCard(r: Recipe, custom: boolean, connected: ReadonlySet<string> | null): RecipeCard {
  const { icon, glyph, tone } = iconFor(r.title, r.description, r.icon)
  const apps: RecipeApp[] = r.apps.map((name) => {
    const slug = toolkitSlug(name)
    return { name, slug, connected: connected ? connected.has(slug) : null }
  })
  return { slug: r.slug, title: r.title, description: r.description, when: r.when, apps, setup: r.setup, agent: r.agent, custom, tags: r.tags, icon, glyph, tone }
}
