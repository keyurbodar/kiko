import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { createSignal } from "solid-js"
import { apiFetch, setUnauthorizedHandler } from "../lib/api"
import { base, useBackend } from "../lib/api-base"
import { onAuthChange, purge, readAuth, setSigningOut, signingOut, writeAuth } from "../lib/storage"
import { attachBackend, releaseRuntime } from "../state/runtime"
import { formatRecord, parseRecord } from "./auth-record"
import { backendKey, describeBackend, exchangeToken, normalizeUrl, sessionOf } from "./backend"
import { clerkPointer, clerkSignOut, clerkToken, clerkUser, onClerkUser } from "./clerk"
import { hosted, setProfile } from "./hosted"
import { type ClerkUser, type Event, start } from "./machine"
import type { BackendUser, Phase } from "./phase"
import { BackendClient, Clerk, ClerkUnavailable, DetachFailed, Device, Installer, Session } from "./session-service"

type SessionState = { status: "unknown" } | { status: "signed-in"; user: BackendUser } | { status: "signed-out" }

const INSTALLER_URL = (import.meta.env.VITE_INSTALLER_URL ?? "").replace(/\/+$/, "")
const RELEASE_TIMEOUT = "10 seconds"

const messageOf = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback

const fromClerk = <A>(use: () => Promise<A>) =>
  Effect.tryPromise({
    try: use,
    catch: (cause) => new ClerkUnavailable({ message: messageOf(cause, "Kiko could not reach Clerk.") }),
  })

const ClerkLive = Layer.succeed(Clerk, {
  user: fromClerk(clerkUser),
  changes: Stream.callback<ClerkUser | null>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => onClerkUser((user) => Queue.offerUnsafe(queue, user))),
      (stop) => Effect.sync(stop),
    ),
  ),
  pointer: fromClerk(clerkPointer).pipe(
    Effect.tap((pointed) => Effect.sync(() => pointed && setProfile(pointed.profile))),
    Effect.map((pointed) => (pointed?.url ? normalizeUrl(pointed.url) : null)),
  ),
  token: (fresh) => fromClerk(() => clerkToken(fresh)),
  signOut: fromClerk(clerkSignOut),
})

const ClerkNone = Layer.succeed(Clerk, {
  user: Effect.succeed(null),
  changes: Stream.empty,
  pointer: Effect.succeed(null),
  token: () => Effect.succeed(null),
  signOut: Effect.void,
})

const request = (input: string, init?: RequestInit) => fetch(input, init)

const BackendLive = Layer.succeed(BackendClient, {
  describe: (url) => Effect.promise(() => describeBackend(url, request)),
  exchange: (url, clerkToken) => Effect.promise(() => exchangeToken(url, clerkToken, request)),
  key: (clerkUserId, url) => Effect.promise(() => backendKey(clerkUserId, url)),
})

const DeviceLive = Layer.succeed(Device, {
  save: (record) => Effect.sync(() => writeAuth(formatRecord(record))),
  clearAuth: Effect.sync(() => writeAuth(null)),
  signingOut: (on) => Effect.sync(() => setSigningOut(on)),
  release: Effect.promise(releaseRuntime).pipe(Effect.timeoutOption(RELEASE_TIMEOUT), Effect.asVoid),
  purge: Effect.promise(() => purge().catch(() => {})),
  leave: Effect.sync(() => location.replace("/")),
  reload: Effect.sync(() => location.reload()),
})

