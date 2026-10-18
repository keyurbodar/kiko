/**
 * When a long bubble folds.
 *
 * A fixed 180 px limit folded almost every real answer: four lines on a desktop bubble, two on a
 * phone. The limit is a share of the window instead, so a medium message is simply shown, and only
 * one that would push the next message off screen is folded. A phone gets a taller share because
 * its column is narrow, so the same words take more lines.
 *
 * Pure and shared: the bubble measures against it, and the row-height estimate caps at it so a
 * folded message is not estimated at its full height.
 */

export function collapseLimit(viewportHeight: number, coarse: boolean): number {
  const share = coarse ? 0.85 : 0.72
  // A floor of 480 px is 3.5x the old 180 px limit, so a medium answer is simply shown. On a short
  // window the floor gives way, or a folded bubble would still be taller than the transcript.
  const floor = Math.min(coarse ? 360 : 480, Math.round(viewportHeight * 0.6))
  return Math.round(Math.max(floor, Math.min(coarse ? 760 : 900, viewportHeight * share)))
}

/**
 * Content is folded only when it is over the limit by a quarter. A message that hides two lines
 * behind a "Show full message" button costs more than it saves, so it is shown whole.
 */
export const FOLD_SLACK = 0.25

export function shouldFold(contentHeight: number, limit: number, fixed = false): boolean {
  return !fixed && contentHeight > limit * (1 + FOLD_SLACK)
}

/** The fold button's own height, added under a clamped body. */
export const FOLD_BUTTON_PX = 22

let cached: { height: number; coarse: boolean; limit: number } | undefined

/** The limit for this window right now. Cached, because every row asks for it on every render. */
export function currentLimit(): number {
  const height = globalThis.innerHeight ?? 900
  const coarse = globalThis.matchMedia?.("(pointer: coarse)").matches ?? false
  if (!cached || cached.height !== height || cached.coarse !== coarse) cached = { height, coarse, limit: collapseLimit(height, coarse) }
  return cached.limit
}
