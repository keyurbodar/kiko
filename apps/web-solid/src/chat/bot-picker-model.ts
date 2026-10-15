import { KIKO } from "@kiko/protocol"

/*
 * The bot picker's group rule. Kiko leads every group, so it is never picked: a group is Kiko
 * and the agents picked, one or more.
 */

/** The agents a group would hold, Kiko first. Empty when nothing is picked. */
export function groupMembers(picked: readonly string[]): string[] {
  const others = [...new Set(picked)].filter((id) => id !== KIKO)
  return others.length ? [KIKO, ...others] : []
}

/** Adds or removes one agent. Kiko is in every group already, so it is not pickable. */
export function togglePick(picked: readonly string[], id: string): string[] {
  if (id === KIKO) return [...picked]
  return picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]
}

/** A group's title: its members' names in order. */
export const groupTitle = (names: readonly string[]): string => names.join(", ")
