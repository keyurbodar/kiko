const ACTIONS_WIDTH = 3 * 32 + 2 * 2 + 6

export type ActionsPlacement = "outside" | "inside"

export function actionsPlacement(
  side: "user" | "bot",
  bubble: { left: number; right: number },
  scroller: { left: number; right: number },
  reserved = 0,
): ActionsPlacement {
  const room = side === "user" ? bubble.left - scroller.left : scroller.right - bubble.right
  return room >= ACTIONS_WIDTH + reserved ? "outside" : "inside"
}
