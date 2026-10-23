import { createRoot, createSignal, getOwner, onCleanup } from "solid-js"
import { bindings } from "./bindings"

export type CommandGroup = "view" | "chat" | "chats" | "palette" | "go" | "settings" | "account" | "theme" | "browser"

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

export interface Choice {
  id: string
  title: string
  icon?: string
  seed?: string
  chatId?: string
  detail?: string
  snippet?: string
  swatch?: string
  file?: string
  group?: string
  current?: boolean
  preview?: () => () => void
  run: () => void
}

export interface Command {
  id: string
  title: string
  group: CommandGroup
  icon: string
  shortcut?: string
  alias?: string
  global?: boolean
  passive?: boolean
  unlisted?: boolean
  when?: () => boolean
  submenu?: () => readonly Choice[]
  search?: (query: string) => readonly Choice[]
  onQuery?: (query: string) => void
  state?: () => "loading" | "error" | undefined
  highlight?: boolean
  enter?: string
  empty?: { none: string; noMatch: string }
  placeholder?: string
  run: () => void
}

const [list, setList] = createRoot(() => createSignal<readonly Command[]>([]))

export const commands = list

export function isEnabled(command: Command): boolean {
  return command.when ? command.when() : true
}

function registerCommands(added: readonly Command[]): () => void {
  setList((current) => [...current.filter((c) => !added.some((a) => a.id === c.id)), ...added])
  return () => setList((current) => current.filter((c) => !added.includes(c)))
}

export function useCommands(added: readonly Command[]): void {
  const remove = registerCommands(added)
  if (getOwner()) onCleanup(remove)
}

export function findCommand(id: string): Command | undefined {
  return list().find((c) => c.id === id)
}

export function runCommand(id: string): boolean {
  const command = findCommand(id)
  if (!command || !isEnabled(command)) return false
  command.run()
  return true
}

export function keysOf(command: Command): string[] {
  const own = bindings()
  if (command.id in own) return own[command.id] ? [own[command.id]!] : []
  return [command.shortcut, command.alias].filter((k): k is string => Boolean(k))
}

export function shortcutOf(command: Command): string | undefined {
  return keysOf(command)[0]
}
