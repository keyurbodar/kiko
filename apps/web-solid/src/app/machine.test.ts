import { describe, expect, it } from "vitest"
import { readyOf, type AuthRecord } from "./auth-record"
import { start, transition, type ClerkUser, type Event, type Exchange } from "./machine"
import type {
  Backend,
  BackendKey,
  BackendUrl,
  ClerkUserId,
  Descriptor,
  Identity,
  InstallPhase,
  Phase,
  SessionToken,
} from "./phase"

const NOW = 50_000
const alice: ClerkUser = { id: "user_alice" as ClerkUserId, email: "alice@example.com" }
const bob: ClerkUser = { id: "user_bob" as ClerkUserId, email: "bob@example.com" }
const identity: Identity = { clerkUserId: alice.id, email: alice.email }
const backend: Backend = { url: "https://kiko.alice.workers.dev" as BackendUrl, key: "aaaaaaaaaaaaaaaa" as BackendKey }
const elsewhere: Backend = {
  url: "https://kiko.other.workers.dev" as BackendUrl,
  key: "bbbbbbbbbbbbbbbb" as BackendKey,
}
const token = "owner.session.100.mac" as SessionToken
const user = { id: "owner", name: "owner" }
const record: AuthRecord = { v: 1, identity, backend, user, token }
const ready = readyOf(record)
const codeRecord: AuthRecord = {
  ...record,
  identity: { clerkUserId: null, email: "" },
  token: "dev.session.100.mac" as SessionToken,
}

const booting: Phase = { _tag: "Booting" }
const signedOut: Phase = { _tag: "SignedOut", clerk: { _tag: "None" } }
const stillSignedIn: Phase = { _tag: "SignedOut", clerk: { _tag: "Live", email: alice.email } }
const resolving: Phase = { _tag: "Resolving", identity }
const needsBackend: Phase = { _tag: "NeedsBackend", identity, reason: "none", previous: null }
const installing: Phase = { _tag: "Installing", identity, install: { _tag: "Authorizing" } }
const unreachable: Phase = { _tag: "Unreachable", identity, backend, since: 10_000 }
const signingOut: Phase = { _tag: "SigningOut" }

const step = (phase: Phase, event: Event) => transition(phase, event, NOW)
const clerk = (who: ClerkUser | null, callback = false): Event => ({ _tag: "Clerk", user: who, callback })
const exchanged = (result: Exchange, fresh = false): Event => ({ _tag: "Exchanged", backend, fresh, result })
const described = (descriptor: Descriptor): Event => ({ _tag: "Described", backend, descriptor })
const fresh = { user, token: "owner.session.200.mac" as SessionToken }

