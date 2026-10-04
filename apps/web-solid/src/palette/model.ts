import * as glyphs from "@kiko/ui/icons"
import type { Glyph } from "@kiko/ui/icons"
import { commands, isEnabled, type Command } from "../commands/registry"

/** The palette's rows: enabled commands in registry order. The palette hides itself. */
export function paletteRows(list: readonly Command[] = commands()): Command[] {
  return list.filter((c) => c.group !== "palette" && !c.unlisted && isEnabled(c))
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
