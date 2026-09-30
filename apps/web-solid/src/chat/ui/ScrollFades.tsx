import { cn } from "../../lib/cn"

/**
 * The top and bottom scrims. They are static gradients painted over the
 * scroller's edges, not a fade on scroll: a `linear-gradient` to transparent
 * with no transition, so the reader learns there is more above or below without
 * anything moving.
 *
 * Each edge is only painted when there is genuinely something in that
 * direction. A gradient at the very top of a thread whose first row is on
 * screen would be a lie — it would dim a row that has nothing above it.
 */
export function ScrollFades(props: {
  /** False at the top of the range, where the first row is already on screen. */
  showTop: boolean
  /** False at the floor, where the last row is already on screen. */
  showBottom: boolean
  class?: string
}) {
  return (
    <div
      class={cn("chat-fades pointer-events-none absolute inset-0 z-[5]", props.class)}
      data-component="chat-fades"
      aria-hidden="true"
    >
      {props.showTop ? (
        <div
          class={cn(
            "chat-fades__top absolute inset-x-0 top-0 h-6",
            "bg-[linear-gradient(to_bottom,var(--bg),transparent)]",
          )}
          data-component="chat-fade-top"
        />
      ) : null}
      {props.showBottom ? (
        <div
          class={cn(
            "chat-fades__bottom absolute inset-x-0 bottom-0 h-6",
            "bg-[linear-gradient(to_top,var(--bg),transparent)]",
          )}
          data-component="chat-fade-bottom"
        />
      ) : null}
    </div>
  )
}
