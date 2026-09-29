import type { RosterGroup } from "../lib/types"

export type RosterSectionId = "pinned" | "groups" | "recent"

export interface RosterRecord {
  id: string
  name: string
  hay: string
  updatedAt: number
  pinned: boolean
}

export interface RosterSection {
  id: RosterSectionId
  header: string | null
  ids: string[]
}

export interface RosterOrder {
  searching: boolean
  sections: RosterSection[]
  flatIds: string[]
}

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const WEEK = 604_800_000

function byRecency(a: { updatedAt: number }, b: { updatedAt: number }): number {
  return b.updatedAt - a.updatedAt
}

function contains(needle: string, haystack: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

function section(id: RosterSectionId, ids: string[], header: string | null): RosterSection[] {
  if (ids.length === 0) return []
  return [{ id, header, ids }]
}

export function orderRoster(
  bots: readonly RosterRecord[],
  groups: readonly RosterGroup[],
  query: string,
): RosterOrder {
  const needle = query.trim().toLowerCase()

  if (needle.length > 0) {
    const groupIds = groups
      .filter((group) => contains(needle, group.name.toLowerCase()) || contains(needle, groupMemberNames(group, bots).toLowerCase()))
      .sort(byRecency)
      .map((group) => group.id)
    const botIds = bots
      .filter((bot) => contains(needle, bot.hay))
      .sort(byRecency)
      .map((bot) => bot.id)
    const sections = section("recent", [...groupIds, ...botIds], null)
    return { searching: true, sections, flatIds: sections.flatMap((entry) => entry.ids) }
  }

  const sections = [
    ...section(
      "pinned",
      bots.filter((bot) => bot.pinned).sort(byRecency).map((bot) => bot.id),
      "Pinned",
    ),
    ...section("groups", [...groups].sort(byRecency).map((group) => group.id), null),
    ...section(
      "recent",
      bots.filter((bot) => !bot.pinned).sort(byRecency).map((bot) => bot.id),
      null,
    ),
  ]
  return { searching: false, sections, flatIds: sections.flatMap((entry) => entry.ids) }
}

export function formatRosterTime(updatedAt: number, now: number): string {
  const elapsed = now - updatedAt
  if (elapsed < MINUTE) return "now"
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(updatedAt)
}

export function groupMemberNames(
  group: RosterGroup,
  bots: readonly { id: string; name: string }[],
): string {
  const namesById = new Map<string, string>()
  for (const bot of bots) namesById.set(bot.id, bot.name)
  const names: string[] = []
  for (const memberId of group.memberIds) {
    const name = namesById.get(memberId)
    if (name !== undefined) names.push(name)
  }
  return names.join(", ")
}

export function rowDomId(id: string): string {
  return `sidebar-row-${id}`
}

export function moveActiveId(
  flatIds: readonly string[],
  currentId: string | null,
  key: string,
): string | null {
  const last = flatIds.length - 1
  if (last < 0) return null

  const index = currentId === null ? -1 : flatIds.indexOf(currentId)

  switch (key) {
    case "ArrowDown":
    case "j":
      return index < 0 ? flatIds[0] : flatIds[Math.min(index + 1, last)]
    case "ArrowUp":
    case "k":
      return index < 0 ? flatIds[last] : flatIds[Math.max(index - 1, 0)]
    case "Home":
      return flatIds[0]
    case "End":
      return flatIds[last]
    default:
      return currentId
  }
}
