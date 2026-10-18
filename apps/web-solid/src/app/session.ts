import { createSignal } from "solid-js"
import { apiFetch, getToken, setToken, setUnauthorizedHandler } from "../lib/api"
import { base, read, write } from "../lib/api-base"
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
let generation = 0
let clearing: Promise<void> = Promise.resolve()
const pendingCleanup = new Set<string>()
export const [authReset, setAuthReset] = createSignal(0)
export const [autoResume, setAutoResume] = createSignal(true)
export const authIdentity = () => read("kiko:identity") ?? base()
export const authGeneration = () => generation
export const cancelAuthAttempt = () => { generation++ }
export const allowClerkResume = () => setAutoResume(true)


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
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name)
          request.onsuccess = () => resolve()
          request.onerror = request.onblocked = () => reject(new Error("Close other Kiko tabs and try again"))
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

export const [backendConnectionNotice, setBackendConnectionNotice] = createSignal("")

function signedIn(user: SessionUser): void {
  writeFlag(user)
  setState({ status: "signed-in", user })
}

/**
 * Drops the flag and the user's warm tier, then shows sign-in.
 *
 * The backend address goes with it. A signed-out browser has nothing to ask a backend for, and the
 * next sign-in writes the address its own Clerk account holds before it makes any request. Keeping
 * the address is what made a switch between two accounts start from the first one's backend.
 */
async function signedOut(reset = true): Promise<void> {
  generation++
  if (reset) setAuthReset((n) => n + 1)
  setBackendConnectionNotice("")
  setProfile(null)
  write("kiko:snap", null)
  write("kiko:backend", null)
  const current = state()
  const userId = current.status === "signed-in" ? current.user.id : readFlag()?.id
  writeFlag(null)
  setToken(null)
  clearFileToken()
  setState({ status: "signed-out" })
  if (userId) pendingCleanup.add(userId)
  clearing = clearing.catch(() => {}).then(async () => {
    for (const id of pendingCleanup) {
      await clearWarmTier(id)
      pendingCleanup.delete(id)
    }
  })
  await clearing
}

/** Confirms the cached flag with the server. Call once on boot. */
export async function bootstrapSession(): Promise<void> {
  const attempt = generation
  const backend = base()
  let token = getToken()
  const current = () => attempt === generation && backend === base() && token === getToken()
  try {
    const boot = globalThis.__kikoBoot
    let early = boot?.token === token && boot?.url === `${backend}/api/me` ? boot.me : undefined
    if (globalThis.__kikoBoot) globalThis.__kikoBoot.me = undefined
    // Development only: /api/auth/dev/session redirects here with the token in the hash.
    const handed = import.meta.env.DEV ? /^#token=(\S+)$/.exec(location.hash)?.[1] : undefined
    if (handed) {
      setToken(handed)
      token = handed
      history.replaceState(null, "", location.pathname + location.search)
      early = undefined
    }
    const res = await (early ?? apiFetch("/api/me"))
    if (!current()) return
    if (res.status === 401) {
      if (state().status !== "signed-out") await signedOut()
      return
    }
    if (!res.ok) throw new Error(String(res.status))
    const { user } = (await res.json()) as { user: SessionUser }
    if (!current()) return
    // A different user than the cached one: the old user's data must not stay.
    const before = state()
    if (before.status === "signed-in" && before.user.id !== user.id) await clearWarmTier(before.user.id)
    if (current()) signedIn(user)
  } catch {
    // offline or a server error. keep the cached flag, and with none show sign-in.
    if (current() && state().status === "unknown") setState({ status: "signed-out" })
  }
}

// A 401 from any call drops the token (api.ts), then shows sign-in.
setUnauthorizedHandler(() => {
  if (state().status === "signed-in") void signedOut()
})

/*
 * Signing out, from any button or command. It drops this person's token, snapshot, warm tier,
 * backend address and profile. A hosted build also ends the Clerk session.
 */
export async function signOut(): Promise<void> {
  setAutoResume(false)
  const done = signedOut()
  const attempt = generation
  if (hosted) await import("./clerk").then((m) => m.clerkSignOut()).catch(() => {})
  await done
  if (attempt === generation) write("kiko:identity", null)
}

async function adopt(res: Response | null, failure: string, attempt: number): Promise<void> {
  if (!res?.ok) throw new Error(failure)
  const { user, token } = (await res.json()) as { user: SessionUser; token: string }
  if (attempt !== generation) return
  setToken(token)
  signedIn(user)
}

