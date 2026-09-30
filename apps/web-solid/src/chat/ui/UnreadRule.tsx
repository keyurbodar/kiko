import { cn } from "../../lib/cn"

/**
 * The new-messages rule. `retiring` collapses the row to zero height by way of a
 * `0fr` grid track, so the line is simply gone the moment the viewer sends —
 * nothing animates and nothing is kept mounted waiting for a timeout.
 *
 * The two hairlines are the rule's own `::before` / `::after`, so they are the
 * same element in every state and cost no extra node. The fill behind them is
 * the accent at 45%, which is a fill rather than a border: there is no border
 * anywhere in this surface.
 */
export function UnreadRule(props: { retiring: boolean; class?: string }) {
  return (
    <div
      class={cn(
        "chat-unread-slot grid grid-rows-[1fr] data-[retiring]:grid-rows-[0fr]",
        props.class,
      )}
      data-retiring={props.retiring ? "" : undefined}
    >
      <div class="chat-unread-clip min-h-0 overflow-hidden">
        <div
          class={cn(
            "chat-unread mx-auto flex w-full max-w-(--content-max-w) items-center gap-2.5",
            "px-4 pt-3 pb-2",
            "before:h-px before:grow before:bg-[color-mix(in_oklch,var(--accent)_45%,transparent)]",
            "after:h-px after:grow after:bg-[color-mix(in_oklch,var(--accent)_45%,transparent)]",
          )}
          data-component="chat-unread-rule"
          role="separator"
          aria-label="new messages"
        >
          <span class="chat-unread__label shrink-0 text-xs font-medium text-accent lowercase">
            new messages
          </span>
        </div>
      </div>
    </div>
  )
}
