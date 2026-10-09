import { KIKO } from "@kiko/protocol"
import { createRoot, createSignal } from "solid-js"
import { formatBird, parseBird, seedBird, type BirdSpec } from "./birds"

/*
 * The birds people picked, by agent slug. The look record owns the data and syncs it; this
 * module only mirrors it, so an avatar can read a pick without loading the theme socket.
 */

const [picks, setPicks] = createRoot(() => createSignal<Readonly<Record<string, string>>>({}))

export const setBirdPicks = setPicks

/** The bird a slug wears: the person's pick, or the one its slug seeds. */
export function birdFor(slug: string): BirdSpec {
  const picked = picks()[slug]
  const spec = picked ? parseBird(picked) : null
  // Yuki may change what it wears, never what it is.
  if (slug === KIKO) return { ...(spec ?? seedBird(slug, KIKO)), flavor: "yuki" }
  return spec ?? seedBird(slug, KIKO)
}

export const birdIdFor = (slug: string) => formatBird(birdFor(slug))
