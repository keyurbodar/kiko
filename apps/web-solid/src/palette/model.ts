import * as glyphs from "@kiko/ui/icons"
import type { Glyph } from "@kiko/ui/icons"
import { commands, isEnabled, type Choice, type Command, type CommandGroup } from "../commands/registry"

/** Each group's heading. A title never repeats it. */
export const GROUP_LABEL: Record<CommandGroup, string> = {
  view: "View",
  chat: "Chat",
  chats: "Chats",
  palette: "Palette",
  go: "Go to",
  settings: "Settings",
  account: "Account",
  theme: "Theme",
}

/** One row. It either runs, or opens the submenu of the command with id `submenu`. */
export interface Item {
  key: string
  title: string
  icon?: string
  seed?: string
  chatId?: string
  /** The second, muted line. */
  detail?: string
  /** A path whose file icon leads the row. */
  file?: string
  snippet?: string
  swatch?: string
  /** The query to mark inside the title and detail. */
  mark?: string
  /** A chat row of the root list. A leading ">" in the search leaves these out. */
  chat?: boolean
  shortcut?: string
  current?: boolean
  submenu?: string
  run: () => void
}

export interface PaletteGroup {
  label: string | null
  items: Item[]
}

export interface View {
  placeholder: string
  groups: PaletteGroup[]
  /** The submenu's command, absent on the root list. */
  parent?: Command
}

/** What the footer says Enter does. */
export const enterLabel = (view: View): string => view.parent?.enter ?? "Select"

const ROOT_PLACEHOLDER = "Search commands and chats…"

/** The palette hides itself, and so do commands that are off or unlisted. */
export const listed = (list: readonly Command[]): Command[] => list.filter((c) => c.group !== "palette" && !c.unlisted && isEnabled(c))

const commandItem = (c: Command): Item => ({
  key: c.id,
  title: c.title,
  icon: c.icon,
  shortcut: c.shortcut,
  submenu: c.submenu || c.search ? c.id : undefined,
  run: c.run,
})

const choiceItem = (c: Choice): Item => ({ key: c.id, title: c.title, icon: c.icon, seed: c.seed, chatId: c.chatId, detail: c.detail, file: c.file, snippet: c.snippet, swatch: c.swatch, current: c.current, run: c.run })

/** A search view's rows under their headings. A heading starts a new group when it changes. */
export function searchGroups(parent: Command, query: string): PaletteGroup[] {
  const groups: PaletteGroup[] = []
  for (const c of parent.search?.(query) ?? []) {
    const label = c.group ?? null
    const item = { ...choiceItem(c), mark: parent.highlight ? query.trim() : undefined }
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

/** What an empty search view says. */
export function emptyText(parent: Command | undefined, query: string): string {
  const state = parent?.state?.()
  if (state === "error") return "Search is not reachable"
  if (state === "loading") return "Searching…"
  return (query.trim() ? parent?.empty?.noMatch : parent?.empty?.none) ?? "No results"
}

/** The chats the root list offers: the five latest when nothing is typed, else all of them to search. */
const RECENT_CHATS = 5

/**
 * The list the stack points at. The root groups the enabled commands under their headings, in the
 * order their first row was registered, then the chats. A submenu is the choices of its command. A stack whose
 * command is gone or disabled falls back to the root.
 */
export function viewFor(stack: readonly string[], list: readonly Command[] = commands(), typed = false): View {
  const parent = stack.length ? list.find((c) => c.id === stack[stack.length - 1] && (c.submenu || c.search) && isEnabled(c)) : undefined
  if (parent?.search) return { parent, placeholder: parent.placeholder ?? "Search…", groups: [] }
  if (parent?.submenu) {
    return { parent, placeholder: parent.placeholder ?? "Search…", groups: [{ label: null, items: parent.submenu().map(choiceItem) }] }
  }
  const groups = new Map<CommandGroup, PaletteGroup>()
  for (const c of listed(list)) {
    const group = groups.get(c.group) ?? { label: GROUP_LABEL[c.group], items: [] }
    group.items.push(commandItem(c))
    groups.set(c.group, group)
  }
  const jump = list.find((c) => c.id === "chats.go" && c.submenu && isEnabled(c))
  const chats = (jump?.submenu?.() ?? []).slice(0, typed ? undefined : RECENT_CHATS)
  const rows = [...groups.values()]
  if (chats.length) rows.push({ label: typed ? "Chats" : "Recent chats", items: chats.map((c) => ({ ...choiceItem(c), chat: true })) })
  return { placeholder: ROOT_PLACEHOLDER, groups: rows }
}

/** Backspace in an empty search leaves the submenu. With text in it, it deletes a letter. */
export const backspaceLeaves = (stack: readonly string[], query: string): boolean => stack.length > 0 && query === ""

/** Registry icon names to glyphs. The palette loads lazily, so its table costs the chat route nothing. */
const ICONS: Record<string, Glyph> = {
  menu: glyphs.MenuIcon,
  plus: glyphs.PlusIcon,
  undo: glyphs.UndoIcon,
  attach: glyphs.AttachIcon,
  edit: glyphs.EditIcon,
  pin: glyphs.PinIcon,
  close: glyphs.CloseIcon,
  trash: glyphs.TrashIcon,
  chat: glyphs.ChatIcon,
  search: glyphs.SearchIcon,
  command: glyphs.CommandIcon,
  files: glyphs.FolderIcon,
  board: glyphs.BoardIcon,
  settings: glyphs.SettingsIcon,
  key: glyphs.KeyIcon,
  model: glyphs.ModelIcon,
  integrations: glyphs.IntegrationsIcon,
  appearance: glyphs.AppearanceIcon,
  account: glyphs.UserIcon,
  signout: glyphs.SignoutIcon,
  info: glyphs.InfoIcon,
}

export const iconFor = (name: string): Glyph => ICONS[name] ?? glyphs.CommandIcon

/** `Ctrl+Shift+T` as one chip per key. A Mac chord such as `⌘⇧F2` has no separator, so each modifier symbol is a chip and the rest is one. */
export const keyChips = (display: string): string[] =>
  display.length > 1 && display.includes("+") ? display.split("+").filter(Boolean) : (display.match(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g) ?? [])

/**
 * How well a row matches the search, 0 for none. The title counts most, its group's heading less, and
 * letters in order least. Ids never count, so "theme" does not find "chat.model".
 */
export function matchScore(search: string, title: string, group: string): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return 1
  const t = title.toLowerCase()
  const g = group.toLowerCase()
  let total = 0
  for (const word of words) {
    const at = t.indexOf(word)
    const part = at === 0 || t[at - 1] === " " ? 1 : at > 0 ? 0.8 : g.includes(word) ? 0.4 : inOrder(word, t) ? 0.2 : 0
    if (part === 0) return 0
    total += part
  }
  return total / words.length
}

const inOrder = (word: string, text: string): boolean => {
  let at = 0
  for (const ch of word) {
    at = text.indexOf(ch, at) + 1
    if (at === 0) return false
  }
  return true
}

/** The score cmdk gets for a row. A leading ">" asks for commands only: chats score 0 and the rest match the text after it. */
export function rowScore(search: string, title: string, group: string, chat: boolean): number {
  if (!search.startsWith(">")) return matchScore(search, title, group)
  return chat ? 0 : matchScore(search.slice(1), title, group)
}
