import { createSignal } from "solid-js"

// Which models the chat's model picker leaves out, after opencode's models settings (MIT,
// packages/app/src/components/settings-v2/models.tsx). Refs are `provider/model`. They live in this
// browser's localStorage and hold no secret.
const KEY = "kiko.model-prefs"

/** Stored hidden refs, or none for anything unreadable. */
export function parseHidden(text: string | null): readonly string[] {
  try {
    const value = JSON.parse(text ?? "{}") as { hidden?: unknown }
    return Array.isArray(value.hidden) ? [...new Set(value.hidden.filter((x): x is string => typeof x === "string"))] : []
  } catch {
    return []
  }
}

function read(): readonly string[] {
  try {
    return parseHidden(localStorage.getItem(KEY))
  } catch {
    return []
  }
}

const [hidden, setHiddenList] = createSignal<readonly string[]>(read())

/** The models the picker leaves out. */
export const hiddenModels = hidden

/** Shows or hides models in the picker. */
export function setHidden(refs: readonly string[], hide: boolean) {
  const set = new Set(hidden())
  for (const ref of refs) hide ? set.add(ref) : set.delete(ref)
  const next = [...set]
  setHiddenList(next)
  try {
    localStorage.setItem(KEY, JSON.stringify({ hidden: next }))
  } catch {}
}

const FAVORITES_KEY = "kiko.model-favorites"

function readFavorites(): readonly string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

const [favorites, setFavorites] = createSignal<readonly string[]>(readFavorites())

/** The models starred in the picker, shown first. */
export const favoriteModels = favorites

export function toggleFavorite(ref: string) {
  const next = favorites().includes(ref) ? favorites().filter((r) => r !== ref) : [...favorites(), ref]
  setFavorites(next)
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
  } catch {}
}
