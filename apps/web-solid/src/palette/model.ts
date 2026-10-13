import * as glyphs from "@kiko/ui/icons"
import type { Glyph } from "@kiko/ui/icons"
import { commands, isEnabled, type Command, type CommandGroup } from "../commands/registry"

/** The palette's rows: enabled commands in registry order. The palette hides itself. */
export function paletteRows(list: readonly Command[] = commands()): Command[] {
  return list.filter((c) => c.group !== "palette" && !c.unlisted && isEnabled(c))
}

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

export interface PaletteGroup {
  group: CommandGroup
  label: string
  rows: Command[]
}

/** The rows under their group's heading. Groups come in the order their first row is registered. */
export function paletteGroups(list: readonly Command[] = commands()): PaletteGroup[] {
  const groups = new Map<CommandGroup, PaletteGroup>()
  for (const command of paletteRows(list)) {
    const group = groups.get(command.group) ?? { group: command.group, label: GROUP_LABEL[command.group], rows: [] }
    group.rows.push(command)
    groups.set(command.group, group)
  }
  return [...groups.values()]
}

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
