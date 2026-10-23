export const EDGE_PX = 20
export const SWIPE_PX = 56

export type SwipeRegion = "edge" | "drawer" | "scrim" | "sidecar" | "other"
export type SwipeAction = "open-drawer" | "close-drawer" | "close-sidecar"

export function swipeAction(
  open: { drawer: boolean; sidecar: boolean },
  region: SwipeRegion,
  dx: number,
  dy: number,
): SwipeAction | null {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 2 * Math.abs(dy)) return null
  if (open.drawer) return dx < 0 && (region === "drawer" || region === "scrim") ? "close-drawer" : null
  if (open.sidecar && region === "sidecar") return dx > 0 ? "close-sidecar" : null
  return region === "edge" && dx > 0 ? "open-drawer" : null
}

export function swipeRegion(target: EventTarget | null, x: number): SwipeRegion {
  const element = target instanceof Element ? target : null
  if (element?.closest('[data-component="drawer-scrim"]')) return "scrim"
  if (element?.closest(".sidebar-shell > .panel")) return "drawer"
  if (element?.closest('[data-component="sidecar"]')) return "sidecar"
  return x <= EDGE_PX ? "edge" : "other"
}
