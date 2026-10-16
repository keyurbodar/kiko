import { HugeIcon, type Glyph } from "@kiko/ui/huge-icon"
import type { JSX } from "solid-js"
import { cn } from "../../lib/cn"

/** A centered label between two lines, after t3code's context compaction row. */
export function EventDivider(props: { icon: Glyph; children: JSX.Element; class?: string; "data-message-id"?: string }): JSX.Element {
  return (
    <div
      role="separator"
      class={cn("mx-auto flex w-full max-w-(--chat-content-max-width) items-center gap-3 px-4 py-1 text-xs text-muted-foreground", props.class)}
      data-component="event-divider"
      data-message-id={props["data-message-id"]}
    >
      <span class="h-px flex-1 bg-border/70" />
      <span class="flex min-w-0 items-center gap-1.5">
        <HugeIcon icon={props.icon} size={12} class="shrink-0" />
        {props.children}
      </span>
      <span class="h-px flex-1 bg-border/70" />
    </div>
  )
}
