import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import {
  type Attempt,
  anotherAccount,
  ConnectTrouble,
  detachBackend,
  detachSentence,
  headingOf,
  oauthGrant,
  pickAccount,
  type Ports,
  sendAttempt,
  signInFailed,
  startFresh,
  takeOver,
  type Trouble,
  type View,
  viewOfAnswer,
  viewOfTrouble,
} from "./connect-flow"
import {
  type Found,
  type Grant,
  type InstallerClient,
  InstallerFailed,
  type InstallRequest,
  type Retry,
} from "./installer-client"

const OAUTH: Grant = {
  kind: "oauth",
  code: "c0de",
  verifier: "v",
  redirectUri: "https://app.kiko.test/connect/callback",
}
const TOKEN: Grant = { kind: "token", token: "cf-token" }
const ACCOUNTS = [
  { id: "acc-1", name: "Personal" },
  { id: "acc-2", name: "Team" },
]
const KEEPABLE: Found = { script: "kiko", owner: { _tag: "Other", hint: "k•••@gmail.com" }, keepable: true }
const TOO_OLD: Found = { script: "kiko-47ed", owner: { _tag: "Unknown" }, keepable: false }

const failed = (code: InstallerFailed["code"], retry: Retry, detail?: string) =>
  new InstallerFailed({ code, retry, message: "Said by the installer.", ...(detail ? { detail } : {}) })

type Outcome = "Resend" | "Reconnect" | "PasteCleared" | "PasteKept" | "SignInAgain"

function outcomeOf(view: View, attempt: Attempt): Outcome | View {
  if (view._tag === "Start" && view.paste) return view.paste.keep ? "PasteKept" : "PasteCleared"
  if (view._tag !== "Failed") return view
  const { fix } = view.failure
  if (fix._tag === "Resend") return fix.attempt === attempt ? "Resend" : view
  return fix._tag === "Reconnect" || fix._tag === "SignInAgain" ? fix._tag : view
}

const sentenceOf = (view: View) => {
  if (view._tag === "Failed") return view.failure.sentence
  if (view._tag === "Start" && view.paste) return view.paste.note
  throw new Error(`no sentence on ${view._tag}`)
}

const EVERY_CODE = [
  ["bad_request", "same", "Resend", "Resend"],
  ["unauthorized", "same", "Resend", "Resend"],
  ["clerk_expired", "same", "Resend", "Resend"],
  ["grant_invalid", "new-grant", "Reconnect", "PasteCleared"],
  ["bad_token", "token", "Reconnect", "PasteCleared"],
  ["no_permission", "new-grant", "Reconnect", "PasteKept"],
  ["cannot_create", "new-grant", "Reconnect", "PasteKept"],
  ["no_account", "same", "Resend", "Resend"],
  ["no_subdomain", "same", "Resend", "Resend"],
  ["name_taken", "same", "Resend", "Resend"],
  ["not_keepable", "same", "Resend", "Resend"],
  ["busy", "same", "Resend", "Resend"],
  ["cloudflare_down", "same", "Resend", "Resend"],
  ["cloudflare_error", "same", "Resend", "Resend"],
  ["storage_full", "same", "Resend", "Resend"],
  ["release_unavailable", "same", "Resend", "Resend"],
  ["release_untrusted", "same", "Resend", "Resend"],
  ["missing_migration_tag", "same", "Resend", "Resend"],
  ["not_ready", "same", "Resend", "Resend"],
  ["internal", "same", "Resend", "Resend"],
  ["network", "same", "Resend", "Resend"],
  ["unreadable", "same", "Resend", "Resend"],
] as const

function fakeInstaller(fail?: InstallerFailed) {
  const installs: InstallRequest[] = []
  const detaches: string[] = []
  const client: InstallerClient = {
    oauthConfig: Effect.die("unused"),
    tokenLink: Effect.die("unused"),
    install: (request) => {
      installs.push(request)
      return fail ? Effect.fail(fail) : Effect.succeed({ _tag: "Installed", backendUrl: "https://k.dev", version: "2" })
    },
    detach: (request) => {
      detaches.push(request.clerkToken)
      return fail ? Effect.fail(fail) : Effect.void
    },
  }
  return { client, installs, detaches }
}

