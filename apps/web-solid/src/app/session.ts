import { createSignal } from "solid-js"
import { apiFetch, setToken, setUnauthorizedHandler } from "../lib/api"
import { base, write } from "../lib/api-base"
import { clearFileToken } from "../lib/file-token"
import { hosted, setProfile } from "./hosted"

/*
 * The session, as the client sees it. A cached flag in
 * localStorage answers on the first frame, so a signed-in person never waits on
 * the network. `/api/me` confirms it in the background. A 401 from any call, or
 * signing out, removes that user's warm tier and shows sign-in.
 */

export interface SessionUser {
  id: string
  name: string
}

/** unknown: no cached flag yet, so the first `/api/me` decides. */
export type SessionState = { status: "unknown" } | { status: "signed-in"; user: SessionUser } | { status: "signed-out" }

const FLAG_KEY = "kiko:session"

/*
 * ASSUMPTION: the warm tier (P2-05) names each user's database
 * `kiko-warm:<userId>`, optionally with more after a second colon. Clearing deletes
 * every database with that name or prefix.
 */
export const warmDbPrefix = (userId: string) => `kiko:warm:${userId}`

function readFlag(): SessionUser | null {
  try {
    const raw = localStorage.getItem(FLAG_KEY)
    const user = raw ? (JSON.parse(raw) as Partial<SessionUser>) : null
    return user && typeof user.id === "string" ? (user as SessionUser) : null
  } catch {
    return null
  }
}

function writeFlag(user: SessionUser | null): void {
  try {
    if (user) localStorage.setItem(FLAG_KEY, JSON.stringify(user))
    else localStorage.removeItem(FLAG_KEY)
  } catch {
    // storage can be blocked. the session still works for this page load.
  }
}

/** Deletes every IndexedDB database that belongs to a user. Resolves when all are gone. */
export async function clearWarmTier(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return
  const prefix = warmDbPrefix(userId)
  const names = (await indexedDB.databases())
    .map((db) => db.name ?? "")
    .filter((name) => name === prefix || name.startsWith(`${prefix}:`))
  await Promise.all(
    names.map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name)
          request.onsuccess = request.onerror = request.onblocked = () => resolve()
        }),
    ),
  )
}

/*
 * A signed-in browser always has the cached flag, so no flag means sign-in shows on the first frame.
 */
const cached = readFlag()
const [state, setState] = createSignal<SessionState>(
  cached ? { status: "signed-in", user: cached } : { status: "signed-out" },
)

export const session = state

function signedIn(user: SessionUser): void {
  writeFlag(user)
  setState({ status: "signed-in", user })
}

/** Drops the flag and the user's warm tier, then shows sign-in. */
async function signedOut(): Promise<void> {
  const current = state()
  const userId = current.status === "signed-in" ? current.user.id : readFlag()?.id
  writeFlag(null)
  setToken(null)
  clearFileToken()
  setState({ status: "signed-out" })
  if (userId) await clearWarmTier(userId)
}

/** Confirms the cached flag with the server. Call once on boot. */
export async function bootstrapSession(): Promise<void> {
  try {
    let early = globalThis.__kikoBoot?.me
    if (globalThis.__kikoBoot) globalThis.__kikoBoot.me = undefined
    // Development only: /api/auth/dev/session redirects here with the token in the hash.
    const handed = import.meta.env.DEV ? /^#token=(\S+)$/.exec(location.hash)?.[1] : undefined
    if (handed) {
      setToken(handed)
      history.replaceState(null, "", location.pathname + location.search)
      early = undefined
    }
    const res = await (early ?? apiFetch("/api/me"))
    if (res.status === 401) return await signedOut()
    if (!res.ok) throw new Error(String(res.status))
    const { user } = (await res.json()) as { user: SessionUser }
    // A different user than the cached one: the old user's data must not stay.
    const before = state()
    if (before.status === "signed-in" && before.user.id !== user.id) await clearWarmTier(before.user.id)
    signedIn(user)
  } catch {
    // offline or a server error. keep the cached flag, and with none show sign-in.
    if (state().status === "unknown") setState({ status: "signed-out" })
  }
}

// A 401 from any call drops the token (api.ts), then shows sign-in.
setUnauthorizedHandler(() => {
  if (state().status === "signed-in") void signedOut()
})

