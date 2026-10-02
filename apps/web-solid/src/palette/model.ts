import { commands, isEnabled, type Command } from "../commands/registry"

/** The palette's rows: enabled commands in registry order. The palette hides itself. */
export function paletteRows(list: readonly Command[] = commands()): Command[] {
  return list.filter((c) => c.group !== "palette" && isEnabled(c))
}

/** Registry icon names to names in the ui icon set. */
const ICONS: Record<string, string> = {
  menu: "menu",
  plus: "plus",
  undo: "reset",
  attach: "link",
  edit: "pencil-line",
  pin: "dot-grid",
  close: "close",
  trash: "trash",
  chat: "bubble-5",
  search: "magnifying-glass",
  command: "keyboard",
}

export const iconFor = (name: string): string => ICONS[name] ?? "dot-grid"
