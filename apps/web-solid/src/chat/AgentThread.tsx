import { HugeIcon } from "@kiko/ui/huge-icon"
import type { JSX } from "solid-js"
import { cn } from "../lib/cn"
import { ChatAvatar } from "../lib/IdentityAvatar"

/** "kiko and piko", "kiko, piko and ada". Lowercase, like every interface string. */
export function joinNames(names: readonly string[]): string {
  const low = names.map((n) => n.toLowerCase())
  if (low.length <= 1) return low[0] ?? ""
  return `${low.slice(0, -1).join(", ")} and ${low.at(-1)}`
}

/** "1 message", "3 messages". */
export const messageCount = (n: number) => `${n} ${n === 1 ? "message" : "messages"}`

/**
 * Agents talking to each other, folded into one muted line with a count. A click opens it in
 * place: the messages follow the line as ordinary bubbles, and the line stays as the way to
 * fold them again. The human reads it when they want to, and the transcript stays theirs.
 */
export function AgentThread(props: {
  slugs: readonly string[]
  names: readonly string[]
  count: number
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <div class="mx-auto flex w-full max-w-(--content-max-w) px-4 pt-(--run-gap) pb-(--row-gap)" data-component="chat-agent-thread">
      <button
        type="button"
        class="flex min-w-0 cursor-pointer items-center gap-2 rounded-full bg-bg-subtle py-1 ps-1.5 pe-3 text-xs text-weak lowercase hover:text-text"
        aria-expanded={props.expanded}
        onClick={() => props.onToggle()}
      >
        <ChatAvatar faces={props.slugs} size={20} />
        <span class="truncate">{joinNames(props.names)}</span>
        <span aria-hidden="true">·</span>
        <span class="shrink-0">{messageCount(props.count)}</span>
        <HugeIcon name="chevron-down" class={cn("size-3.5 shrink-0", props.expanded && "rotate-180")} aria-hidden="true" />
      </button>
    </div>
  )
}
