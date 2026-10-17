/** Width of the three action buttons, their gaps and the margin between them and the bubble. */
export const ACTIONS_WIDTH = 3 * 32 + 2 * 2 + 6

export type ActionsPlacement = "outside" | "inside"

/**
 * Where a message's hover actions sit. They hang beside the bubble on the side away from its
 * edge of the transcript, and sit on the bubble's top edge when that side is too narrow for them.
 */
export function actionsPlacement(
  side: "user" | "bot",
  bubble: { left: number; right: number },
  scroller: { left: number; right: number },
  /** Width the run chevron takes beside the bubble, which the actions step past. */
  reserved = 0,
): ActionsPlacement {
  const room = side === "user" ? bubble.left - scroller.left : scroller.right - bubble.right
  return room >= ACTIONS_WIDTH + reserved ? "outside" : "inside"
}
