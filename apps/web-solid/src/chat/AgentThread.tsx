import { RemixIcon } from "@kiko/ui/remix-icon"
import { ChatIcon, ChevronDownIcon } from "@kiko/ui/icons"
import type { JSX } from "solid-js"
import { cn } from "../lib/cn"
import { threadLabel } from "./lib/event-line"
import { SystemRow } from "./ui/SystemRow"

export function AgentThread(props: {
  names: readonly string[]
  count: number
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <SystemRow icon={ChatIcon} label="" data-component="chat-agent-thread">
      <button
        type="button"
        class="flex min-w-0 cursor-pointer items-center gap-1 text-tertiary transition-colors hover:text-secondary"
        aria-expanded={props.expanded}
        data-disclosure=""
        onClick={() => props.onToggle()}
      >
        <span class="truncate">{threadLabel(props.names, props.count)}</span>
        <RemixIcon
          icon={ChevronDownIcon}
          size={12}
          class={cn("shrink-0", props.expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
    </SystemRow>
  )
}
