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

const choiceItem = (c: Choice): Item => ({ key: c.id, title: c.title, icon: c.icon, seed: c.seed, chatId: c.chatId, detail: c.detail, file: c.file, current: c.current, run: c.run })

/** A search view's rows under their headings. A heading starts a new group when it changes. */
export function searchGroups(parent: Command, query: string): PaletteGroup[] {
  const groups: PaletteGroup[] = []
  for (const c of parent.search?.(query) ?? []) {
    const label = c.group ?? null
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(choiceItem(c))
    else groups.push({ label, items: [choiceItem(c)] })
  }
  return groups
}

/** What an empty search view says. */
export const emptyText = (parent: Command | undefined, query: string): string =>
  (query.trim() ? parent?.empty?.noMatch : parent?.empty?.none) ?? "No results"

/**
 * The list the stack points at. The root groups the enabled commands under their headings, in the
 * order their first row was registered. A submenu is the choices of its command. A stack whose
 * command is gone or disabled falls back to the root.
 */
export function viewFor(stack: readonly string[], list: readonly Command[] = commands()): View {
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
  return { placeholder: ROOT_PLACEHOLDER, groups: [...groups.values()] }
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
