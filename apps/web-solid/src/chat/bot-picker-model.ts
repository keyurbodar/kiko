import { KIKO } from "@kiko/protocol"

export function roomFor(picked: readonly string[]): string[] {
  const unique = [...new Set(picked)]
  if (unique.length < 2) return unique
  return unique.includes(KIKO) ? [KIKO, ...unique.filter((id) => id !== KIKO)] : [KIKO, ...unique]
}

export function togglePick(picked: readonly string[], id: string): string[] {
  return picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]
}

export const groupTitle = (names: readonly string[]): string => names.join(", ")
