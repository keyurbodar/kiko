// The saved look for the signed-in user, and this browser's library of imported themes. The look
// loads after the first paint, listens on the shared user socket (`sync/user-channel.ts`),
// applies what the server holds, and applies a change from another device at once. Saving
// applies locally first, then sends. The library lives in localStorage, as in t3code.
// The inline script in `index.html` already painted from the cache, so nothing here is on
// the first-paint path.

import { createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js"
import { registerCommands } from "../commands/registry"
import { themeChoiceCommands } from "../commands/theme-commands"
import { useApp } from "../lib/store"
import { type UserChannel, userChannel } from "../sync/user-channel"
import { BUILT_IN_THEMES } from "./builtins"
import { applyCommitted, readCache, writeCache } from "./apply"
import { setBirdPicks } from "../mascot/choices"
import { background } from "./glass"
import { formatLook, matchesWallpaper, parseLook, withHalf, withTheme, withWallpaper, type Look } from "./look"
import { readStoredThemes, type ThemeAppearance, type ThemeDefinition } from "./palette"

/** The library's key. Every theme here was imported in this browser. */
export const LIBRARY_KEY = "kiko:themes:v1"

function readLibrary(): ThemeDefinition[] {
  try {
    return readStoredThemes(JSON.parse(localStorage.getItem(LIBRARY_KEY) ?? "[]"))
  } catch {
    return []
  }
}

const cached = readCache()
const first = parseLook(cached?.text ?? null)
const [library, setLibrary] = createSignal<ThemeDefinition[]>(readLibrary())
// The inline script already painted these variables. This tells `apply.ts` what "saved" is,
// so a cancelled preview goes back to it.
applyCommitted(first, library())
setBirdPicks(first.birds)
const [saved, setSaved] = createSignal<string | null>(cached?.text ?? null)

/** The saved look. The default until the person picks something. Reactive. */
export const look = createRoot(() => createMemo(() => parseLook(saved())))
/** The themes imported in this browser. Reactive. */
export const customThemes = library
/** True once this person has saved any look, here or on another device. */
export const hasLook = () => saved() !== null
const [synced, setSynced] = createSignal(cached !== null)
/** True once the server has said what look this person has, or the cache already knew. */
export const lookSynced = synced

let channel: UserChannel | null = null
let stops: (() => void)[] = []
let owner: string | null = null
/** What still has to reach the server. `undefined` means nothing. */
let outbox: string | null | undefined

function saveLibrary(next: ThemeDefinition[]): boolean {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(next))
  } catch {
    return false
  }
  setLibrary(next)
  return true
}

function adopt(text: string | null): void {
  const next = parseLook(text)
  // A look from another device names themes this browser may not have yet. They join the library.
  const missing = next.themes.filter((t) => !library().some((l) => l.id === t.id))
  if (missing.length) saveLibrary([...library(), ...missing])
  applyCommitted(next, library())
  setBirdPicks(next.birds)
  writeCache(text, next, library())
  if (text !== saved()) setSaved(text)
}

function flush(): void {
  if (outbox === undefined || !channel) return
  if (channel.send({ t: "theme", theme: outbox })) outbox = undefined
}

/** Saves a look. Applies now and sends when it can. */
export function saveLook(next: Look): void {
  const text = formatLook(next)
  adopt(text)
  outbox = text
  flush()
}

/** Changes part of the saved look. */
export const updateLook = (patch: Partial<Look>) => saveLook({ ...look(), ...patch })

const themeById = (id: string | null) => (id === null ? null : (allThemes().find((t) => t.id === id) ?? null))

/** Every theme a person can pick: t3code's built-ins, then this browser's imports. */
export const allThemes = (): ThemeDefinition[] => [...BUILT_IN_THEMES, ...library()]

/** Both halves follow the chat background's own colors. Returns false when there is no picture to read. */
export function matchWallpaper(): boolean {
  const palette = background()?.palette
  if (!palette) return false
  saveLook(withWallpaper(look(), palette))
  return true
}

