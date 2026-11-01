import type { Screen } from "./capture"

export function place(
  screen: Screen | null,
  size: { width: number; height: number } | null,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: Math.round((size?.width ?? 1) * x) + (screen?.originX ?? 0),
    y: Math.round((size?.height ?? 1) * y) + (screen?.originY ?? 0),
  }
}
