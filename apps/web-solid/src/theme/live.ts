// The saved theme for the signed-in user. It loads after the first paint, opens its own
// user socket (the same pattern as the memory client), applies what the server holds, and
// applies a change from another device at once. Saving applies locally first, then sends.
// The inline script in `index.html` already painted from the cache, so nothing here is on
// the first-paint path.

import type { UserToClient } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { urls } from "../lib/store"
import { type Connect, createSyncSocket, type SyncSocket } from "../sync/socket"
import { applyCommitted, compileTheme, readCache, writeCache } from "./apply"

const cached = readCache()
// The inline script already painted these variables. This tells `apply.ts` what "saved" is,
// so a cancelled preview goes back to it.
if (cached) applyCommitted(cached.theme)
const [saved, setSaved] = createSignal<string | null>(cached?.text ?? null)

/** The saved theme text, or null when the user is on kat. */
export const savedTheme = saved

let socket: SyncSocket | null = null
let owner: string | null = null
/** What still has to reach the server. `undefined` means nothing. */
let outbox: string | null | undefined

function adopt(text: string | null): void {
  if (text === saved()) return
  if (text === null) {
    applyCommitted(null)
    writeCache(null, null)
    setSaved(null)
    return
  }
  const c = compileTheme(text)
  if (!c.ok) {
    // A theme that fails validation is never applied, wherever it came from.
    console.warn("theme from the server was refused:", c.errors[0])
    return
  }
  applyCommitted(c.resolved)
  writeCache(text, c.resolved)
  setSaved(text)
}

function flush(): void {
  if (outbox === undefined || !socket) return
  if (socket.send({ t: "theme", theme: outbox })) outbox = undefined
}

/** Saves a validated theme, or null to go back to kat. Applies now and sends when it can. */
export function saveTheme(text: string | null): void {
  adopt(text)
  outbox = text
  flush()
}

function onFrame(frame: UserToClient): void {
  if (frame.t === "reset") {
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
  if (mocked() && !connect) return
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

/** Signing out: the next person on this browser starts on kat, not on this user's theme. */
export function forgetTheme(): void {
  stopTheme()
  outbox = undefined
  adopt(null)
}
