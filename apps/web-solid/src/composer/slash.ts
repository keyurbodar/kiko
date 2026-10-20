import { findCommand, isEnabled, runCommand } from "../commands/registry"
import type { PromptInputV2Suggestion } from "./prompt-input/types"

interface Slash {
  trigger: string
  title: string
  commandId?: string
}

export const SLASH: readonly Slash[] = [
  { trigger: "new", title: "Start a new chat", commandId: "chat.new" },
  { trigger: "file", title: "Go to a file", commandId: "files.go" },
  { trigger: "search", title: "Search messages", commandId: "chats.search-all" },
  { trigger: "remind", title: "Ask for a reminder" },
  { trigger: "skill", title: "Use a skill" },
]

export function slashSuggestions(): PromptInputV2Suggestion[] {
  return SLASH.filter((s) => {
    if (!s.commandId) return true
    const command = findCommand(s.commandId)
    return command !== undefined && isEnabled(command)
  }).map((s) => ({
    id: `slash-${s.trigger}`,
    kind: "command",
    label: `/${s.trigger}`,
    trigger: s.trigger,
    title: s.title,
    description: s.title,
  }))
}

export function runSlash(text: string): boolean {
  const word = /^\/(\S+)\s*$/.exec(text.trim())?.[1]
  const slash = SLASH.find((s) => s.trigger === word)
  return slash?.commandId ? runCommand(slash.commandId) : false
}
