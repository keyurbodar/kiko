/**
 * The top and bottom scrims. They are static gradients painted over the
 * scroller's edges, not a fade on scroll: a `linear-gradient` to `var(--bg)`
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
}) {
  return (
    <div class="chat-fades" data-component="chat-fades" aria-hidden="true">
      {props.showTop ? (
        <div class="chat-fades__top" data-component="chat-fade-top" />
      ) : null}
      {props.showBottom ? (
        <div class="chat-fades__bottom" data-component="chat-fade-bottom" />
      ) : null}
    </div>
  )
}
