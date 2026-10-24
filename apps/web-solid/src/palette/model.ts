import * as glyphs from "@kiko/ui/icons"
import type { Glyph } from "@kiko/ui/icons"
import { commands, isEnabled, shortcutOf, type Choice, type Command } from "../commands/registry"

export interface Item extends Omit<Choice, "id" | "group"> {
  key: string
  mark?: string
  chat?: boolean
  shortcut?: string
  submenu?: string
}

export interface PaletteGroup {
  label: string | null
  items: Item[]
}

export interface View {
  placeholder: string
  groups: PaletteGroup[]
  parent?: Command
}

export const enterLabel = (view: View): string => view.parent?.enter ?? "Select"

export const ROOT_PLACEHOLDER = "Search chats, files, agents, or type a command"

export const listed = (list: readonly Command[]): Command[] =>
  list.filter((c) => c.group !== "palette" && !c.unlisted && isEnabled(c))

export const choiceItem = ({ id, group: _group, ...rest }: Choice): Item => ({
  key: encodeURIComponent(id),
  ...rest,
})

export const commandItem = (c: Command): Item => ({
  key: encodeURIComponent(c.id),
  title: c.title,
  icon: c.icon,
  shortcut: shortcutOf(c),
  submenu: c.submenu || c.search ? c.id : undefined,
  run: c.run,
})

export const searchGroups = (parent: Command, query: string): PaletteGroup[] =>
  groupChoices(parent.search?.(query) ?? [], parent.highlight ? query.trim() : undefined)

function groupChoices(choices: readonly Choice[], mark?: string): PaletteGroup[] {
  const groups: PaletteGroup[] = []
  for (const c of choices) {
    const label = c.group ?? null
    const item = { ...choiceItem(c), mark }
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

export function emptyText(parent: Command | undefined, query: string): string {
  const state = parent?.state?.()
  if (state === "error") return "Search is not reachable"
  if (state === "loading") return "Searching…"
  return (query.trim() ? parent?.empty?.noMatch : parent?.empty?.none) ?? "No results"
}

export function viewFor(stack: readonly string[], list: readonly Command[] = commands()): View {
  const parent = stack.length
    ? list.find((c) => c.id === stack[stack.length - 1] && (c.submenu || c.search) && isEnabled(c))
    : undefined
  if (parent?.search) return { parent, placeholder: parent.placeholder ?? "Search…", groups: [] }
  if (parent?.submenu) {
    return { parent, placeholder: parent.placeholder ?? "Search…", groups: groupChoices(parent.submenu()) }
  }
  return { placeholder: ROOT_PLACEHOLDER, groups: [] }
}

export function createPreview() {
  let undo: (() => void) | null = null
  return {
    show(item: Item | undefined) {
      if (item?.preview) undo = item.preview()
      else this.restore()
    },
    keep() {
      undo = null
    },
    restore() {
      undo?.()
      undo = null
    },
  }
}

export const backspaceLeaves = (stack: readonly string[], query: string): boolean => stack.length > 0 && query === ""

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
  chevron: glyphs.ChevronRightIcon,
  copy: glyphs.CopyIcon,
  leaf: glyphs.LeafIcon,
  folder: glyphs.FolderIcon,
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
  globe: glyphs.GlobeIcon,
}

export const iconFor = (name: string): Glyph => ICONS[name] ?? glyphs.CommandIcon

export const keyChips = (display: string): string[] =>
  display.length > 1 && display.includes("+")
    ? display.split("+").filter(Boolean)
    : (display.match(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g) ?? [])

const inOrder = (word: string, text: string): boolean => {
  let at = 0
  for (const ch of word) {
    at = text.indexOf(ch, at) + 1
    if (at === 0) return false
  }
  return true
}

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

export const filterGroups = (groups: readonly PaletteGroup[], query: string): PaletteGroup[] =>
  query
    ? groups
        .map((g) => ({
          ...g,
          items: g.items
            .map((i) => ({
              i,
              s: Math.max(matchScore(query, i.title, g.label ?? ""), matchScore(query, i.detail ?? "", "") * 0.5),
            }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => x.i),
        }))
        .filter((g) => g.items.length)
    : [...groups]
