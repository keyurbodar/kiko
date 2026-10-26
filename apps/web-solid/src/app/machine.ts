import { type AuthRecord, type Ready, readyOf, recordOf } from "./auth-record"
import type {
  Backend,
  BackendUser,
  ClerkUserId,
  Descriptor,
  Identity,
  InstallPhase,
  NeedsBackendReason,
  Phase,
  SessionToken,
  UpdatePhase,
} from "./phase"

export interface ClerkUser {
  readonly id: ClerkUserId
  readonly email: string
}

export type Exchange =
  | { readonly _tag: "Ok"; readonly user: BackendUser; readonly token: SessionToken }
  | { readonly _tag: "Expired" }
  | { readonly _tag: "Invalid" }
  | { readonly _tag: "NotOwner" }
  | { readonly _tag: "Unreachable" }

export type Event =
  | { readonly _tag: "Clerk"; readonly user: ClerkUser | null; readonly callback: boolean }
  | { readonly _tag: "ClerkFailed" }
  | { readonly _tag: "ClerkSignedOut"; readonly user: ClerkUser | null }
  | { readonly _tag: "Pointed"; readonly backend: Backend | null }
  | { readonly _tag: "Described"; readonly backend: Backend; readonly descriptor: Descriptor }
  | { readonly _tag: "Exchanged"; readonly backend: Backend; readonly fresh: boolean; readonly result: Exchange }
  | { readonly _tag: "SignedIn"; readonly record: AuthRecord }
  | { readonly _tag: "Rejected" }
  | { readonly _tag: "Continue" }
  | { readonly _tag: "SwitchAccount" }
  | { readonly _tag: "Retry" }
  | { readonly _tag: "ConnectCloudflare" }
  | { readonly _tag: "Install"; readonly install: InstallPhase }
  | { readonly _tag: "Installed" }
  | { readonly _tag: "Detached" }
  | { readonly _tag: "Update"; readonly update: UpdatePhase }
  | { readonly _tag: "SignOut" }
  | { readonly _tag: "Stored"; readonly record: AuthRecord | null }

export type Attempt =
  | { readonly _tag: "CheckClerk"; readonly callback: boolean }
  | { readonly _tag: "Verify"; readonly identity: Identity }
  | { readonly _tag: "Point"; readonly identity: Identity }
  | { readonly _tag: "Describe"; readonly backend: Backend }
  | { readonly _tag: "Exchange"; readonly backend: Backend; readonly fresh: boolean }
  | { readonly _tag: "Probe"; readonly backend: Backend; readonly since: number }

export type Task =
  | { readonly _tag: "Save"; readonly record: AuthRecord }
  | { readonly _tag: "Purge" }
  | { readonly _tag: "SignOut" }
  | { readonly _tag: "FinishSignOut" }
  | { readonly _tag: "Reset" }
  | { readonly _tag: "Reload" }

export type Command = Attempt | Task

const ATTEMPTS: ReadonlySet<Command["_tag"]> = new Set([
  "CheckClerk",
  "Verify",
  "Point",
  "Describe",
  "Exchange",
  "Probe",
])

export const isAttempt = (command: Command): command is Attempt => ATTEMPTS.has(command._tag)

export interface Step {
  readonly phase: Phase
  readonly command: Command | null
}

export interface Boot {
  readonly record: AuthRecord | null
  readonly signingOut: boolean
  readonly hosted: boolean
  readonly clerkSession: boolean
  readonly callback: boolean
}

type Of<T extends Phase["_tag"]> = Extract<Phase, { readonly _tag: T }>
type ExchangedEvent = Extract<Event, { readonly _tag: "Exchanged" }>
type WithIdentity = Of<"Resolving" | "NeedsBackend" | "Installing" | "Unreachable">

const BOOTING: Phase = { _tag: "Booting" }
const SIGNED_OUT: Phase = { _tag: "SignedOut", clerk: { _tag: "None" } }
const SIGNING_OUT: Phase = { _tag: "SigningOut" }

const to = (phase: Phase, command: Command | null = null): Step => ({ phase, command })
const stay = (phase: Phase): Step => to(phase)
const reset = to(SIGNING_OUT, { _tag: "Reset" })

