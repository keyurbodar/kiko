import { KIKO } from "@kiko/protocol"

/*
 * The bot picker's rule. Picking one agent opens that agent's chat one to one. Picking two or
 * more opens a group, and Kiko leads every group, so a group it is not already in gains it.
 */

/** The room the pick opens: the agent alone, or a group Kiko leads. Empty when nothing is picked. */
export function roomFor(picked: readonly string[]): string[] {
  const unique = [...new Set(picked)]
  if (unique.length < 2) return unique
  return unique.includes(KIKO) ? [KIKO, ...unique.filter((id) => id !== KIKO)] : [KIKO, ...unique]
}

/** Adds or removes one agent. */
export function togglePick(picked: readonly string[], id: string): string[] {
  return picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]
}

/** A group's title: its members' names in order. */
export const groupTitle = (names: readonly string[]): string => names.join(", ")
