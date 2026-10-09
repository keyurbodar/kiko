/*
 * Phone swipes for the two panes that cover the chat: from the left edge the drawer opens, a
 * leftward swipe on the drawer or its scrim closes it, and a rightward swipe on the info panel
 * closes it. Each is decided once, when the finger lifts, so nothing animates (yuki is instant).
 */

/** A touch that starts this close to the left edge can open the drawer. */
export const EDGE_PX = 20
/** The least horizontal travel that counts as a swipe. */
export const SWIPE_PX = 56

export type SwipeRegion = "edge" | "drawer" | "scrim" | "info" | "other"
export type SwipeAction = "open-drawer" | "close-drawer" | "close-info"

/** What a finished horizontal swipe means, or null when it means nothing here. */
export function swipeAction(open: { drawer: boolean; info: boolean }, region: SwipeRegion, dx: number, dy: number): SwipeAction | null {
  // Mostly sideways, and far enough, or it was a scroll or a tap.
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) return null
  if (open.drawer) return dx < 0 && (region === "drawer" || region === "scrim") ? "close-drawer" : null
  if (open.info && region === "info") return dx > 0 ? "close-info" : null
  return region === "edge" && dx > 0 ? "open-drawer" : null
}

/** Where a touch began. */
export function swipeRegion(target: EventTarget | null, x: number): SwipeRegion {
  const element = target instanceof Element ? target : null
  if (element?.closest('[data-component="drawer-scrim"]')) return "scrim"
  if (element?.closest(".sidebar-shell > .panel")) return "drawer"
  if (element?.closest('[data-component="info-panel"]')) return "info"
  return x <= EDGE_PX ? "edge" : "other"
}