const tokens = (...values: Array<string | null>): Ports["clerkToken"] => {
  const queue = [...values]
  return async () => queue.shift() ?? null
}

const troubleOf = <A>(effect: Effect.Effect<A, Trouble>) => Effect.runPromise(Effect.flip(effect))

describe("a failed install", () => {
  it.each(EVERY_CODE)(
    "%s (retry %s) leads to %s after a Cloudflare sign-in and %s after an API token",
    (code, retry, afterOAuth, afterToken) => {
      const oauth: Attempt = { grant: OAUTH, accountId: "acc-2" }
      const token: Attempt = { grant: TOKEN }

      expect(outcomeOf(viewOfTrouble(failed(code, retry), oauth), oauth)).toBe(afterOAuth)
      expect(outcomeOf(viewOfTrouble(failed(code, retry), token), token)).toBe(afterToken)
    },
  )

  it.each(EVERY_CODE)("%s has its own sentence, and mentions a token only to someone who pasted one", (code, retry) => {
    const afterOAuth = sentenceOf(viewOfTrouble(failed(code, retry), { grant: OAUTH }))
    const afterToken = sentenceOf(viewOfTrouble(failed(code, retry), { grant: TOKEN }))

    expect(afterOAuth).not.toBe("Said by the installer.")
    expect(afterOAuth).toMatch(/^[A-Z].{20,}\.$/)
    expect(afterOAuth).not.toMatch(/\btoken\b/i)
    expect(afterToken).toMatch(/^[A-Z].{20,}\.$/)
  })

  it("shows the installer's own sentence for a code this page does not know, and a plain one when it is blank", () => {
    const known = viewOfTrouble(
      new InstallerFailed({ code: "unknown", retry: "same", message: "Do the new thing first." }),
      { grant: OAUTH },
    )
    const blank = viewOfTrouble(new InstallerFailed({ code: "unknown", retry: "same", message: " " }), {
      grant: OAUTH,
    })

    expect(sentenceOf(known)).toBe("Do the new thing first.")
    expect(sentenceOf(blank)).toBe("The install did not finish. Try again.")
  })

  it("follows the class an unknown code arrives with", () => {
    const attempt: Attempt = { grant: OAUTH }
    const unknown = new InstallerFailed({ code: "unknown", retry: "new-grant", message: "Connect again." })

    expect(outcomeOf(viewOfTrouble(unknown, attempt), attempt)).toBe("Reconnect")
  })

  it("shows what Cloudflare said only when it was Cloudflare that said it", () => {
    const fromCloudflare = viewOfTrouble(failed("cloudflare_error", "same", "Workers subdomain not set [10063]"), {
      grant: OAUTH,
    })
    const fromInstaller = viewOfTrouble(failed("internal", "same", "TypeError: undefined is not a function"), {
      grant: OAUTH,
    })

    expect(fromCloudflare._tag === "Failed" && fromCloudflare.failure.detail).toBe("Workers subdomain not set [10063]")
    expect(fromInstaller._tag === "Failed" && fromInstaller.failure.detail).toBeUndefined()
  })

  it("returns to the choice without Keep chats when a take-over finds the backend too old", () => {
    const attempt: Attempt = {
      grant: OAUTH,
      accountId: "acc-2",
      accounts: ACCOUNTS,
      found: KEEPABLE,
      decision: "take_over",
    }

    const view = viewOfTrouble(failed("not_keepable", "same"), attempt)

    expect(view).toEqual({
      _tag: "Decide",
      attempt: { grant: OAUTH, accountId: "acc-2", accounts: ACCOUNTS },
      found: { ...KEEPABLE, keepable: false },
      note: expect.stringMatching(/too old to keep its chats/),
    })
  })

  it("says to remove a backend it cannot update when there was no choice to go back to", () => {
    const view = viewOfTrouble(failed("not_keepable", "same"), { grant: OAUTH })

    expect(view._tag === "Failed" && view.failure.link?.href).toMatch(/dash\.cloudflare\.com/)
    expect(sentenceOf(view)).toMatch(/Delete it in Cloudflare/)
  })

  it.each([
    ["oauth_denied", null, "Reconnect"],
    ["state_mismatch", null, "Reconnect"],
    ["signed_out", { grant: OAUTH }, "SignInAgain"],
    ["clerk_unreachable", { grant: OAUTH }, "Resend"],
  ] as const)("%s leads to %s", (code, attempt, outcome) => {
    const view = viewOfTrouble(new ConnectTrouble({ code }), attempt)

    expect(outcomeOf(view, attempt ?? { grant: OAUTH })).toBe(outcome)
    expect(sentenceOf(view)).toMatch(/^[A-Z].{20,}\.$/)
  })

  it("retries only the backend sign-in when it fails after the install, with its own sentence", () => {
    const view = signInFailed(new Error("This device cannot reach kiko.a.workers.dev yet. Try again in a minute."))

    expect(view).toEqual({
      _tag: "Failed",
      failure: {
        sentence: "This device cannot reach kiko.a.workers.dev yet. Try again in a minute.",
        fix: { _tag: "FinishSignIn" },
      },
    })
    expect(sentenceOf(signInFailed("lost"))).toMatch(/^Kiko is installed/)
  })
})

