// Where the end of the transcript is, kept pure so VirtualThread.tsx only reads
// the DOM and applies the answer.

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
