import { createSignal } from "solid-js"
import { apiFetch, getToken, setToken, setUnauthorizedHandler } from "../lib/api"
import { base, read, write } from "../lib/api-base"
import { clearFileToken } from "../lib/file-token"
import { hosted, setProfile } from "./hosted"

export interface SessionUser {
  id: string
  name: string
}

export type SessionState = { status: "unknown" } | { status: "signed-in"; user: SessionUser } | { status: "signed-out" }

const FLAG_KEY = "kiko:session"
const CLEANUP_KEY = "kiko:pending-cleanup"
function readPendingCleanup(): string[] {
  try {
    const ids: unknown = JSON.parse(read(CLEANUP_KEY) ?? "[]")
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}
let generation = 0
let clearing: Promise<void> = Promise.resolve()
const pendingCleanup = new Set(readPendingCleanup())
function savePendingCleanup(): void {
  if (!pendingCleanup.size) {
    write(CLEANUP_KEY, null)
    return
  }
  const value = JSON.stringify([...pendingCleanup])
  try {
    localStorage.setItem(CLEANUP_KEY, value)
    if (localStorage.getItem(CLEANUP_KEY) !== value) throw new Error("Cleanup was not saved")
  } catch {
    throw new Error("Could not safely clear this account's local data. Allow browser storage and try again.")
  }
}
export const [authReset, setAuthReset] = createSignal(0)
export const [autoResume, setAutoResume] = createSignal(true)
export const authIdentity = () => read("kiko:identity") ?? base()
export const authGeneration = () => generation
export const cancelAuthAttempt = () => {
  generation++
}
export const allowClerkResume = () => setAutoResume(true)

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
  } catch {}
}

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

async function finishCleanup(): Promise<void> {
  clearing = clearing
    .catch(() => {})
    .then(async () => {
      for (const id of pendingCleanup) {
        await clearWarmTier(id)
        pendingCleanup.delete(id)
        savePendingCleanup()
      }
    })
  await clearing
}

async function signedOut(reset = true): Promise<void> {
  generation++
  const current = state()
  const userId = current.status === "signed-in" ? current.user.id : readFlag()?.id
  if (userId) pendingCleanup.add(userId)
  savePendingCleanup()
  if (reset) setAuthReset((n) => n + 1)
  setBackendConnectionNotice("")
  setProfile(null)
  write("kiko:snap", null)
  writeFlag(null)
  setToken(null)
  clearFileToken()
  setState({ status: "signed-out" })
  await finishCleanup()
}

export async function bootstrapSession(): Promise<void> {
  const attempt = generation
  const backend = base()
  let token = getToken()
  const current = () => attempt === generation && backend === base() && token === getToken()
  try {
    const boot = globalThis.__kikoBoot
    let early = boot?.token === token && boot?.url === `${backend}/api/me` ? boot.me : undefined
    if (globalThis.__kikoBoot) globalThis.__kikoBoot.me = undefined
    const handed = import.meta.env.DEV ? /^#token=(\S+)$/.exec(location.hash)?.[1] : undefined
    if (handed) {
      setToken(handed)
      token = handed
      history.replaceState(null, "", location.pathname + location.search)
      early = undefined
    }
    if (!token) {
      if (state().status !== "signed-out") await signedOut()
      else await finishCleanup()
      return
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
    const before = state()
    if (before.status === "signed-in" && before.user.id !== user.id) await clearWarmTier(before.user.id)
    await finishCleanup()
    if (current()) signedIn(user)
  } catch {
    if (current() && state().status === "unknown") setState({ status: "signed-out" })
  }
}

setUnauthorizedHandler(() => {
  if (state().status === "signed-in") void signedOut()
})

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
  await finishCleanup()
  if (attempt !== generation) return
  setToken(token)
  signedIn(user)
}

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

export async function signInAsDev(name = "dev"): Promise<void> {
  const attempt = ++generation
  const res = await apiFetch("/api/auth/dev/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })
  await adopt(res, "dev sign-in failed", attempt)
}

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
        await signedOut()
        write("kiko:backend", null)
        setBackendConnectionNotice(
          "This backend belongs to another Kiko account. Connect your own Cloudflare backend to continue, or sign out and use the account that owns it.",
        )
        return "connect"
      }
      if (e.status === 401 || e.status === 403) throw e
    }
    if (!(e instanceof Unreachable) && (await backendGone()) && attempt === generation) return "connect"
    throw e
  }
  return attempt === generation ? "in" : "none"
}

async function backendGone(): Promise<boolean> {
  const res = await fetch(`${base()}/api/version`, { cache: "no-store" }).catch(() => null)
  if (!res) return false
  if (!res.ok) return res.status === 404 || res.status === 410
  const body = (await res.json().catch(() => null)) as { version?: unknown } | null
  return typeof body?.version !== "string"
}

class Unreachable extends Error {}

class ClerkRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
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

const REACH_MS = 90_000
const REACH_STEP_MS = 3_000

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
