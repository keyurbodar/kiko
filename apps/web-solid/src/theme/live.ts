// The saved look for the signed-in user. The look loads after the first paint, listens on the
// shared user socket (`sync/user-channel.ts`), applies what the server holds, and applies a change
// from another device at once. Saving applies locally first, then sends. The inline script in
// `index.html` already painted from the cache, so nothing here is on the first-paint path.

import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { useApp } from "../lib/store"
import { type UserChannel, userChannel } from "../sync/user-channel"
import { applyCommitted, importedThemes, previewLook as preview, readCache, saveImported, writeCache } from "@kiko/theme/apply"
import type { Imported, ImportedTheme } from "@kiko/theme/imported"
import { setAvatarPicks } from "../avatar/picks"
import { formatLook, parseLook, type Look } from "@kiko/theme/look"

const cached = readCache()
const first = parseLook(cached?.text ?? null)
// The inline script already painted these variables. This tells `apply.ts` what "saved" is,
// so a cancelled preview goes back to it.
applyCommitted(first)
setAvatarPicks(first.avatars)
const [saved, setSaved] = createSignal<string | null>(cached?.text ?? null)

/** The saved look. The default until the person picks something. Reactive. */
export const look = createRoot(() => createMemo(() => parseLook(saved())))
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

function adopt(text: string | null, withImported = true): void {
  const next = parseLook(text)
  applyCommitted(next, withImported)
  setAvatarPicks(next.avatars)
  writeCache(text, next)
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

/** Paints a look without saving it, for a drag in progress. Returns the undo. */
export const previewLook = (next: Look): (() => void) => preview({ ...next })

const mocked = () => import.meta.env.DEV && import.meta.env.VITE_KIKO_SYNC === "mock"

/**
 * Starts once per user. The user store keeps what the server said about the look (its catch-up
 * snapshot and every theme event), so starting late misses nothing.
 */
export function startTheme(userId: string, shared: UserChannel = userChannel): void {
  if (owner === userId) return
  stopTheme()
  owner = userId
  applyCommitted(look())
  // The dev mock has no theme record, so the cache is the only copy there.
  if (mocked() && shared === userChannel) return void setSynced(true)
  channel = shared
  stops.push(
    createRoot((dispose) => {
      createEffect(() => {
        if (useApp.user()?.state.synced) setSynced(true)
      })
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

/** Signing out: the signed-out screens and the next person on this browser get the default look, not this user's. */
export function forgetTheme(): void {
  stopTheme()
  outbox = undefined
  adopt(null, false)
}

/** The imported themes and which one each appearance uses. `""` is Kiko's own theme. */
export const DEFAULT = ""

const [state, setState] = createSignal<Imported>(importedThemes())

export const themes = state

export function commit(next: Imported) {
  saveImported(next)
  setState(next)
}

export function choose(appearance: "light" | "dark", id: string) {
  const active = { ...state().active }
  if (id === DEFAULT) delete active[appearance]
  else active[appearance] = id
  commit({ ...state(), active })
}

export function remove(theme: ImportedTheme) {
  const active = { ...state().active }
  for (const appearance of ["light", "dark"] as const) if (active[appearance] === theme.id) delete active[appearance]
  commit({ themes: state().themes.filter((other) => other.id !== theme.id), active })
}