describe("choosing where Kiko goes", () => {
  it("picks an account with the same Cloudflare code, and remembers the list it came from", () => {
    const view = viewOfAnswer({ _tag: "ChooseAccount", accounts: ACCOUNTS }, { grant: OAUTH })

    expect(view).toEqual({ _tag: "ChooseAccount", attempt: { grant: OAUTH }, accounts: ACCOUNTS })
    expect(view._tag === "ChooseAccount" && pickAccount(view, "acc-2")).toEqual({
      grant: OAUTH,
      accountId: "acc-2",
      accounts: ACCOUNTS,
    })
  })

  it("treats an empty account list as no account found", () => {
    const view = viewOfAnswer({ _tag: "ChooseAccount", accounts: [] }, { grant: OAUTH })

    expect(sentenceOf(view)).toMatch(/No Cloudflare account/)
  })

  it("takes over or starts fresh with the same code and account", () => {
    const attempt: Attempt = { grant: OAUTH, accountId: "acc-2", accounts: ACCOUNTS }
    const view = viewOfAnswer({ _tag: "Decide", found: KEEPABLE }, attempt)

    expect(view).toEqual({ _tag: "Decide", attempt, found: KEEPABLE, note: null })
    if (view._tag !== "Decide") throw new Error("expected a decision")
    expect(takeOver(view)).toEqual({ ...attempt, found: KEEPABLE, decision: "take_over" })
    expect(startFresh({ _tag: "ConfirmFresh", attempt, found: KEEPABLE })).toEqual({
      ...attempt,
      found: KEEPABLE,
      decision: "start_fresh",
    })
  })

  it("uses another account from the picker it came from, then a new token, then a new Cloudflare sign-in", () => {
    const decide = (attempt: Attempt): Extract<View, { _tag: "Decide" }> => ({
      _tag: "Decide",
      attempt,
      found: KEEPABLE,
      note: null,
    })

    expect(anotherAccount(decide({ grant: OAUTH, accountId: "acc-2", accounts: ACCOUNTS }))).toEqual({
      _tag: "ChooseAccount",
      attempt: { grant: OAUTH },
      accounts: ACCOUNTS,
    })
    expect(anotherAccount(decide({ grant: TOKEN }))).toEqual({
      _tag: "Start",
      paste: { note: expect.stringMatching(/other Cloudflare account/), keep: false },
    })
    expect(anotherAccount(decide({ grant: OAUTH }))).toBeNull()
  })

  it("names the owner it would sign out, and says when the chats cannot be kept", () => {
    const other = headingOf({ _tag: "Decide", attempt: { grant: OAUTH }, found: KEEPABLE, note: null }, false)
    const old = headingOf({ _tag: "Decide", attempt: { grant: OAUTH }, found: TOO_OLD, note: null }, false)
    const confirm = headingOf({ _tag: "ConfirmFresh", attempt: { grant: OAUTH }, found: TOO_OLD }, false)

    expect(other.lede).toMatch(/k•••@gmail\.com.*signs k•••@gmail\.com out/)
    expect(old.lede).toMatch(/kiko-47ed.*too old to keep its chats/)
    expect(confirm.lede).toMatch(/kiko-47ed.*cannot be undone/)
  })
})

