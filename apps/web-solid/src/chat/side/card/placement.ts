/*
 * Where the chat card sits, decided by the chat panel's width. Inline: the card is pinned at the top
 * right and the chat column makes room for it. Popover: the card is hidden until the toggle opens it,
 * floats over the thread, and the chat keeps its width.
 */

export const CARD_WIDTH = 300
/** The card's gap from the panel's top and right edges. */
export const CARD_INSET = 12
/** The gap between the card and the chat column when they sit side by side. */
export const CARD_GAP = 20
/** The width of the readable chat lane. */
export const CHAT_LANE = 520
/** The main panel's padding on each side. */
export const PANEL_PADDING = 24
/** The gap between the chat lane and the card. */
export const LANE_GAP = 32

/** How far the chat column moves left when the card is inline. */
export const CARD_SHIFT = CARD_WIDTH + CARD_INSET + CARD_GAP

/** The narrowest panel that holds the chat lane, its gap and the card. */
export const INLINE_MIN_WIDTH = PANEL_PADDING + CHAT_LANE + LANE_GAP + CARD_WIDTH + CARD_INSET

export type Placement = "inline" | "popover"

export function cardPlacement(panelWidth: number): Placement {
  return panelWidth >= INLINE_MIN_WIDTH ? "inline" : "popover"
}