/*
 * Signing out, from any button or command. It drops this person's token, snapshot, warm tier and
 * profile. A hosted build also ends the Clerk session. `kiko:backend` stays, so the next sign-in
 * goes straight back to the same backend.
 */
export async function signOut(): Promise<void> {
  try {
    localStorage.removeItem("kiko:snap")
  } catch {}
  setProfile(null)
  // Clerk first: the sign-in screen resumes a Clerk session it finds, so it must be gone before that screen shows.
  if (hosted) await import("./clerk").then((m) => m.clerkSignOut()).catch(() => {})
  await signedOut()
}

async function adopt(res: Response | null, failure: string): Promise<void> {
  if (!res?.ok) throw new Error(failure)
  const { user, token } = (await res.json()) as { user: SessionUser; token: string }
  setToken(token)
  signedIn(user)
}

/** Signs in with the access code. A wrong code throws the server's message. */
export async function signInWithAccessCode(code: string): Promise<void> {
  const res = await apiFetch("/api/auth/access-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  }).catch(() => null)
  if (res && !res.ok) {
    const { message } = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(message ?? "Could not sign in. Try again")
  }
  await adopt(res, "Could not sign in. Try again")
}

/** Development Workers only. Mints a session for a test user. */
export async function signInAsDev(name = "dev"): Promise<void> {
  const res = await apiFetch("/api/auth/dev/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })
  await adopt(res, "dev sign-in failed")
}

/**
 * Hosted sign-in, after Clerk has a session. Trades the Clerk token for the backend's own. Returns
 * "connect" when this person has no backend yet, and "none" when Clerk holds no session.
 */
export async function signInWithClerk(): Promise<"in" | "connect" | "none"> {
  const { clerkSignIn } = await import("./clerk")
  const found = await clerkSignIn()
  if (!found) return "none"
  setProfile(found.profile)
  if (!found.backendUrl) return "connect"
  write("kiko:backend", found.backendUrl)
  try {
    await exchangeClerkToken(found.token)
  } catch (e) {
    // The address Clerk remembers answers, but not as Kiko: the Worker was deleted or replaced. Install again.
    if (!(e instanceof Unreachable) && (await backendGone())) return "connect"
    throw e
  }
  return "in"
}

/** True when the stored address answers but is not a Kiko backend (deleted on Cloudflare, or another Worker). */
async function backendGone(): Promise<boolean> {
  const res = await fetch(`${base()}/api/version`, { cache: "no-store" }).catch(() => null)
  if (!res) return false
  const body = (await res.json().catch(() => null)) as { version?: unknown } | null
  return !res.ok || typeof body?.version !== "string"
}

/** The backend did not answer at all: no response, so DNS, the network, or a blocker. */
class Unreachable extends Error {}

const hostOf = () => {
  try {
    return new URL(base()).host
  } catch {
    return "your backend"
  }
}

export const unreachableText = () =>
  `This device cannot reach ${hostOf()} yet. A new Cloudflare address can take a few minutes to reach every network. Try again in a minute. If you use a VPN, Private DNS, or an ad blocker, allow workers.dev.`

async function exchangeClerkToken(clerkToken: string): Promise<void> {
  const res = await apiFetch("/api/auth/clerk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: clerkToken }),
  }).catch(() => null)
  if (!res) throw new Unreachable(unreachableText())
  if (!res.ok) {
    const { message } = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(message ? `${message}.` : `Your backend answered ${res.status}. Try again.`)
  }
  await adopt(res, "Could not sign in. Try again")
}

/** How long a fresh install is given to become reachable from this device before the person is asked. */
const REACH_MS = 90_000
const REACH_STEP_MS = 3_000

/**
 * After an install stored `kiko:backend`: trades a fresh Clerk token for the backend's own. A new workers.dev
 * address can take a minute to reach this device's network, so no answer at all is tried again for a while.
 * Each try gets a new Clerk token, because one lives for a minute.
 */
export async function signInToInstalledBackend(): Promise<void> {
  const { clerkSignIn } = await import("./clerk")
  const until = Date.now() + REACH_MS
  for (;;) {
    const found = await clerkSignIn()
    if (!found) throw new Error("Your Kiko sign-in ended. Sign in again to finish connecting.")
    try {
      return await exchangeClerkToken(found.token)
    } catch (e) {
      if (!(e instanceof Unreachable) || Date.now() + REACH_STEP_MS > until) throw e
      await new Promise((r) => setTimeout(r, REACH_STEP_MS))
    }
  }
}