/** Uses a theme for every half it can draw. Null puts t3code's stock palette back. */
export const chooseTheme = (id: string | null) => saveLook(withTheme(look(), themeById(id)))
/** Gives one half of the appearance to a theme. */
export const setHalf = (half: ThemeAppearance, id: string | null) => saveLook(withHalf(look(), half, themeById(id)))

// The palette offers every theme. Imports and removals here or in another tab update it.
createRoot(() =>
  createEffect(() => {
    const remove = registerCommands(themeChoiceCommands([{ id: null, label: "default" }, ...allThemes()], chooseTheme))
    onCleanup(remove)
  }),
)

/**
 * Adds themes, replacing any with the same id. A theme with a collection replaces the whole
 * collection, so an updated extension drops variants it no longer ships.
 */
export function installThemes(themes: readonly ThemeDefinition[]): boolean {
  const ids = new Set(themes.map((t) => t.id))
  const collections = new Set(themes.flatMap((t) => (t.collection ? [t.collection.id] : [])))
  const kept = library().filter((t) => !ids.has(t.id) && !(t.collection && collections.has(t.collection.id)))
  if (!saveLibrary([...kept, ...themes])) return false
  // A half already on an updated theme repaints with the new colors.
  const current = look()
  const fresh = current.themes.map((t) => themes.find((n) => n.id === t.id) ?? t)
  saveLook({ ...current, themes: fresh })
  return true
}

/** Removes themes from this browser. A half that used one goes back to the stock palette. */
export function removeThemes(ids: readonly string[]): boolean {
  const drop = new Set(ids)
  if (!saveLibrary(library().filter((t) => !drop.has(t.id)))) return false
  const current = look()
  saveLook({
    ...current,
    light: current.light && drop.has(current.light) ? null : current.light,
    dark: current.dark && drop.has(current.dark) ? null : current.dark,
    themes: current.themes.filter((t) => !drop.has(t.id)),
  })
  return true
}

const mocked = () => import.meta.env.DEV && import.meta.env.VITE_KIKO_SYNC === "mock"

/**
 * Starts once per user. The user store keeps what the server said about the look (its catch-up
 * snapshot and every theme event), so starting late misses nothing.
 */
export function startTheme(userId: string, shared: UserChannel = userChannel): void {
  if (owner === userId) return
  stopTheme()
  owner = userId
  // Another tab importing or removing a theme changes the library here too.
  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LIBRARY_KEY && event.key !== null) return
      setLibrary(readLibrary())
      applyCommitted(look(), library())
    }
    window.addEventListener("storage", onStorage)
    stops.push(() => window.removeEventListener("storage", onStorage))
  }
  // The dev mock has no theme record, so the cache is the only copy there.
  if (mocked() && shared === userChannel) return void setSynced(true)
  channel = shared
  stops.push(
    createRoot((dispose) => {
      createEffect(() => {
        if (useApp.user()?.state.synced) setSynced(true)
      })
      // Matching the wallpaper is live: a new picture recolors the theme at once. Only this
      // device's picture drives it; another device keeps the palette the look carries.
      createEffect(
        on(
          () => background()?.palette,
          (palette) => {
            const current = look()
            if (palette && matchesWallpaper(current) && JSON.stringify(palette) !== JSON.stringify(current.wallpaper)) saveLook({ ...current, wallpaper: palette })
          },
        ),
      )
      createEffect(
        on(
          () => useApp.user()?.state.theme,
          // Pending local changes win until they have been sent.
          (theme) => {
            if (theme !== undefined && outbox === undefined && theme !== saved()) adopt(theme)
          },
        ),
      )
      return dispose
    }),
    shared.onOpen(flush),
  )
  flush()
}

export function stopTheme(): void {
  for (const stop of stops) stop()
  stops = []
  channel = null
  owner = null
}

/** Signing out: the next person on this browser starts on the default look, not on this user's. */
export function forgetTheme(): void {
  stopTheme()
  outbox = undefined
  adopt(null)
}
