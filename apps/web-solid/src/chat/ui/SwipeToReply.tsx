import { CornerUpLeft } from "lucide-solid"
import { type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { useSwipeToReply } from "../lib/useSwipeToReply"

export interface SwipeToReplyProps {
  /** Fires once, after the row has sprung back. */
  onCommit: () => void
  children: JSX.Element
  class?: string
}

/**
 * The row wrapper that carries the swipe-to-reply gesture. It writes
 * `--swipe-x` onto itself and the row's contents translate off it, so the
 * indicator underneath is revealed without anything re-rendering per move.
 *
 * Two gestures feed it: a pointer drag and a trackpad two-finger swipe, which
 * arrives as `wheel`. Both work on every message in either direction, so there
 * is no side to pass in — the wrapper learns which edge to put the indicator on
 * from the direction the reader actually swiped, and mirrors it onto the row as
 * `data-swipe-side`.
 *
 * The gesture is `@solid-primitives/pointer` plus the state machine in
 * `lib/useSwipeToReply`; nothing here is hand-rolled beyond the markup.
 *
 * `group/swipe` is how the indicator reads the row's own `data-swiping` and
 * `data-swipe-side`: the gesture owns those attributes on the row, and the
 * indicator only ever needs to know about the parent it sits in.
 */
export function SwipeToReply(props: SwipeToReplyProps) {
  const swipe = useSwipeToReply({
    onReply: props.onCommit,
  })

  return (
    <div
      // `ref` and the two data attributes are passed EXPLICITLY, not spread.
      // Spreading `handlers` reads its getters once, so `data-swiping` would
      // freeze at its initial value and never mark the row; and a `ref` that
      // arrives through a spread is not a ref at all in Solid, so the gesture
      // never received its element and the swipe did nothing.
      ref={swipe.handlers.ref}
      data-swiping={swipe.handlers["data-swiping"]}
      data-swipe-side={swipe.handlers["data-swipe-side"]}
      class={cn(
        "group/swipe relative flex touch-pan-y",
        // The gesture writes this; the default lives here because this element
        // owns the variable. Declaring it on the row below would shadow the
        // parent's value and pin every bubble at zero.
        "[--swipe-x:0px]",
        props.class,
      )}
      data-component="chat-swipe-row"
    >
      {/* No transform, deliberately: the gesture writes `--swipe-x` onto the
          row and the bubble already reads it, so translating this wrapper too
          would apply the travel twice — a 60px drag would move 120px and arm
          the reply at the wrong point. One owner for the variable. */}
      <div class="min-w-0 flex-1">{props.children}</div>
      <span
        class={cn(
          "pointer-events-none absolute top-1/2 z-0 hidden size-7 items-center justify-center rounded-full",
          "bg-[color-mix(in_oklch,var(--text)_10%,transparent)] text-text",
          // Scale and opacity are written by the gesture; reading them here is
          // what makes the indicator track the finger without a re-render.
          "[transform:translateY(-50%)_scale(var(--swipe-scale,0))] [opacity:var(--swipe-progress,0)]",
          // Nothing is drawn until the axis lock is behind us, so a tap leaves
          // no trace.
          "group-data-[swiping]/swipe:flex",
          "group-data-[swipe-side=start]/swipe:left-4 group-data-[swipe-side=end]/swipe:right-4",
        )}
        data-component="chat-swipe-indicator"
        aria-hidden="true"
      >
        <CornerUpLeft size={14} />
      </span>
    </div>
  )
}