/** Signs in with the access code. A wrong code throws the server's message. */
export async function signInWithAccessCode(code: string): Promise<void> {
  const attempt = ++generation
  const res = await apiFetch("/api/auth/access-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  }).catch(() => null)
  if (res && !res.ok) {
    const { message } = (await res.json().catch(() => ({}))) as { message?: string }
    throw new Error(message ?? "Could not sign in. Try again")
  }
  await adopt(res, "Could not sign in. Try again", attempt)
}

/** Development Workers only. Mints a session for a test user. */
export async function signInAsDev(name = "dev"): Promise<void> {
  const attempt = ++generation
  const res = await apiFetch("/api/auth/dev/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })
  await adopt(res, "dev sign-in failed", attempt)
}

/**
 * Hosted sign-in, after Clerk has a session. Trades the Clerk token for the backend's own. Returns
 * "connect" when this person has no backend yet, and "none" when Clerk holds no session.
 */
export async function signInWithClerk(): Promise<"in" | "connect" | "none"> {
  let attempt = ++generation
  const { clerkSignIn } = await import("./clerk")
  const found = await clerkSignIn()
  if (attempt !== generation) return "none"
  if (!found) {
    await signedOut()
    if (generation === attempt + 1) setAutoResume(true)
    return "none"
  }
  setBackendConnectionNotice("")
  const identity = JSON.stringify([found.userId, found.backendUrl?.replace(/\/+$/, "") ?? null])
  if (read("kiko:identity") !== identity) {
    // Stop the old store before changing the address; both backends call their owner "owner".
    const previous = attempt
    await signedOut()
    if (previous + 1 !== generation) return "none"
    attempt = generation
    setAutoResume(true)
    write("kiko:identity", identity)
  }
  await clearing
  if (attempt !== generation) return "none"
  write("kiko:backend", found.backendUrl)
  setProfile(found.profile)
  if (!found.backendUrl) return "connect"
  try {
    await exchangeClerkToken(found.token, attempt)
  } catch (e) {
    if (attempt !== generation) return "none"
    if (e instanceof ClerkRejected) {
      if (e.status === 403 && e.message === "This backend belongs to someone else.") {
        const rejected = found.backendUrl
        await signedOut()
        setBackendConnectionNotice(ownedByAnother(rejected))
        return "connect"
      }
      // Invalid or expired tokens and other forbidden responses are not missing backends.
      if (e.status === 401 || e.status === 403) throw e
    }
    // The address Clerk remembers answers, but not as Kiko: the Worker was deleted or replaced. Install again.
    if (!(e instanceof Unreachable) && (await backendGone()) && attempt === generation) return "connect"
    throw e
  }
  return attempt === generation ? "in" : "none"
}

/** True when the stored address answers but is not a Kiko backend (deleted on Cloudflare, or another Worker). */
async function backendGone(): Promise<boolean> {
  const res = await fetch(`${base()}/api/version`, { cache: "no-store" }).catch(() => null)
  if (!res) return false
  if (!res.ok) return res.status === 404 || res.status === 410
  const body = (await res.json().catch(() => null)) as { version?: unknown } | null
  return typeof body?.version !== "string"
}

/** The backend did not answer at all: no response, so DNS, the network, or a blocker. */
class Unreachable extends Error {}

class ClerkRejected extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const hostOf = () => {
  try {
    return new URL(base()).host
  } catch {
    return "your backend"
  }
}

/** The host of an address, for a sentence about it. */
const hostIn = (address: string | null): string => {
  try {
    return address ? new URL(address).host : "your backend"
  } catch {
    return "your backend"
  }
}

/**
 * The backend this account is pointed at belongs to a different Kiko account. An earlier Kiko gave
 * every account on one Cloudflare account the same Worker name, so a second sign-up took the first
 * one's backend; the current installer gives each account its own. Nothing here can open the other
 * account's backend, so the sentence says what happened and the one thing that fixes it.
 */
export const ownedByAnother = (address: string | null): string =>
  `${hostIn(address)} is another Kiko account's backend. An older version of Kiko shared one backend between accounts on the same Cloudflare account. Install one for this account below: it takes about a minute and leaves the other account's chats alone.`

export const unreachableText = () =>
  `This device cannot reach ${hostOf()} yet. A new Cloudflare address can take a few minutes to reach every network. Try again in a minute. If you use a VPN, Private DNS, or an ad blocker, allow workers.dev.`

async function exchangeClerkToken(clerkToken: string, attempt: number): Promise<void> {
  const res = await apiFetch("/api/auth/clerk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: clerkToken }),
  }).catch(() => null)
  if (!res) throw new Unreachable(unreachableText())
  if (!res.ok) {
    const { message } = (await res.json().catch(() => ({}))) as { message?: string }
    throw new ClerkRejected(res.status, message ? `${message}.` : `Your backend answered ${res.status}. Try again.`)
  }
  await adopt(res, "Could not sign in. Try again", attempt)
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
  let attempt = ++generation
  const { clerkSignIn } = await import("./clerk")
  const until = Date.now() + REACH_MS
  for (;;) {
    const found = await clerkSignIn()
    if (attempt !== generation) return
    if (!found) throw new Error("Your Kiko sign-in ended. Sign in again to finish connecting.")
    const identity = JSON.stringify([found.userId, base() || null])
    if (read("kiko:identity") !== identity) {
      const previous = attempt
      await signedOut(false)
      if (generation !== previous + 1) return
      attempt = generation
      write("kiko:identity", identity)
      setProfile(found.profile)
    }
    await clearing
    if (attempt !== generation) return
    try {
      return await exchangeClerkToken(found.token, attempt)
    } catch (e) {
      if (!(e instanceof Unreachable) || Date.now() + REACH_STEP_MS > until) throw e
      await new Promise((r) => setTimeout(r, REACH_STEP_MS))
    }
  }
}
