import { ICONS, type IconKey } from "@kiko/ui/icons"
import { commands, isEnabled, type Command } from "../commands/registry"

/** The palette's rows: enabled commands in registry order. The palette hides itself. */
export function paletteRows(list: readonly Command[] = commands()): Command[] {
  return list.filter((c) => c.group !== "palette" && !c.unlisted && isEnabled(c))
}

/** Registry icon names that differ from kiko's icon names. */
const ALIASES: Record<string, IconKey> = { files: "folder", account: "user", pin: "pin" }

export const iconFor = (name: string): IconKey => ALIASES[name] ?? (name in ICONS ? (name as IconKey) : "command")
