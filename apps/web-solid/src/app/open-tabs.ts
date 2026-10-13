import { createSignal } from "solid-js"

/*
 * The open chat tabs, as data. The pure functions take the list and return the
 * next one, so a table of cases covers them. The signal around them persists
 * to localStorage on every change. ASSUMPTION: localStorage stands in for the
 * IndexedDB warm store (P2-05) and moves there when that lands.
 *
 * The active tab is not stored. The URL is the only source of it, so a reload
 * returns the same active tab because it returns the same URL.
 */
export const OPEN_TABS_KEY = "kiko.open-tabs"

/** Add an id at the end. An id that is already open keeps its place. */
export function openTab(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id]
}

/** Remove an id. Every other tab keeps its order. */
export function closeTab(ids: readonly string[], id: string): string[] {
  return ids.filter((open) => open !== id)
}

/**
 * Where to go after closing `id`. Closing a tab that is not active changes
 * nothing. Closing the active one lands on the tab that took its place, else
 * the one before it, else nothing (null means the chat home).
 */
export function nextAfterClose(ids: readonly string[], id: string, active: string | null): string | null {
  if (active !== id) return active
  const index = ids.indexOf(id)
  const rest = closeTab(ids, id)
  return rest[index] ?? rest[index - 1] ?? null
}

/** The tab one step from `id`, wrapping at both ends. */
export function stepTab(ids: readonly string[], id: string, step: 1 | -1): string | null {
  if (ids.length === 0) return null
  const index = ids.indexOf(id)
  if (index === -1) return ids[0] ?? null
  return ids[(index + step + ids.length) % ids.length] ?? null
}

/** Parse what storage holds. Anything that is not a list of strings is empty. */
export function parseTabs(raw: string | null): string[] {
  if (raw === null) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .reduce<string[]>((acc, id) => openTab(acc, id), [])
  } catch {
    return []
  }
}

function read(): string[] {
  try {
    return parseTabs(localStorage.getItem(OPEN_TABS_KEY))
  } catch {
    return []
  }
}

function write(ids: readonly string[]): void {
  try {
    localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids))
  } catch {
    // Private windows and blocked storage fall back to memory only.
  }
}

const [tabs, setTabs] = createSignal<string[]>(read())

function update(next: string[]): void {
  setTabs(next)
  write(next)
}

/** Tabs closed this session, newest last, for "reopen closed". Capped, and never stored. */
const MAX_CLOSED = 20
let closed: string[] = []

export const openTabs = {
  ids: tabs,
  open: (id: string) => update(openTab(tabs(), id)),
  close: (id: string) => {
    if (tabs().includes(id)) closed = [...closed.filter((c) => c !== id), id].slice(-MAX_CLOSED)
    update(closeTab(tabs(), id))
  },
  /** The newest closed tab that `exists` still knows, taken off the list. Null when there is none. */
  takeClosed: (exists: (id: string) => boolean): string | null => {
    while (closed.length) {
      const id = closed.pop()!
      if (exists(id) && !tabs().includes(id)) return id
    }
    return null
  },
}
