import { fileName } from "@kiko/protocol"
import { formatBytes } from "../lib/format"
import { dayStartOf } from "../chat/lib/day-start"
import type { Choice } from "../commands/registry"
import { buildIndex, dirname, folderLabel, pathsUnder, ROOT } from "../files/model"
import { choiceItem, matchScore, type Item, type PaletteGroup } from "./model"
import type { FileEntry } from "./sources"
import type { PaletteTab } from "./state"

export interface TabData {
  chats: readonly Choice[]
  unread: readonly Choice[]
  agents: readonly Choice[]
  recipes: readonly Choice[]
  settings: readonly Choice[]
  messages: readonly Choice[]
  files: readonly FileEntry[]
  recent: readonly string[]
  folder: readonly string[]
  commands: readonly Item[]
  doCommands: readonly Item[]
  agentDo: readonly Item[]
  settingsDo: readonly Item[]
  now: number
  open: (entry: FileEntry) => void
  enter: (path: string) => void
}

const DAY = 24 * 60 * 60 * 1000
const RECENT_CHATS = 3
const PER_GROUP = 4
const FILE_RECENTS = 5

export const sinceLabel = (at: number | undefined, now: number): string => {
  if (at === undefined) return "Earlier"
  const days = Math.round((dayStartOf(now) - dayStartOf(at)) / DAY)
  return days < 1 ? "Today" : days < 7 ? "This week" : "Earlier"
}

const substring = (query: string, text: string): number => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const lower = text.toLowerCase()
  return words.length && words.every((w) => lower.includes(w)) ? 1 : 0
}

const score = (query: string, c: Choice): number =>
  Math.max(matchScore(query, c.title, ""), substring(query, c.detail ?? "") * 0.5)

const rank = (query: string, list: readonly Choice[], min = 0): Choice[] =>
  list
    .map((c) => ({ c, s: score(query, c) }))
    .filter((x) => x.s > min)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c)

const items = (list: readonly Choice[], mark: string, chat?: boolean): Item[] =>
  list.map((c) => ({ ...choiceItem(c), ...(mark ? { mark } : {}), ...(chat ? { chat: true } : {}) }))

const group = (label: string | null, list: Item[]): PaletteGroup[] => (list.length ? [{ label, items: list }] : [])

