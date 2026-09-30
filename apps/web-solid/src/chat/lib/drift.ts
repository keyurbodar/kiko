// The scroll shell's two pieces of arithmetic, kept pure so the DOM code in
// VirtualThread.tsx only has to read the DOM and apply the answer.
//
// Both of these exist because a virtualized transcript is measured twice: once
// from an estimate before the row exists, and once from the real element after
// it renders. Everything here is about the second measurement not surprising
// the reader.

/**
 * Sub-pixel noise is not drift. A row whose measured height disagrees with its
 * estimate by less than half a pixel leaves subpixel layout where it was; the
 * browser has already decided where things sit, and correcting it would only
 * move the viewport for a difference nobody can see.
 */
export const DRIFT_EPSILON = 0.5

/**
 * How close to the floor counts as "at the bottom".
 *
 * Not a physical floor — a reader who has scrolled to within a row of the end
 * is reading the end, and a message arriving must not stop them from seeing
 * it. The exact floor is a separate, much tighter question.
 */
export const AT_BOTTOM_THRESHOLD_PX = 32

/**
 * Whether the viewport is within `thresholdPx` of the bottom of the scroll
 * range. `scrollSize - viewportSize` is the furthest `scrollOffset` can be,
 * so the difference is the remaining distance to the floor.
 */
export function isAtBottom(
  scrollOffset: number,
  scrollSize: number,
  viewportSize: number,
  thresholdPx: number,
): boolean {
  return scrollSize - viewportSize - scrollOffset <= thresholdPx
}

/**
 * The `scrollBy` that puts the anchored row back where the reader was looking.
 *
 * A row that grows above the reading line pushes everything below it down.
 * Scrolling by exactly the drift cancels that, so the row the reader was on
 * does not move.
 *
 * Returns 0 when there is nothing to correct, for two reasons that are not
 * interchangeable:
 *
 * - At the bottom there is no fixed row to preserve. The reader's position is
 *   "the end", and the end is wherever the content now ends, so correcting
 *   would fight the pin.
 * - A non-finite drift means a row detached mid-measurement. Its rect is zero
 *   or garbage, and scrolling by that would throw the viewport somewhere
 *   arbitrary. Better to leave the reader alone and re-seed the anchor.
 */
export function driftCompensation(drift: number, atBottom: boolean): number {
  if (atBottom || !Number.isFinite(drift)) return 0
  return Math.abs(drift) > DRIFT_EPSILON ? drift : 0
}
