import { KIKO } from "@kiko/protocol"
import type { AvatarPins } from "@kiko/theme/look"
import { createRoot, createSignal } from "solid-js"

/*
 * The avatar choices people made, by agent slug. The look record owns the data and syncs it; this
 * module only mirrors it, so an avatar can read a choice without loading the theme socket.
 */

const [picks, setPicks] = createRoot(() => createSignal<Readonly<Record<string, AvatarPins>>>({}))

export const setAvatarPicks = setPicks

/** The pins an avatar draws with. Kiko may change what it wears, never what it is. */
export function pinsFor(slug: string, pins: AvatarPins = picks()[slug] ?? {}): AvatarPins {
  return slug === KIKO ? { ...pins, flavour: "fubuki" } : pins
}
