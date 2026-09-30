import { CornerUpLeft } from "lucide-solid"
import { createSignal, type JSX } from "solid-js"
import { useSwipeToReply, type SwipeSide } from "../lib/useSwipeToReply"
import "../interactions.css"

export interface SwipeToReplyProps {
  /** Which corner the indicator is pinned to, and therefore which way to drag. */
  side: SwipeSide
  /** Fires once, after the row has sprung back. */
  onCommit: () => void
  children: JSX.Element
}

/**
 * The row wrapper that carries the swipe-to-reply gesture. It writes
 * `--swipe-x` onto itself and the row's contents translate off it, so the
 * indicator underneath is revealed without anything re-rendering per move.
 */
export function SwipeToReply(props: SwipeToReplyProps) {
  const [row, setRow] = createSignal<HTMLElement>()
  const swipe = useSwipeToReply({
    row,
    side: () => props.side,
    onReply: props.onCommit,
  })

  return (
    <div class="chat-swipe-row" data-component="chat-swipe-row" {...swipe.handlers}>
      <div class="chat-swipe-content">{props.children}</div>
      <span class="chat-swipe-indicator" data-component="chat-swipe-indicator" aria-hidden="true">
        <CornerUpLeft size={14} />
      </span>
    </div>
  )
}
