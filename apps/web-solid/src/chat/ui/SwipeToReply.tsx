import { HugeIcon } from "@kiko/ui/huge-icon"
import { ReplyIcon } from "@kiko/ui/icons"
import { type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { useSwipeToReply } from "../lib/useSwipeToReply"

export interface SwipeToReplyProps {
  /** Fires once, on the release that armed it. */
  onCommit: () => void
  children: JSX.Element
  class?: string
}

/**
 * The row wrapper that carries the swipe-to-reply gesture, rightward only. It is
 * the full column width, so a swipe can start anywhere across the row. The
 * gesture writes the bubble's and the indicator's transforms directly; nothing
 * here re-renders while the finger moves.
 */
export function SwipeToReply(props: SwipeToReplyProps) {
  const swipe = useSwipeToReply({
    onReply: props.onCommit,
  })

  return (
    <div
      // Passed explicitly, not spread: a spread reads the getter once and a
      // spread `ref` is not a ref in Solid.
      ref={swipe.handlers.ref}
      data-swiping={swipe.handlers["data-swiping"]}
      class={cn("relative flex touch-pan-y", props.class)}
      data-component="chat-swipe-row"
    >
      <div class="min-w-0 flex-1">{props.children}</div>
      <span
        class={cn(
          "pointer-events-none absolute top-1/2 left-4 z-0 flex size-7 items-center justify-center rounded-full",
          "bg-[color-mix(in_oklch,var(--text)_10%,transparent)] text-text",
          "opacity-0 [transform:translateY(-50%)_scale(0.4)]",
        )}
        data-component="chat-swipe-indicator"
        aria-hidden="true"
      >
        <HugeIcon icon={ReplyIcon} size={14} />
      </span>
    </div>
  )
}
