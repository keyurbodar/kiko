import { KIKO } from "@kiko/protocol"
import type { AvatarPins } from "@kiko/theme/look"
import { createRoot, createSignal } from "solid-js"

const [picks, setPicks] = createRoot(() => createSignal<Readonly<Record<string, AvatarPins>>>({}))

export const setAvatarPicks = setPicks

export function pinsFor(slug: string, pins: AvatarPins = picks()[slug] ?? {}): AvatarPins {
  return slug === KIKO ? { ...pins, flavour: "fubuki" } : pins
}