const identityOf = (user: ClerkUser): Identity => ({ clerkUserId: user.id, email: user.email })
const resolve = (identity: Identity): Step => to({ _tag: "Resolving", identity }, { _tag: "Point", identity })
const needs = (
  identity: Identity,
  reason: NeedsBackendReason,
  previous: Backend | null,
  command: Command | null = null,
) => to({ _tag: "NeedsBackend", identity, reason, previous }, command)
const unreachable = (identity: Identity, backend: Backend, now: number): Step =>
  to({ _tag: "Unreachable", identity, backend, since: now }, { _tag: "Probe", backend, since: now })
const installing = (identity: Identity, install: InstallPhase): Step => to({ _tag: "Installing", identity, install })
const opened = (record: AuthRecord): Step => to(readyOf(record), { _tag: "Save", record })

export function start(boot: Boot): Step {
  if (boot.signingOut) return to(BOOTING, { _tag: "FinishSignOut" })
  if (boot.record) {
    const { identity } = boot.record
    return to(readyOf(boot.record), boot.hosted && identity.clerkUserId ? { _tag: "Verify", identity } : null)
  }
  if (!boot.hosted) return to(SIGNED_OUT)
  const check: Command = { _tag: "CheckClerk", callback: boot.callback }
  return to(boot.clerkSession || boot.callback ? BOOTING : SIGNED_OUT, check)
}

const signedOutAs = (user: ClerkUser | null): Step =>
  to(user ? { _tag: "SignedOut", clerk: { _tag: "Live", email: user.email } } : SIGNED_OUT)

function booting(phase: Phase, event: Event): Step {
  switch (event._tag) {
    case "Clerk":
      if (!event.user) return to(SIGNED_OUT)
      return event.callback
        ? installing(identityOf(event.user), { _tag: "Authorizing" })
        : resolve(identityOf(event.user))
    case "ClerkFailed":
      return to(SIGNED_OUT)
    case "ClerkSignedOut":
      return signedOutAs(event.user)
    case "SignedIn":
      return opened(event.record)
    default:
      return stay(phase)
  }
}

function signedOut(phase: Of<"SignedOut">, event: Event): Step {
  const live = phase.clerk._tag === "Live"
  switch (event._tag) {
    case "Clerk":
      if (!event.user) return live ? to(SIGNED_OUT) : stay(phase)
      return live ? stay(phase) : resolve(identityOf(event.user))
    case "ClerkSignedOut":
      return signedOutAs(event.user)
    case "Continue":
      return live ? to(BOOTING, { _tag: "CheckClerk", callback: false }) : stay(phase)
    case "SwitchAccount":
      return live ? to(BOOTING, { _tag: "FinishSignOut" }) : stay(phase)
    case "SignedIn":
      return opened(event.record)
    default:
      return stay(phase)
  }
}

const backendOf = (phase: WithIdentity): Backend | null =>
  phase._tag === "Unreachable" ? phase.backend : phase._tag === "NeedsBackend" ? phase.previous : null

function withIdentity(phase: WithIdentity, event: Event): Step {
  switch (event._tag) {
    case "Clerk":
      if (!event.user) return to(SIGNED_OUT)
      return event.user.id === phase.identity.clerkUserId ? stay(phase) : reset
    case "ConnectCloudflare":
      return installing(phase.identity, { _tag: "Authorizing" })
    case "Install":
      return installing(phase.identity, event.install)
    case "Installed":
      return resolve(phase.identity)
    case "Detached":
      return needs(phase.identity, "detached", backendOf(phase), { _tag: "Purge" })
    case "Retry":
      return phase._tag === "Unreachable" || phase._tag === "NeedsBackend" ? resolve(phase.identity) : stay(phase)
    default:
      return stay(phase)
  }
}

