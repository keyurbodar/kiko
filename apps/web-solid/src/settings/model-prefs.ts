import { createSignal } from "solid-js"

// Which models the picker shows first and which it leaves out, after t3code's model settings (MIT,
// apps/web/src/components/settings/ProviderModelsSection.tsx). Refs are `provider/model`. Like the
// chosen model (chat-model.ts) they live in this browser's localStorage and hold no secret.
const KEY = "kiko.model-prefs"

export type ModelPrefs = { favorites: readonly string[]; hidden: readonly string[] }

/** Stored prefs, or none for anything unreadable. */
export function parsePrefs(text: string | null): ModelPrefs {
  try {
    const value = JSON.parse(text ?? "{}") as Partial<ModelPrefs>
    const refs = (list: unknown) => (Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === "string"))] : [])
    return { favorites: refs(value.favorites), hidden: refs(value.hidden) }
  } catch {
    return { favorites: [], hidden: [] }
  }
}

function read(): ModelPrefs {
  try {
    return parsePrefs(localStorage.getItem(KEY))
  } catch {
    return { favorites: [], hidden: [] }
  }
}

const [prefs, setPrefs] = createSignal<ModelPrefs>(read())
export const modelPrefs = prefs

function save(next: ModelPrefs) {
  setPrefs(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}

export function toggleFavorite(ref: string) {
  const { favorites, hidden } = prefs()
  save({ favorites: favorites.includes(ref) ? favorites.filter((r) => r !== ref) : [...favorites, ref], hidden })
}

/** Shows or hides models in the picker. */
export function setHidden(refs: readonly string[], hide: boolean) {
  const { favorites, hidden } = prefs()
  const set = new Set(hidden)
  for (const ref of refs) hide ? set.add(ref) : set.delete(ref)
  save({ favorites, hidden: [...set] })
}

/**
 * A list in t3code's display order: favorites first in the order they were starred, then the
 * shown models, then the hidden ones, each keeping the order it came in.
 */
export function groupForDisplay<T>(items: readonly T[], refOf: (item: T) => string, p: ModelPrefs): { favorites: T[]; shown: T[]; hidden: T[] } {
  const hidden = new Set(p.hidden)
  const rank = new Map(p.favorites.map((ref, i) => [ref, i]))
  const favorites = items.filter((item) => rank.has(refOf(item))).sort((a, b) => rank.get(refOf(a))! - rank.get(refOf(b))!)
  return {
    favorites,
    shown: items.filter((item) => !rank.has(refOf(item)) && !hidden.has(refOf(item))),
    hidden: items.filter((item) => !rank.has(refOf(item)) && hidden.has(refOf(item))),
  }
}
