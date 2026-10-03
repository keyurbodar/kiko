// The saved look for the signed-in user. It loads after the first paint, opens its own
// user socket (the same pattern as the memory client), applies what the server holds, and
// applies a change from another device at once. Saving applies locally first, then sends.
// The inline script in `index.html` already painted from the cache, so nothing here is on
// the first-paint path.

import type { UserToClient } from "@kiko/protocol"
import { createMemo, createRoot, createSignal } from "solid-js"
import { urls } from "../lib/store"
import { type Connect, createSyncSocket, type SyncSocket } from "../sync/socket"
import { applyCommitted, readCache, writeCache } from "./apply"
import { setBirdPicks } from "../mascot/choices"
import { formatLook, parseLook, type Look } from "./look"

const cached = readCache()
// The inline script already painted these variables. This tells `apply.ts` what "saved" is,
// so a cancelled preview goes back to it.
const first = parseLook(cached?.text ?? null)
applyCommitted(first)
setBirdPicks(first.birds)
const [saved, setSaved] = createSignal<string | null>(cached?.text ?? null)

/** The saved look. The default until the person picks something. Reactive. */
export const look = createRoot(() => createMemo(() => parseLook(saved())))
/** True once this person has saved any look, here or on another device. */
export const hasLook = () => saved() !== null
const [synced, setSynced] = createSignal(cached !== null)
/** True once the server has said what look this person has, or the cache already knew. */
export const lookSynced = synced

let socket: SyncSocket | null = null
let owner: string | null = null
/** What still has to reach the server. `undefined` means nothing. */
let outbox: string | null | undefined

function adopt(text: string | null): void {
  if (text === saved()) return
  const next = parseLook(text)
  applyCommitted(next)
  setBirdPicks(next.birds)
  writeCache(text, next)
  setSaved(text)
}

function flush(): void {
  if (outbox === undefined || !socket) return
  if (socket.send({ t: "theme", theme: outbox })) outbox = undefined
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

function onFrame(frame: UserToClient): void {
  if (frame.t === "reset") {
    setSynced(true)
    // Pending local changes win until they have been sent.
    if (frame.snapshot.theme !== undefined && outbox === undefined) adopt(frame.snapshot.theme)
  } else if (frame.t === "events") {
    for (const e of frame.events) if (e.t === "theme" && outbox === undefined) adopt(e.theme)
  }
}

const mocked = () => import.meta.env.DEV && import.meta.env.VITE_KIKO_SYNC === "mock"

/** Starts once per user. A different user closes the old socket first. */
export function startTheme(userId: string, connect?: Connect): void {
  if (owner === userId) return
  stopTheme()
  owner = userId
  // The dev mock has no theme record, so the cache is the only copy there.
  if (mocked() && !connect) return void setSynced(true)
  socket = createSyncSocket<UserToClient>({
    url: urls.user(),
    connect,
    // A `lastSeq` past the end gets one small snapshot with the theme in it, not a replay.
    hello: () => ({ t: "hello", lastSeq: Number.MAX_SAFE_INTEGER }),
    onOpen: flush,
    onFrame,
  })
}

export function stopTheme(): void {
  socket?.close()
  socket = null
  owner = null
}

/** Signing out: the next person on this browser starts on the default look, not on this user's. */
export function forgetTheme(): void {
  stopTheme()
  outbox = undefined
  adopt(null)
}
