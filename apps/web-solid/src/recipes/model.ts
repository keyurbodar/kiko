import type { RecipeCard, RecipeInstall, RoomId } from "@kiko/protocol"
import { triggerLabel } from "../chat/info/routines-model"

/** The tags in the order the page shows their chips. A tag not listed here comes after, in the order the catalog has it. */
const TAG_ORDER = ["mornings", "inbox", "money", "health", "fun", "thinking", "home", "work", "travel"]

/** The four tiles an empty chat shows, in order. Any that the catalog lacks is replaced by the next recipe. */
const TILE_ORDER = ["morning-briefing", "decision-council", "follow-up-nudges", "daily-weather"]
const TILE_COUNT = 4

/** The page's tag filter: every recipe, or the recipes with one tag. */
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
      words.every((w) => `${c.title} ${c.description} ${c.apps.map((a) => a.name).join(" ")} ${c.tags.join(" ")}`.toLowerCase().includes(w)),
  )
}

/** The slugs of the recipes already added, for the "Added" mark. */
export function installedSlugs(installs: readonly RecipeInstall[], target: { roomId: string; agent: string }): ReadonlySet<string> {
  return new Set(installs.filter((i) => i.roomId === target.roomId && i.agent === target.agent).map((i) => i.slug))
}

/** The recipes an empty chat offers: the preferred four that the catalog has, filled in order from the rest. */
export function starterTiles(cards: readonly RecipeCard[]): RecipeCard[] {
  const bySlug = new Map(cards.map((c) => [c.slug, c]))
  const picked = TILE_ORDER.flatMap((slug) => bySlug.get(slug) ?? [])
  const fill = cards.filter((c) => !picked.includes(c))
  return [...picked, ...fill].slice(0, TILE_COUNT)
}

/** What an install's row says: when it next runs, that its routines are paused, or that it still needs an answer. */
export type InstallStatus = { kind: "next"; at: number } | { kind: "paused"; schedule: string } | { kind: "ask"; label: string }

/** The soonest active routine's due time. When all are paused, the first routine's schedule. With no routines, the recipe's `when`. */
export function installStatus(install: RecipeInstall, card: RecipeCard): InstallStatus {
  const routines = install.routines ?? []
  const active = routines.filter((r) => r.status === "active")
  if (active.length) return { kind: "next", at: Math.min(...active.map((r) => r.dueUtc)) }
  if (routines.length) return { kind: "paused", schedule: triggerLabel(routines[0].trigger, routines[0].tz) }
  return { kind: "ask", label: card.when }
}

const dayNumber = (ms: number, tz?: string): number => {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms).split("-").map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** "Today at 7:55 AM", "Tomorrow at 7:55 AM", "Mon at 7:55 AM" within six days, else "Oct 21 at 7:55 AM". Days are counted in the zone. */
export function nextLabel(at: number, now: number, tz?: string): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at)
  const days = dayNumber(at, tz) - dayNumber(now, tz)
  if (days === 0) return `Today at ${time}`
  if (days === 1) return `Tomorrow at ${time}`
  if (days > 1 && days <= 6) return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(at)} at ${time}`
  return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(at)} at ${time}`
}

/** The installs grouped by chat, in the chat list's order. A chat the list does not have goes last. */
export function groupByChat(installs: readonly RecipeInstall[], chatOrder: readonly string[]): { roomId: RoomId; installs: RecipeInstall[] }[] {
  const groups = new Map<RoomId, RecipeInstall[]>()
  for (const install of installs) groups.set(install.roomId, [...(groups.get(install.roomId) ?? []), install])
  const rank = (roomId: string) => {
    const i = chatOrder.indexOf(roomId)
    return i === -1 ? Number.POSITIVE_INFINITY : i
  }
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0])).map(([roomId, list]) => ({ roomId, installs: list }))
}

/** The recipe a routine came from. Routine names are stored lowercased, so the title is compared lowercased. */
export function recipeForRoutine(cards: readonly RecipeCard[], routineName: string): RecipeCard | undefined {
  return cards.find((c) => c.title.toLowerCase() === routineName)
}
