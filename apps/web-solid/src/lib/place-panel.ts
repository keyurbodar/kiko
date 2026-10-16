const EDGE = 8
const GAP = 6

type Box = { top: number; bottom: number; left: number; right: number }

/**
 * Where a hand-placed panel goes so it stays inside the window. It opens on the preferred side of the
 * anchor when its height fits there, else on the other side, else on the roomier side with its height
 * capped to the space (the panel scrolls inside). `width` is the widest the panel gets; an end-aligned panel is pinned by its right edge. The panel is pinned by the edge next to the anchor,
 * so a panel shorter than its cap does not leave a gap.
 */
export function placePanel(
  anchor: Box,
  width: number,
  height: number,
  viewport: { width: number; height: number },
  prefer: "above" | "below",
  align: "start" | "end" = "start",
): { left?: string; right?: string; top?: string; bottom?: string; "max-height": string } {
  const above = anchor.top - GAP - EDGE
  const below = viewport.height - anchor.bottom - GAP - EDGE
  const room = { above, below }
  const other = prefer === "above" ? "below" : "above"
  const side = room[prefer] >= height ? prefer : room[other] >= height ? other : room.above >= room.below ? "above" : "below"
  const cap = Math.max(0, Math.floor(room[side]))
  const clamp = (px: number) => Math.min(Math.max(EDGE, px), Math.max(EDGE, viewport.width - EDGE - width))
  return {
    ...(align === "end" ? { right: `${viewport.width - clamp(anchor.right - width) - width}px` } : { left: `${clamp(anchor.left)}px` }),
    ...(side === "above" ? { bottom: `${viewport.height - anchor.top + GAP}px` } : { top: `${anchor.bottom + GAP}px` }),
    "max-height": `${Math.min(cap, height)}px`,
  }
}
