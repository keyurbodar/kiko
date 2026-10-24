import { type CommandId, findCommand, isEnabled, runCommand } from "../commands/registry"
import type { Token } from "./tokens"

interface Slash {
  trigger: string
  title: string
  commandId?: CommandId
}

const SLASH: readonly Slash[] = [
  { trigger: "new", title: "Start a new chat", commandId: "chat.new" },
  { trigger: "file", title: "Go to a file", commandId: "files.go" },
  { trigger: "search", title: "Search messages", commandId: "chats.search-all" },
  { trigger: "remind", title: "Remind me" },
  { trigger: "skill", title: "Use a skill" },
]

export function slashTokens(): Token[] {
  return SLASH.filter((s) => {
    if (!s.commandId) return true
    const command = findCommand(s.commandId)
    return command !== undefined && isEnabled(command)
  }).map((s) => ({
    kind: "command",
    id: `slash-${s.trigger}`,
    trigger: s.trigger,
    title: s.title,
    hint: `/${s.trigger}`,
  }))
}

export function runSlash(text: string): boolean {
  const word = /^\/(\S+)\s*$/.exec(text.trim())?.[1]
  const slash = SLASH.find((s) => s.trigger === word)
  return slash?.commandId ? runCommand(slash.commandId) : false
}
