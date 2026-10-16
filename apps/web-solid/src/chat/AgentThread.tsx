import { HugeIcon } from "@kiko/ui/huge-icon"
import { ChatIcon, ChevronDownIcon } from "@kiko/ui/icons"
import type { JSX } from "solid-js"
import { cn } from "../lib/cn"
import { threadLabel } from "./lib/event-line"
import { EventDivider } from "./ui/EventDivider"

export function AgentThread(props: {
  names: readonly string[]
  count: number
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <EventDivider icon={ChatIcon} data-component="chat-agent-thread">
      <button
        type="button"
        class="flex min-w-0 cursor-pointer items-center gap-1 hover:text-foreground"
        aria-expanded={props.expanded}
        onClick={() => props.onToggle()}
      >
        <span class="truncate">{threadLabel(props.names, props.count)}</span>
        <HugeIcon icon={ChevronDownIcon} size={12} class={cn("shrink-0", props.expanded && "rotate-180")} aria-hidden="true" />
      </button>
    </EventDivider>
  )
}
