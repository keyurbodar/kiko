const EDGE = 8
const GAP = 6

type Box = { top: number; bottom: number; left: number; right: number }

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
  const side =
    room[prefer] >= height ? prefer : room[other] >= height ? other : room.above >= room.below ? "above" : "below"
  const cap = Math.max(0, Math.floor(room[side]))
  const wide = Math.min(width, Math.max(0, viewport.width - 2 * EDGE))
  const clamp = (px: number) => Math.min(Math.max(EDGE, px), Math.max(EDGE, viewport.width - EDGE - wide))
  return {
    ...(align === "end"
      ? { right: `${viewport.width - clamp(anchor.right - wide) - wide}px` }
      : { left: `${clamp(anchor.left)}px` }),
    ...(side === "above" ? { bottom: `${viewport.height - anchor.top + GAP}px` } : { top: `${anchor.bottom + GAP}px` }),
    "max-height": `${Math.min(cap, height)}px`,
  }
}
