import { KIKO } from "@kiko/protocol"

/*
 * The bot picker's selection rules. Picking one agent opens its chat; picking two or more makes a
 * group. Kiko leads every group, so it joins once two other agents are picked and stays picked.
 */

/** Kiko is locked on once two agents other than Kiko are picked. */
export const kikoLocked = (picked: readonly string[]): boolean => picked.filter((id) => id !== KIKO).length >= 2

/** The agents a group would hold, Kiko first. One or none is not a group. */
export function groupMembers(picked: readonly string[]): string[] {
  const unique = [...new Set(picked)]
  return kikoLocked(unique) ? [KIKO, ...unique.filter((id) => id !== KIKO)] : unique
}

/** Adds or removes one agent. Kiko cannot be removed while it is locked. */
export function togglePick(picked: readonly string[], id: string): string[] {
  if (id === KIKO && kikoLocked(picked)) return [...picked]
  return picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]
}

/** A group's title: its members' names in order. */
export const groupTitle = (names: readonly string[]): string => names.join(", ")
