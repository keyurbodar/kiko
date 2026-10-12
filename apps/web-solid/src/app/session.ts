import { createSignal } from "solid-js"

/*
 * The session, as the client sees it (architecture section 10). A cached flag in
 * localStorage answers on the first frame, so a signed-in person never waits on
 * the network. `/api/me` confirms it in the background. A 401 from any call, or
 * signing out, removes that user's warm tier and shows sign-in.
 */

export interface SessionUser {
  id: string
  name: string
  email: string
  image: string | null
}

/** unknown: no cached flag yet, so the first `/api/me` decides. */
export type SessionState = { status: "unknown" } | { status: "signed-in"; user: SessionUser } | { status: "signed-out" }

export interface Providers {
  google: boolean
  github: boolean
  /** True only on a development Worker, which has the dev session route. */
  dev: boolean
}

const FLAG_KEY = "yuki:session"

/*
 * ASSUMPTION: the warm tier (P2-05) names each user's database
 * `yuki-warm:<userId>`, optionally with more after a second colon. Clearing deletes
 * every database with that name or prefix.
 */
export const warmDbPrefix = (userId: string) => `yuki:warm:${userId}`

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

/** A sign-in redirect lands with this query, so its first frame waits on `/api/me` instead of showing sign-in. */
export const SIGNED_IN_PARAM = "signed-in"

/*
 * A signed-in browser always has the cached flag, so no flag means sign-in shows on the first frame.
 * Only a fresh sign-in redirect, which has the cookie but not yet the flag, waits for `/api/me`.
 */
const cached = readFlag()
const returning = typeof location !== "undefined" && new URLSearchParams(location.search).has(SIGNED_IN_PARAM)
const [state, setState] = createSignal<SessionState>(
  cached ? { status: "signed-in", user: cached } : returning ? { status: "unknown" } : { status: "signed-out" },
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
  setState({ status: "signed-out" })
  if (userId) await clearWarmTier(userId)
}

/** Confirms the cached flag with the server. Call once on boot. */
export async function bootstrapSession(): Promise<void> {
  try {
    const early = globalThis.__yukiBoot?.me
    if (globalThis.__yukiBoot) globalThis.__yukiBoot.me = undefined
    const res = await (early ?? fetch("/api/me"))
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

/** `fetch` for every call to the Worker. A 401 signs the person out. */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401 && state().status === "signed-in") void signedOut()
  return res
}

export async function signOut(): Promise<void> {
  try {
    localStorage.removeItem("yuki:snap")
  } catch {}
  try {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
  } catch {
    // the local sign-out below does not wait on the network
  }
  await signedOut()
}

export async function loadProviders(): Promise<Providers> {
  try {
    const early = globalThis.__yukiBoot?.providers
    if (globalThis.__yukiBoot) globalThis.__yukiBoot.providers = undefined
    const res = await (early ?? fetch("/api/providers"))
    if (res.ok) return (await res.json()) as Providers
  } catch {
    // fall through to none
  }
  return { google: false, github: false, dev: false }
}

/** Starts the OAuth redirect for a provider. */
export async function signInWithProvider(provider: "google" | "github"): Promise<void> {
  const res = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, callbackURL: `/chat?${SIGNED_IN_PARAM}=1` }),
  })
  const { url } = (await res.json()) as { url?: string }
  if (!url) throw new Error("no sign-in url")
  location.assign(url)
}

/** Development Workers only. Mints a session for a test user, then reads it back. */
export async function signInAsDev(name = "dev"): Promise<void> {
  const res = await fetch("/api/auth/dev/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error("dev sign-in failed")
  const me = await fetch("/api/me")
  if (!me.ok) throw new Error("dev sign-in failed")
  signedIn(((await me.json()) as { user: SessionUser }).user)
}
