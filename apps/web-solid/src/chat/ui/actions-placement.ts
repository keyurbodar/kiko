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
): ActionsPlacement {
  const room = side === "user" ? bubble.left - scroller.left : scroller.right - bubble.right
  return room >= ACTIONS_WIDTH ? "outside" : "inside"
}