describe("booting", () => {
  it("opens a stored sign-in at once and checks Clerk in the background", () => {
    expect(start({ record, signingOut: false, hosted: true, clerkSession: true, callback: false })).toEqual({
      phase: ready,
      command: { _tag: "Verify", identity },
    })
  })

  it("opens an access-code sign-in without Clerk", () => {
    expect(
      start({ record: codeRecord, signingOut: false, hosted: false, clerkSession: false, callback: false }),
    ).toEqual({
      phase: readyOf(codeRecord),
      command: null,
    })
  })

  it.each([
    ["no Clerk session", null],
    ["another Clerk user", bob],
  ])("purges and reloads when the background check finds %s", (_, who) => {
    expect(step(ready, clerk(who))).toEqual({ phase: signingOut, command: { _tag: "Reset" } })
  })

  it("keeps the stored sign-in when the background check finds the same user", () => {
    expect(step(ready, clerk(alice))).toEqual({ phase: ready, command: null })
  })

  it("loads Clerk when nothing is stored, then resolves its session", () => {
    expect(start({ record: null, signingOut: false, hosted: true, clerkSession: true, callback: false })).toEqual({
      phase: booting,
      command: { _tag: "CheckClerk", callback: false },
    })
    expect(step(booting, clerk(alice))).toEqual({ phase: resolving, command: { _tag: "Point", identity } })
  })

  it("shows the sign-in button at once when Clerk's cookie says no one is signed in, then confirms in the background", () => {
    expect(start({ record: null, signingOut: false, hosted: true, clerkSession: false, callback: false })).toEqual({
      phase: signedOut,
      command: { _tag: "CheckClerk", callback: false },
    })
    expect(step(signedOut, clerk(null))).toEqual({ phase: signedOut, command: null })
    expect(step(signedOut, clerk(alice))).toEqual({ phase: resolving, command: { _tag: "Point", identity } })
  })

  it("shows the sign-in form when there is no record and no Clerk session", () => {
    expect(step(booting, clerk(null))).toEqual({ phase: signedOut, command: null })
    expect(step(booting, { _tag: "ClerkFailed" })).toEqual({ phase: signedOut, command: null })
  })

  it("shows the access-code form on an install without Clerk", () => {
    expect(start({ record: null, signingOut: false, hosted: false, clerkSession: false, callback: false })).toEqual({
      phase: signedOut,
      command: null,
    })
  })

  it("finishes an interrupted sign-out before anything else, even with a record left behind", () => {
    expect(start({ record, signingOut: true, hosted: true, clerkSession: true, callback: false })).toEqual({
      phase: booting,
      command: { _tag: "FinishSignOut" },
    })
    expect(step(booting, { _tag: "ClerkSignedOut", user: null })).toEqual({ phase: signedOut, command: null })
  })

  it("offers the live session instead of resuming it when Clerk would not sign out", () => {
    expect(step(booting, { _tag: "ClerkSignedOut", user: alice })).toEqual({ phase: stillSignedIn, command: null })
  })

  it("goes straight to the install when Cloudflare sends the owner back", () => {
    expect(
      start({ record: null, signingOut: false, hosted: true, clerkSession: true, callback: true }).command,
    ).toEqual({
      _tag: "CheckClerk",
      callback: true,
    })
    expect(step(booting, clerk(alice, true))).toEqual({ phase: installing, command: null })
  })
})

describe("signed out", () => {
  it("resolves a session that the mounted sign-in form creates", () => {
    expect(step(signedOut, clerk(alice))).toEqual({ phase: resolving, command: { _tag: "Point", identity } })
  })

  it("does not sign back in on its own after a failed sign-out", () => {
    expect(step(stillSignedIn, clerk(alice))).toEqual({ phase: stillSignedIn, command: null })
  })

  it("continues as the live session only when asked", () => {
    expect(step(stillSignedIn, { _tag: "Continue" })).toEqual({
      phase: booting,
      command: { _tag: "CheckClerk", callback: false },
    })
  })

  it("signs out of Clerk again to use another account", () => {
    expect(step(stillSignedIn, { _tag: "SwitchAccount" })).toEqual({
      phase: booting,
      command: { _tag: "FinishSignOut" },
    })
  })

  it("forgets the live session when Clerk signs out elsewhere", () => {
    expect(step(stillSignedIn, clerk(null))).toEqual({ phase: signedOut, command: null })
  })

  it("opens and saves an access-code sign-in", () => {
    expect(step(signedOut, { _tag: "SignedIn", record: codeRecord })).toEqual({
      phase: readyOf(codeRecord),
      command: { _tag: "Save", record: codeRecord },
    })
  })
})