function described(phase: Of<"Resolving">, backend: Backend, descriptor: Descriptor, now: number): Step {
  switch (descriptor._tag) {
    case "Current":
      return to(phase, { _tag: "Exchange", backend, fresh: false })
    case "Legacy":
      return needs(phase.identity, "legacy", backend)
    case "Gone":
      return needs(phase.identity, "gone", backend)
    case "Unreachable":
      return unreachable(phase.identity, backend, now)
  }
}

function exchangedWhileResolving(phase: Of<"Resolving">, event: ExchangedEvent, now: number): Step {
  const { backend, result } = event
  switch (result._tag) {
    case "Ok":
      return opened({ v: 1, identity: phase.identity, backend, user: result.user, token: result.token })
    case "Expired":
      return event.fresh
        ? needs(phase.identity, "legacy", backend)
        : to(phase, { _tag: "Exchange", backend, fresh: true })
    case "Invalid":
      return needs(phase.identity, "legacy", backend)
    case "NotOwner":
      return needs(phase.identity, "not_owner", backend)
    case "Unreachable":
      return unreachable(phase.identity, backend, now)
  }
}

function resolving(phase: Of<"Resolving">, event: Event, now: number): Step {
  switch (event._tag) {
    case "Pointed":
      return event.backend
        ? to(phase, { _tag: "Describe", backend: event.backend })
        : needs(phase.identity, "none", null)
    case "Described":
      return described(phase, event.backend, event.descriptor, now)
    case "Exchanged":
      return exchangedWhileResolving(phase, event, now)
    default:
      return withIdentity(phase, event)
  }
}

function renewed(phase: Ready, event: ExchangedEvent, now: number): Step {
  if (event.backend.key !== phase.backend.key) return stay(phase)
  const { result } = event
  switch (result._tag) {
    case "Ok":
      return opened({ ...recordOf(phase), user: result.user, token: result.token })
    case "NotOwner":
      return needs(phase.identity, "not_owner", phase.backend, { _tag: "Purge" })
    case "Expired":
    case "Invalid":
      return needs(phase.identity, "legacy", phase.backend, { _tag: "Purge" })
    case "Unreachable":
      return unreachable(phase.identity, phase.backend, now)
  }
}

function pointedWhileReady(phase: Ready, backend: Backend | null): Step {
  if (!backend) return needs(phase.identity, "detached", phase.backend, { _tag: "Purge" })
  return backend.key === phase.backend.key ? stay(phase) : reset
}

function ready(phase: Ready, event: Event, now: number): Step {
  const { identity } = phase
  switch (event._tag) {
    case "Clerk":
      if (identity.clerkUserId === null) return stay(phase)
      return event.user?.id === identity.clerkUserId ? stay(phase) : reset
    case "Pointed":
      return pointedWhileReady(phase, event.backend)
    case "Rejected":
      return identity.clerkUserId === null
        ? reset
        : to(phase, { _tag: "Exchange", backend: phase.backend, fresh: true })
    case "Exchanged":
      return renewed(phase, event, now)
    case "Installed":
      return identity.clerkUserId === null ? stay(phase) : to(phase, { _tag: "Verify", identity })
    case "Detached":
      return needs(identity, "detached", phase.backend, { _tag: "Purge" })
    case "Update":
      return to({ ...phase, update: event.update })
    default:
      return stay(phase)
  }
}

function stored(phase: Phase, record: AuthRecord | null): Step {
  if (phase._tag !== "Ready") return record ? to(phase, { _tag: "Reload" }) : stay(phase)
  if (!record || record.backend.key !== phase.backend.key) return to(phase, { _tag: "Reload" })
  return record.token === phase.token ? stay(phase) : to({ ...phase, token: record.token })
}

export function transition(phase: Phase, event: Event, now: number): Step {
  if (phase._tag === "SigningOut") return stay(phase)
  if (event._tag === "SignOut") return to(SIGNING_OUT, { _tag: "SignOut" })
  if (event._tag === "Stored") return stored(phase, event.record)
  switch (phase._tag) {
    case "Booting":
      return booting(phase, event)
    case "SignedOut":
      return signedOut(phase, event)
    case "Resolving":
      return resolving(phase, event, now)
    case "Ready":
      return ready(phase, event, now)
    default:
      return withIdentity(phase, event)
  }
}
