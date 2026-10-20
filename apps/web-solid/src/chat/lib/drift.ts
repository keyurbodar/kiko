export const AT_BOTTOM_THRESHOLD_PX = 32

export function isAtBottom(
  scrollOffset: number,
  scrollSize: number,
  viewportSize: number,
  thresholdPx: number,
): boolean {
  return scrollSize - viewportSize - scrollOffset <= thresholdPx
}
