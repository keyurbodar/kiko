import { createRoot, createSignal, getOwner, onCleanup } from "solid-js"
import { bindings } from "./bindings"

/*
 * The one registry of app actions. The keyboard, the palette, and the menus
 * all read it and call `run`, so an action has exactly one implementation.
 *
 * A route or feature registers its commands on mount with `useCommands` and
 * they leave on unmount. Registering an id twice keeps the newest entry, and
 * its unregister only removes its own entry.
 */
export type CommandGroup = "view" | "chat" | "chats" | "palette" | "go" | "settings" | "account" | "theme" | "browser"

/** Each group's heading, in the palette and in the shortcut settings. */
export const GROUP_LABEL: Record<CommandGroup, string> = {
  view: "View",
  chat: "Chat",
  chats: "Chats",
  palette: "Palette",
  go: "Go to",
  settings: "Settings",
  account: "Account",
  theme: "Theme",
  browser: "Browser",
}

/** One option inside a command's submenu: an agent, a chat, an appearance. */
export interface Choice {
  id: string
  title: string
  /** An icon name, as on a command. */
  icon?: string
  /** Draws an agent's generated avatar. */
  seed?: string
  /** Draws the avatar of the chat with this id, from its members' faces. */
  chatId?: string
  /** A second, muted line under the title. */
  detail?: string
  /** A message excerpt for the second line, with the search's match markers. */
  snippet?: string
  /** A color dot before the check. */
  swatch?: string
  /** Draws this path's file icon. */
  file?: string
  /** The heading above this option. Consecutive options with one heading share a group. */
  group?: string
  /** The option that is on now. It gets a check. */
  current?: boolean
  /** Shows this option while it is highlighted, without choosing it. Returns what puts things back. */
  preview?: () => () => void
  run: () => void
}

export interface Command {
  /** Stable id, `group.verb`, for example `chat.new`. */
  id: string
  /** Sentence case, shown in the palette under its group's heading, for example `New chat`. */
  title: string
  group: CommandGroup
  /** An icon name. The palette maps it to a glyph, so this file imports none. */
  icon: string
  /** The default key, a TanStack hotkey string such as `Mod+Shift+T` or `F2`. Read `shortcutOf` for the key in use. */
  shortcut?: string
  /** A second default key for the same action. Only `shortcut` is shown. The owner's own key replaces both. */
  alias?: string
  /** A global shortcut also fires while a text field has focus. */
  global?: boolean
  /** The key is not consumed: a dialog above still gets it. For Escape, which every layer uses. */
  passive?: boolean
  /** Left out of the palette; the key and its on-screen hint still work. For numbered jumps. */
  unlisted?: boolean
  /** Enabled while this returns true. Absent means always enabled. */
  when?: () => boolean
  /** The palette opens these as a second list, under a chevron. `run` then opens that list too, for a shortcut. */
  submenu?: () => readonly Choice[]
  /**
   * A submenu that ranks its own options. The palette hands it the query on every keystroke and shows
   * what it returns in that order, so a long list costs only the rows it returns.
   */
  search?: (query: string) => readonly Choice[]
  /** A search whose rows arrive later is told the query on each keystroke, and with "" when the view closes. */
  onQuery?: (query: string) => void
  /** Whether the rows of a late search are still coming or could not come. */
  state?: () => "loading" | "error" | undefined
  /** The query is marked in each row's title and detail. */
  highlight?: boolean
  /** What Enter does in the submenu, for the footer hint. Defaults to "Select". */
  enter?: string
  /** What the search view says when it has no rows: with no query, and with one. */
  empty?: { none: string; noMatch: string }
  /** The search hint inside the submenu. */
  placeholder?: string
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

/** The keys a command answers to: the owner's own, or else its defaults. */
export function keysOf(command: Command): string[] {
  const own = bindings()
  if (command.id in own) return own[command.id] ? [own[command.id]!] : []
  return [command.shortcut, command.alias].filter((k): k is string => Boolean(k))
}

/** The key shown for a command, if it has one. Reactive. */
export function shortcutOf(command: Command): string | undefined {
  return keysOf(command)[0]
}
