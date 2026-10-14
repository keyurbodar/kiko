import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChevronDownIcon } from "@kiko/ui/icons"
import type { JSX } from "solid-js"
import { cn } from "../lib/cn"
import { ChatAvatar } from "../lib/IdentityAvatar"

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

export const messageCount = (n: number) => `${n} ${n === 1 ? "message" : "messages"}`

export function AgentThread(props: {
  slugs: readonly string[]
  names: readonly string[]
  count: number
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div class="mx-auto flex w-full max-w-(--chat-content-max-width) px-4 pt-(--run-gap) pb-(--row-gap)" data-component="chat-agent-thread">
      <button
        type="button"
        class="flex min-w-0 cursor-pointer items-center gap-2 rounded-full bg-card py-1 ps-1.5 pe-3 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={props.expanded}
        onClick={() => props.onToggle()}
      >
        <ChatAvatar faces={props.slugs} size={20} />
        <span class="truncate">{joinNames(props.names)}</span>
        <span aria-hidden="true">·</span>
        <span class="shrink-0">{messageCount(props.count)}</span>
        <HugeIcon icon={ChevronDownIcon} class={cn("size-3.5 shrink-0", props.expanded && "rotate-180")} aria-hidden="true" />
      </button>
    </div>
  )
}