const commandMatches = (query: string, list: readonly Item[]): Item[] =>
  list
    .map((i) => ({ i, s: matchScore(query, i.title, "") }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => ({ ...x.i, mark: query }))

const bySince = (list: readonly Choice[], now: number): PaletteGroup[] => {
  const order = ["Today", "This week", "Earlier"]
  const by = new Map<string, Item[]>()
  for (const c of list) {
    const label = sinceLabel(c.at, now)
    by.set(label, [...(by.get(label) ?? []), ...items([c], "", true)])
  }
  return order.flatMap((label) => group(label, by.get(label) ?? []))
}

function allTab(query: string, d: TabData): PaletteGroup[] {
  if (!query) {
    const needs = d.unread.slice(0, 3)
    const seen = new Set(needs.map((c) => c.chatId))
    const recent = d.chats.filter((c) => !seen.has(c.chatId)).slice(0, RECENT_CHATS)
    return [
      ...group("Needs you", items(needs, "", true)),
      ...group("Recent", items(recent, "", true)),
      ...group("Do", [...d.doCommands]),
    ]
  }
  if (query.startsWith(">")) return group("Commands", commandMatches(query.slice(1).trim(), d.commands))
  const loose = 0.3
  const pick = (list: readonly Choice[]) => items(rank(query, list, loose).slice(0, PER_GROUP), query)
  const best = (list: readonly Choice[]) => Math.max(0, ...list.map((c) => score(query, c)))
  const files = fileRows(query, d, PER_GROUP)
  const commands = commandMatches(query, d.commands).slice(0, PER_GROUP)
  const ranked: { label: string; rows: Item[]; best: number }[] = [
    { label: "Chats", rows: items(rank(query, d.chats, loose).slice(0, PER_GROUP), query, true), best: best(d.chats) },
    { label: "Commands", rows: commands, best: commands.length ? matchScore(query, commands[0]!.title, "") : 0 },
    { label: "Messages", rows: items(d.messages.slice(0, PER_GROUP), query), best: 0.55 },
    { label: "Files", rows: files, best: files.length ? 0.9 : 0 },
    { label: "Agents", rows: pick(d.agents), best: best(d.agents) },
    { label: "Recipes", rows: pick(d.recipes), best: best(d.recipes) },
    { label: "Settings", rows: pick(d.settings), best: best(d.settings) },
  ]
  return ranked
    .map((g, order) => ({ g, order }))
    .sort((a, b) => b.g.best - a.g.best || a.order - b.order)
    .flatMap((x) => group(x.g.label, x.g.rows))
}

const fileItem = (e: FileEntry, mark: string, open: TabData["open"], detail?: string): Item => ({
  key: encodeURIComponent(`file:${e.path}`),
  title: fileName(e.path),
  file: e.path,
  size: e.size,
  space: e.space,
  fileId: e.fileId,
  ...(detail ? { detail } : { meta: formatBytes(e.size) }),
  ...(mark ? { mark } : {}),
  run: () => open(e),
})

function fileRows(query: string, d: TabData, limit: number): Item[] {
  return d.files
    .map((e) => ({ e, s: Math.max(matchScore(query, fileName(e.path), ""), matchScore(query, e.path, "") * 0.6) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => fileItem(x.e, query, d.open, x.e.path.includes("/") ? folderLabel(dirname(x.e.path)) : undefined))
}

export function filesCrumbs(folder: readonly string[]): string[] {
  return folder.length ? ["Files", ...folder.map((_, i) => folderLabel(folder.slice(0, i + 1).join("/")))] : []
}

function filesTab(query: string, d: TabData): PaletteGroup[] {
  if (query) return group("Files", fileRows(query, d, 50))
  const paths = d.files.map((e) => e.path)
  const index = buildIndex(paths)
  const entry = new Map(d.files.map((e) => [e.path, e]))
  const dir = d.folder.join("/")
  const kids = index.children.get(dir || ROOT) ?? []
  const folderItem = (path: string): Item => ({
    key: encodeURIComponent(`folder:${path}`),
    title: folderLabel(path),
    icon: "folder",
    folder: true,
    path,
    meta: `${pathsUnder(paths, path).length} files`,
    run: () => d.enter(path),
  })
  const fileOf = (path: string) => fileItem(entry.get(path)!, "", d.open)
  const folders = kids.filter((k) => index.folders.has(k)).map(folderItem)
  const plain = kids.filter((k) => !index.folders.has(k) && entry.has(k)).map(fileOf)
  if (dir) return group(null, [...folders, ...plain])
  const recent = d.recent.filter((p) => entry.has(p)).slice(0, FILE_RECENTS)
  const rest = plain.filter((i) => !recent.includes(i.file!))
  return [
    ...group("Recent", recent.map(fileOf)),
    ...group("Folders", folders),
    ...group(recent.length || folders.length ? "Files" : null, rest),
  ]
}

function listTab(query: string, list: readonly Choice[], tail: readonly Item[], label?: string): PaletteGroup[] {
  const shown = query ? rank(query, list) : list
  return [...group(label ?? null, items(shown, query)), ...group("Do", query ? commandMatches(query, tail) : [...tail])]
}

function recipesTab(query: string, d: TabData): PaletteGroup[] {
  const shown = query ? rank(query, d.recipes) : d.recipes
  const labels = ["Yours", "Templates"]
  return labels.flatMap((label) =>
    group(
      label,
      items(
        shown.filter((c) => c.group === label),
        query,
      ),
    ),
  )
}

export function tabGroups(tab: PaletteTab, query: string, d: TabData): PaletteGroup[] {
  switch (tab) {
    case "all":
      return allTab(query, d)
    case "chats":
      return bySince(query ? rank(query, d.chats) : d.chats, d.now).map((g) => ({
        ...g,
        items: g.items.map((i) => (query ? { ...i, mark: query } : i)),
      }))
    case "agents":
      return listTab(query, d.agents, d.agentDo)
    case "files":
      return filesTab(query, d)
    case "recipes":
      return recipesTab(query, d)
    case "settings":
      return listTab(query, d.settings, d.settingsDo)
  }
}