describe("resolving", () => {
  it("needs a backend when the Clerk user has no pointer", () => {
    expect(step(resolving, { _tag: "Pointed", backend: null })).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason: "none", previous: null },
      command: null,
    })
  })

  it("describes the backend the pointer names", () => {
    expect(step(resolving, { _tag: "Pointed", backend })).toEqual({
      phase: resolving,
      command: { _tag: "Describe", backend },
    })
  })

  it("exchanges the Clerk token with a current backend", () => {
    expect(step(resolving, described({ _tag: "Current", version: "1.0.0", protocol: 3, selfUpdate: true }))).toEqual({
      phase: resolving,
      command: { _tag: "Exchange", backend, fresh: false },
    })
  })

  it.each([
    ["legacy", { _tag: "Legacy", version: "0.8.0" }],
    ["gone", { _tag: "Gone" }],
  ] as const)("needs a backend (%s) when the descriptor says so", (reason, descriptor) => {
    expect(step(resolving, described(descriptor))).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason, previous: backend },
      command: null,
    })
  })

  it("writes kiko:auth and opens the app when the exchange succeeds", () => {
    const next = readyOf({ ...record, ...fresh })
    expect(step(resolving, exchanged({ _tag: "Ok", ...fresh }))).toEqual({
      phase: next,
      command: { _tag: "Save", record: { ...record, ...fresh } },
    })
  })

  it("retries an expired Clerk token once with a fresh one", () => {
    expect(step(resolving, exchanged({ _tag: "Expired" }))).toEqual({
      phase: resolving,
      command: { _tag: "Exchange", backend, fresh: true },
    })
    expect(step(resolving, exchanged({ _tag: "Expired" }, true))).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason: "legacy", previous: backend },
      command: null,
    })
  })

  it("needs a reconnect when the backend rejects a valid Clerk token", () => {
    expect(step(resolving, exchanged({ _tag: "Invalid" }))).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason: "legacy", previous: backend },
      command: null,
    })
  })

  it("needs a backend of its own when the backend belongs to someone else", () => {
    expect(step(resolving, exchanged({ _tag: "NotOwner" }))).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason: "not_owner", previous: backend },
      command: null,
    })
  })

  it.each([
    ["the descriptor", described({ _tag: "Unreachable" })],
    ["the exchange", exchanged({ _tag: "Unreachable" })],
  ])("keeps probing when %s cannot reach the backend", (_, event) => {
    expect(step(resolving, event)).toEqual({
      phase: { _tag: "Unreachable", identity, backend, since: NOW },
      command: { _tag: "Probe", backend, since: NOW },
    })
  })
})

describe("unreachable", () => {
  it("resolves again once the backend answers", () => {
    expect(step(unreachable, { _tag: "Retry" })).toEqual({ phase: resolving, command: { _tag: "Point", identity } })
  })

  it("reconnects Cloudflare when asked", () => {
    expect(step(unreachable, { _tag: "ConnectCloudflare" })).toEqual({ phase: installing, command: null })
  })

  it("purges and needs a backend once the owner forgets it", () => {
    expect(step(unreachable, { _tag: "Detached" })).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason: "detached", previous: backend },
      command: { _tag: "Purge" },
    })
  })
})

describe("needs a backend", () => {
  it("authorizes Cloudflare when the owner connects it", () => {
    expect(step(needsBackend, { _tag: "ConnectCloudflare" })).toEqual({ phase: installing, command: null })
  })

  it("purges and stays detached once the owner forgets the backend", () => {
    const legacy: Phase = { _tag: "NeedsBackend", identity, reason: "legacy", previous: backend }
    expect(step(legacy, { _tag: "Detached" })).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason: "detached", previous: backend },
      command: { _tag: "Purge" },
    })
  })
})

describe("installing", () => {
  it.each<readonly [string, InstallPhase]>([
    ["choose_account", { _tag: "ChooseAccount", accounts: [{ id: "a1", name: "Alice" }] }],
    ["decide", { _tag: "Decide", found: { script: "kiko", owner: { _tag: "Unknown" }, keepable: true } }],
    ["a failure", { _tag: "Failed", code: "busy", message: "Cloudflare is busy.", retry: "same" }],
  ])("shows %s from the installer", (_, install) => {
    expect(step(installing, { _tag: "Install", install })).toEqual({
      phase: { _tag: "Installing", identity, install },
      command: null,
    })
  })

  it("resolves the new backend once the install is done", () => {
    expect(step(installing, { _tag: "Installed" })).toEqual({ phase: resolving, command: { _tag: "Point", identity } })
  })
})