const InstallerLive = Layer.succeed(Installer, {
  detach: (clerkToken) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${INSTALLER_URL}/detach`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clerkToken }),
        })
        if (response.status !== 204) throw new Error(String(response.status))
      },
      catch: () => new DetachFailed({ message: "Kiko could not forget this backend. Try again." }),
    }),
})

const clerkSession = (): boolean => {
  const active = /(?:^|;\s*)__client_uat=([^;]*)/.exec(document.cookie)?.[1]
  return active !== undefined && active !== "0"
}

const initial = start({
  record: parseRecord(readAuth()),
  signingOut: signingOut(),
  hosted,
  clerkSession: clerkSession(),
  callback: location.pathname === "/connect/callback",
})

const runtime = ManagedRuntime.make(
  Session.layer(initial).pipe(
    Layer.provide(Layer.mergeAll(hosted ? ClerkLive : ClerkNone, BackendLive, DeviceLive, InstallerLive)),
  ),
)

const [phase, setPhase] = createSignal<Phase>(initial.phase)
export { phase }

function follow(next: Phase): void {
  const attachment = next._tag === "Ready" ? { url: next.backend.url, key: next.backend.key, token: next.token } : null
  useBackend(attachment)
  attachBackend(attachment)
  setPhase(next)
}

follow(initial.phase)

const dispatch = (event: Event): Promise<void> => runtime.runPromise(Session.use((session) => session.send(event)))

void runtime.runPromise(
  Session.use((session) =>
    SubscriptionRef.changes(session.phase).pipe(Stream.runForEach((next) => Effect.sync(() => follow(next)))),
  ),
)

onAuthChange((raw) => void dispatch({ _tag: "Stored", record: parseRecord(raw) }))

setUnauthorizedHandler(() => void dispatch({ _tag: "Rejected" }))

export function session(): SessionState {
  const current = phase()
  if (current._tag === "Ready") return { status: "signed-in", user: current.user }
  return current._tag === "Booting" || current._tag === "SigningOut" ? { status: "unknown" } : { status: "signed-out" }
}

export const signOut = (): Promise<void> => dispatch({ _tag: "SignOut" })

export const continueAs = (): Promise<void> => dispatch({ _tag: "Continue" })

export const useAnotherAccount = (): Promise<void> => dispatch({ _tag: "SwitchAccount" })

export const retryBackend = (): Promise<void> => dispatch({ _tag: "Retry" })

export const connectCloudflare = (): Promise<void> => dispatch({ _tag: "ConnectCloudflare" })

export const rejected = (): Promise<void> => dispatch({ _tag: "Rejected" })

export const signInToInstalledBackend = (): Promise<void> =>
  runtime.runPromise(
    Session.use((session) => session.send({ _tag: "Installed" }).pipe(Effect.andThen(session.settled))),
  )

export async function forgetBackend(): Promise<void> {
  const failure = await runtime.runPromise(
    Session.use((session) =>
      session.forget.pipe(
        Effect.as(null),
        Effect.catch((error) => Effect.succeed(error.message)),
      ),
    ),
  )
  if (failure !== null) throw new Error(failure)
}

const bodyOf = (response: Response): Promise<unknown> => response.json().catch(() => null)

async function openSession(body: unknown): Promise<void> {
  const signed = sessionOf(body)
  if (!signed) throw new Error("Could not sign in. Try again")
  const url = normalizeUrl(base() || location.origin)
  const backend = { url, key: await backendKey(null, url) }
  const record = { v: 1 as const, identity: { clerkUserId: null, email: "" }, backend, ...signed }
  await dispatch({ _tag: "SignedIn", record })
}

export async function signInWithAccessCode(code: string): Promise<void> {
  const response = await apiFetch("/api/auth/access-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  }).catch(() => null)
  if (!response) throw new Error("Could not reach Kiko. Check your connection, then try again")
  if (!response.ok) {
    const { message } = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(message ?? "Could not sign in. Try again")
  }
  await openSession(await bodyOf(response))
}

export async function signInAsDev(name = "dev"): Promise<void> {
  const response = await apiFetch("/api/auth/dev/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error("dev sign-in failed")
  await openSession(await bodyOf(response))
}

if (import.meta.env.DEV) {
  const handed = /^#token=(\S+)$/.exec(location.hash)?.[1]
  if (handed) {
    history.replaceState(null, "", location.pathname + location.search)
    void fetch(`${base()}/api/me`, { headers: { authorization: `Bearer ${handed}` } })
      .then(bodyOf)
      .then((body) => openSession({ ...(body as object), token: handed }))
      .catch(() => {})
  }
}
