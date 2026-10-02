import { createRoot, createSignal, getOwner, onCleanup } from "solid-js"

/*
 * The one registry of app actions. The keyboard, the palette, and the menus
 * all read it and call `run`, so an action has exactly one implementation.
 *
 * A route or feature registers its commands on mount with `useCommands` and
 * they leave on unmount. Registering an id twice keeps the newest entry, and
 * its unregister only removes its own entry.
 */
export type CommandGroup = "view" | "chat" | "chats" | "palette" | "go" | "settings" | "account"

export interface Command {
  /** Stable id, `group.verb`, for example `chat.new`. */
  id: string
  /** Lowercase `noun: verb`, shown in the palette, for example `chat: new`. */
  title: string
  group: CommandGroup
  /** An icon name. The palette maps it to a glyph, so this file imports none. */
  icon: string
  /** A TanStack hotkey string, for example `Mod+Shift+T` or `F2`. */
  shortcut?: string
  /** A second key for the same action. The cheatsheet shows `shortcut` only. */
  alias?: string
  /** A global shortcut also fires while a text field has focus. */
  global?: boolean
  /** The key is not consumed: a dialog above still gets it. For Escape, which every layer uses. */
  passive?: boolean
  /** Enabled while this returns true. Absent means always enabled. */
  when?: () => boolean
  run: () => void
}

const [list, setList] = createRoot(() => createSignal<readonly Command[]>([]))

/** Every registered command, in registration order. Reactive. */
export const commands = list

export function isEnabled(command: Command): boolean {
  return command.when ? command.when() : true
}

/** Register commands. Returns the function that removes exactly these entries. */
export function registerCommands(added: readonly Command[]): () => void {
  setList((current) => [
    ...current.filter((c) => !added.some((a) => a.id === c.id)),
    ...added,
  ])
  return () => setList((current) => current.filter((c) => !added.includes(c)))
}

/** Register for the life of the calling component or route. */
export function useCommands(added: readonly Command[]): void {
  const remove = registerCommands(added)
  if (getOwner()) onCleanup(remove)
}

export function findCommand(id: string): Command | undefined {
  return list().find((c) => c.id === id)
}

/** Run a command by id. A missing or disabled command does nothing. */
export function runCommand(id: string): boolean {
  const command = findCommand(id)
  if (!command || !isEnabled(command)) return false
  command.run()
  return true
}

export interface ShortcutEntry {
  id: string
  title: string
  group: CommandGroup
  shortcut: string
  global: boolean
  enabled: boolean
}

/** Every command that has a shortcut. The cheatsheet reads this. */
export function shortcuts(): ShortcutEntry[] {
  return list()
    .filter((c): c is Command & { shortcut: string } => Boolean(c.shortcut))
    .map((c) => ({
      id: c.id,
      title: c.title,
      group: c.group,
      shortcut: c.shortcut,
      global: c.global ?? false,
      enabled: isEnabled(c),
    }))
}
