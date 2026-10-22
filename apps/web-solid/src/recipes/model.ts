import type { RecipeCard, RecipeInstall } from "@kiko/protocol"
import { triggerLabel } from "../chat/info/routines-model"

const TAG_ORDER = ["mornings", "inbox", "money", "health", "fun", "thinking", "home", "work", "travel"]

export type TagFilter = "all" | (string & {})

export function recipeTags(cards: readonly RecipeCard[]): string[] {
  const present = new Set(cards.flatMap((c) => c.tags))
  const known = TAG_ORDER.filter((t) => present.has(t))
  const rest = [...present].filter((t) => !TAG_ORDER.includes(t))
  return [...known, ...rest]
}

export function tagLabel(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1)
}

export function filterRecipes(cards: readonly RecipeCard[], query: string, tag: TagFilter): RecipeCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return cards.filter(
    (c) =>
      (tag === "all" || c.tags.includes(tag)) &&
      words.every((w) => `${c.title} ${c.description} ${c.apps.map((a) => a.name).join(" ")} ${c.tags.join(" ")}`.toLowerCase().includes(w)),
  )
}

export function installedSlugs(installs: readonly RecipeInstall[], target: { roomId: string; agent: string }): ReadonlySet<string> {
  return new Set(installs.filter((i) => i.roomId === target.roomId && i.agent === target.agent).map((i) => i.slug))
}

export type InstallStatus = { kind: "next"; at: number } | { kind: "paused"; schedule: string } | { kind: "ask"; label: string }

export function installStatus(install: RecipeInstall, card: RecipeCard): InstallStatus {
  const routines = install.routines ?? []
  const active = routines.filter((r) => r.status === "active")
  if (active.length) return { kind: "next", at: Math.min(...active.map((r) => r.dueUtc)) }
  if (routines.length) return { kind: "paused", schedule: triggerLabel(routines[0].trigger, routines[0].tz) }
  return { kind: "ask", label: card.when }
}

const formats = new Map<string, Intl.DateTimeFormat>()

const formatter = (locale: string, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
  const id = `${locale}|${key}|${JSON.stringify(options)}`
  let found = formats.get(id)
  if (!found) formats.set(id, (found = new Intl.DateTimeFormat(locale, options)))
  return found
}

const dayNumber = (ms: number, tz?: string): number => {
  const [y, m, d] = formatter("en-CA", "ymd", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms).split("-").map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

export function nextLabel(at: number, now: number, tz?: string): string {
  const time = formatter("en-US", "hm", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at)
  const days = dayNumber(at, tz) - dayNumber(now, tz)
  if (days === 0) return `Today at ${time}`
  if (days === 1) return `Tomorrow at ${time}`
  if (days > 1 && days <= 6) return `${formatter("en-US", "wd", { timeZone: tz, weekday: "short" }).format(at)} at ${time}`
  return `${formatter("en-US", "md", { timeZone: tz, month: "short", day: "numeric" }).format(at)} at ${time}`
}

export function nextRunLabel(at: number, now: number, tz?: string): string {
  return `Next run ${nextLabel(at, now, tz).replace(/^(Today|Tomorrow)/, (day) => day.toLowerCase())}`
}

export function byChatOrder(installs: readonly RecipeInstall[], chatOrder: readonly string[]): RecipeInstall[] {
  const rank = (roomId: string) => {
    const i = chatOrder.indexOf(roomId)
    return i === -1 ? Number.POSITIVE_INFINITY : i
  }
  return [...installs].sort((a, b) => rank(a.roomId) - rank(b.roomId))
}

export function recipeForRoutine(cards: readonly RecipeCard[], routineName: string): RecipeCard | undefined {
  return cards.find((c) => c.title.toLowerCase() === routineName)
}