describe("sending an attempt", () => {
  it("asks Clerk for a fresh token on every send and sends only the install contract", async () => {
    const { client, installs } = fakeInstaller()
    const ports: Ports = { client, clerkToken: tokens("clerk-1", "clerk-2") }
    const attempt: Attempt = {
      grant: OAUTH,
      accountId: "acc-2",
      accounts: ACCOUNTS,
      found: KEEPABLE,
      decision: "take_over",
    }

    await Effect.runPromise(sendAttempt(attempt, ports))
    await Effect.runPromise(sendAttempt(attempt, ports))

    expect(installs).toEqual([
      { clerkToken: "clerk-1", grant: OAUTH, accountId: "acc-2", decision: "take_over" },
      { clerkToken: "clerk-2", grant: OAUTH, accountId: "acc-2", decision: "take_over" },
    ])
  })

  it("stops before the installer when the Kiko sign-in has ended or Clerk cannot be reached", async () => {
    const { client, installs } = fakeInstaller()

    expect(await troubleOf(sendAttempt({ grant: OAUTH }, { client, clerkToken: tokens(null) }))).toMatchObject({
      code: "signed_out",
    })
    expect(
      await troubleOf(
        sendAttempt({ grant: OAUTH }, { client, clerkToken: () => Promise.reject(new Error("clerk down")) }),
      ),
    ).toMatchObject({ code: "clerk_unreachable" })
    expect(installs).toEqual([])
  })

  it("passes the installer's failure through as the trouble to show", async () => {
    const { client } = fakeInstaller(failed("busy", "same"))

    expect(await troubleOf(sendAttempt({ grant: OAUTH }, { client, clerkToken: tokens("c") }))).toMatchObject({
      _tag: "InstallerFailed",
      code: "busy",
    })
  })
})

describe("disconnecting the backend", () => {
  it("detaches with a fresh Clerk token", async () => {
    const { client, detaches } = fakeInstaller()

    await Effect.runPromise(detachBackend({ client, clerkToken: tokens("clerk-7") }))

    expect(detaches).toEqual(["clerk-7"])
  })

  it.each([
    [failed("network", "same"), /Could not reach the Kiko installer/],
    [failed("clerk_expired", "same"), /could not confirm your Kiko sign-in/],
    [failed("unauthorized", "same"), /could not confirm your Kiko sign-in/],
    [new ConnectTrouble({ code: "signed_out" }), /sign-in ended/],
    [new ConnectTrouble({ code: "clerk_unreachable" }), /sign-in service/],
    [failed("internal", "same"), /could not disconnect the backend/],
    [new InstallerFailed({ code: "unknown", retry: "same", message: "x" }), /could not disconnect the backend/],
  ])("explains %o in a sentence that ends in what to do", (trouble, sentence) => {
    expect(detachSentence(trouble)).toMatch(sentence)
    expect(detachSentence(trouble)).toMatch(/\.$/)
  })
})

describe("the Cloudflare callback", () => {
  const pending = { verifier: "v", state: "s" }
  const uri = "https://app.kiko.test/connect/callback"

  it("turns the code into a grant when the state matches", () => {
    expect(oauthGrant("?code=c0de&state=s", pending, uri)).toEqual({
      grant: { kind: "oauth", code: "c0de", verifier: "v", redirectUri: uri },
    })
  })

  it("reads a cancelled sign-in and a stale link as troubles that connect again", () => {
    const denied = oauthGrant("?error=access_denied", pending, uri)
    const stale = oauthGrant("?code=c0de&state=other", pending, uri)
    const lost = oauthGrant("?code=c0de&state=s", null, uri)

    expect("trouble" in denied && denied.trouble.code).toBe("oauth_denied")
    expect("trouble" in stale && stale.trouble.code).toBe("state_mismatch")
    expect("trouble" in lost && lost.trouble.code).toBe("state_mismatch")
  })
})
