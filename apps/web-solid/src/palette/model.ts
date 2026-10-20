import * as glyphs from "@kiko/ui/icons"
import type { Glyph } from "@kiko/ui/icons"
import { commands, GROUP_LABEL, isEnabled, shortcutOf, type Choice, type Command, type CommandGroup } from "../commands/registry"

export interface Item {
  key: string
  title: string
  icon?: string
  seed?: string
  chatId?: string
  detail?: string
  file?: string
  snippet?: string
  swatch?: string
  mark?: string
  chat?: boolean
  shortcut?: string
  current?: boolean
  preview?: () => () => void
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
  parent?: Command
}

export const enterLabel = (view: View): string => view.parent?.enter ?? "Select"

const ROOT_PLACEHOLDER = "Search commands and chats…"

export const listed = (list: readonly Command[]): Command[] => list.filter((c) => c.group !== "palette" && !c.unlisted && isEnabled(c))

const commandItem = (c: Command): Item => ({
  key: c.id,
  title: c.title,
  icon: c.icon,
  shortcut: shortcutOf(c),
  submenu: c.submenu || c.search ? c.id : undefined,
  run: c.run,
})

const choiceItem = (c: Choice): Item => ({ key: c.id, title: c.title, icon: c.icon, seed: c.seed, chatId: c.chatId, detail: c.detail, file: c.file, snippet: c.snippet, swatch: c.swatch, current: c.current, preview: c.preview, run: c.run })

export const searchGroups = (parent: Command, query: string): PaletteGroup[] => groupChoices(parent.search?.(query) ?? [], parent.highlight ? query.trim() : undefined)

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

const RECENT_CHATS = 5

export function viewFor(stack: readonly string[], list: readonly Command[] = commands(), typed = false): View {
  const parent = stack.length ? list.find((c) => c.id === stack[stack.length - 1] && (c.submenu || c.search) && isEnabled(c)) : undefined
  if (parent?.search) return { parent, placeholder: parent.placeholder ?? "Search…", groups: [] }
  if (parent?.submenu) {
    return { parent, placeholder: parent.placeholder ?? "Search…", groups: groupChoices(parent.submenu()) }
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
  display.length > 1 && display.includes("+") ? display.split("+").filter(Boolean) : (display.match(/[⌘⇧⌥⌃]|[^⌘⇧⌥⌃]+/g) ?? [])

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

export function rowScore(search: string, title: string, group: string, chat: boolean): number {
  if (!search.startsWith(">")) return matchScore(search, title, group)
  return chat ? 0 : matchScore(search.slice(1), title, group)
}