describe("ready", () => {
  it("re-exchanges with a fresh Clerk token when the socket is refused", () => {
    expect(step(ready, { _tag: "Rejected" })).toEqual({
      phase: ready,
      command: { _tag: "Exchange", backend, fresh: true },
    })
  })

  it("adopts and saves the renewed token", () => {
    expect(step(ready, exchanged({ _tag: "Ok", ...fresh }, true))).toEqual({
      phase: readyOf({ ...record, ...fresh }),
      command: { _tag: "Save", record: { ...record, ...fresh } },
    })
  })

  it.each([
    ["not_owner", { _tag: "NotOwner" }],
    ["legacy", { _tag: "Invalid" }],
    ["legacy", { _tag: "Expired" }],
  ] as const)("purges and needs a backend (%s) when the re-exchange is refused", (reason, result) => {
    expect(step(ready, exchanged(result, true))).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason, previous: backend },
      command: { _tag: "Purge" },
    })
  })

  it("probes when the re-exchange cannot reach the backend", () => {
    expect(step(ready, exchanged({ _tag: "Unreachable" }, true))).toEqual({
      phase: { _tag: "Unreachable", identity, backend, since: NOW },
      command: { _tag: "Probe", backend, since: NOW },
    })
  })

  it("ignores an exchange for a backend it no longer uses", () => {
    expect(step(ready, { _tag: "Exchanged", backend: elsewhere, fresh: true, result: { _tag: "NotOwner" } })).toEqual({
      phase: ready,
      command: null,
    })
  })

  it("signs an access-code session out when its token is refused", () => {
    expect(step(readyOf(codeRecord), { _tag: "Rejected" })).toEqual({ phase: signingOut, command: { _tag: "Reset" } })
  })

  it("purges and needs a backend when the pointer is gone after user.reload()", () => {
    expect(step(ready, { _tag: "Pointed", backend: null })).toEqual({
      phase: { _tag: "NeedsBackend", identity, reason: "detached", previous: backend },
      command: { _tag: "Purge" },
    })
  })

  it("starts over when the pointer moved to another backend", () => {
    expect(step(ready, { _tag: "Pointed", backend: elsewhere })).toEqual({
      phase: signingOut,
      command: { _tag: "Reset" },
    })
    expect(step(ready, { _tag: "Pointed", backend })).toEqual({ phase: ready, command: null })
  })

  it("checks the pointer again after a reconnect", () => {
    expect(step(ready, { _tag: "Installed" })).toEqual({ phase: ready, command: { _tag: "Verify", identity } })
  })

  it("tracks the backend update", () => {
    const update = { _tag: "Updating", to: "2.0.0", stage: "uploading", compatible: true } as const
    expect(step(ready, { _tag: "Update", update })).toEqual({ phase: { ...ready, update }, command: null })
  })
})

describe("any phase", () => {
  it.each([booting, signedOut, stillSignedIn, resolving, needsBackend, installing, unreachable, ready])(
    "signs out from $_tag",
    (phase) => {
      expect(step(phase, { _tag: "SignOut" })).toEqual({ phase: signingOut, command: { _tag: "SignOut" } })
    },
  )

  it.each<readonly [string, Event]>([
    ["sign-out", { _tag: "SignOut" }],
    ["Clerk session", clerk(bob)],
    ["stored sign-in", { _tag: "Stored", record: null }],
  ])("ignores a %s while signing out", (_, event) => {
    expect(step(signingOut, event)).toEqual({ phase: signingOut, command: null })
  })

  it.each<readonly [string, Phase]>([
    ["resolving", resolving],
    ["needing a backend", needsBackend],
    ["installing", installing],
    ["unreachable", unreachable],
  ])("starts over when another Clerk user signs in while %s", (_, phase) => {
    expect(step(phase, clerk(bob))).toEqual({ phase: signingOut, command: { _tag: "Reset" } })
  })

  it("shows the sign-in form when Clerk signs out while resolving", () => {
    expect(step(resolving, clerk(null))).toEqual({ phase: signedOut, command: null })
  })

  it.each<readonly [string, Phase, AuthRecord | null]>([
    ["signs out", ready, null],
    ["switches backend", ready, { ...record, backend: elsewhere }],
    ["signs in", signedOut, record],
    ["signs in while this tab resolves", resolving, record],
  ])("reloads when another tab %s", (_, phase, stored) => {
    expect(step(phase, { _tag: "Stored", record: stored })).toEqual({ phase, command: { _tag: "Reload" } })
  })

  it("adopts a token another tab renewed without a reload", () => {
    const renewed = { ...record, token: fresh.token }
    expect(step(ready, { _tag: "Stored", record: renewed })).toEqual({ phase: readyOf(renewed), command: null })
    expect(step(ready, { _tag: "Stored", record })).toEqual({ phase: ready, command: null })
  })
})
