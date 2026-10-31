import { createEffect, createMemo, createRoot, createSignal } from "solid-js"
import { connectedProviders, connectedReady } from "./connected"
import { providerOf } from "./model-list"

const KEY = "kiko.model-prefs"
const FAVORITES_KEY = "kiko.model-favorites"

function parseHidden(text: string | null): readonly string[] {
  try {
    const value = JSON.parse(text ?? "{}") as { hidden?: unknown }
    return Array.isArray(value.hidden)
      ? [...new Set(value.hidden.filter((x): x is string => typeof x === "string"))]
      : []
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

const [hidden, setHiddenList] = createRoot(() => createSignal<readonly string[]>(read()))

export const hiddenModels = hidden

function writeHidden(next: readonly string[]) {
  setHiddenList(next)
  try {
    localStorage.setItem(KEY, JSON.stringify({ hidden: next }))
  } catch {}
}

export function setHidden(refs: readonly string[], hide: boolean) {
  const set = new Set(hidden())
  for (const ref of refs) {
    if (hide) set.add(ref)
    else set.delete(ref)
  }
  writeHidden([...set])
}

function readFavorites(): readonly string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

const [favorites, setFavorites] = createRoot(() => createSignal<readonly string[]>(readFavorites()))

function writeFavorites(next: readonly string[]) {
  setFavorites(next)
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
  } catch {}
}

const connectedIds = () => new Set(connectedProviders().map((p) => p.provider))

export const favoriteModels = createRoot(() =>
  createMemo(() => {
    const ids = connectedIds()
    return favorites().filter((ref) => ids.has(providerOf(ref)))
  }),
)

export function toggleFavorite(ref: string) {
  writeFavorites(favorites().includes(ref) ? favorites().filter((r) => r !== ref) : [...favorites(), ref])
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) setHiddenList(read())
    else if (e.key === FAVORITES_KEY) setFavorites(readFavorites())
  })
  createRoot(() => {
    createEffect(() => {
      if (!connectedReady() || !connectedProviders().length) return
      const ids = connectedIds()
      const kept = favorites().filter((ref) => ids.has(providerOf(ref)))
      if (kept.length !== favorites().length) writeFavorites(kept)
    })
  })
}
