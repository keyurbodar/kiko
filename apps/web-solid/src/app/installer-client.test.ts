import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import { type Grant, type InstallerFailed, makeInstallerClient } from "./installer-client"

type Sent = {
  readonly url: string
  readonly method: string
  readonly contentType: string | null
  readonly body: unknown
}

const BASE = "https://api.kiko.test"
const OAUTH: Grant = {
  kind: "oauth",
  code: "c0de",
  verifier: "v",
  redirectUri: "https://app.kiko.test/connect/callback",
}

function installer(reply: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = []
  const client = makeInstallerClient({
    baseUrl: BASE,
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const entry = {
        url: request.url,
        method: request.method,
        contentType: request.headers.get("content-type"),
        body: request.method === "POST" ? await request.json() : null,
      }
      sent.push(entry)
      return reply(entry)
    },
  })
  return { client, sent }
}

const problem = (status: number, error: Record<string, unknown>) => Response.json({ error }, { status })

const failureOf = <A>(effect: Effect.Effect<A, InstallerFailed>) => Effect.runPromise(Effect.flip(effect))

const INSTALLER_RETRY = [
  ["bad_request", "same", 400],
  ["unauthorized", "same", 401],
  ["clerk_expired", "same", 401],
  ["grant_invalid", "new-grant", 400],
  ["bad_token", "token", 400],
  ["no_permission", "new-grant", 403],
  ["cannot_create", "new-grant", 403],
  ["no_account", "same", 400],
  ["no_subdomain", "same", 409],
  ["name_taken", "same", 409],
  ["not_keepable", "same", 409],
  ["busy", "same", 502],
  ["cloudflare_down", "same", 502],
  ["cloudflare_error", "same", 502],
  ["storage_full", "same", 503],
  ["release_unavailable", "same", 502],
  ["release_untrusted", "same", 502],
  ["missing_migration_tag", "same", 409],
  ["not_ready", "same", 504],
  ["internal", "same", 500],
] as const

describe("installer client", () => {
  it("posts exactly the install contract and reads the installed backend", async () => {
    const { client, sent } = installer(() =>
      Response.json({ backendUrl: "https://kiko.owner.workers.dev", version: "2.0.0" }),
    )

    const answer = await Effect.runPromise(
      client.install({ clerkToken: "clerk-1", grant: OAUTH, accountId: "acc-2", decision: "take_over" }),
    )

    expect(answer).toEqual({ _tag: "Installed", backendUrl: "https://kiko.owner.workers.dev", version: "2.0.0" })
    expect(sent).toEqual([
      {
        url: `${BASE}/install`,
        method: "POST",
        contentType: "application/json",
        body: { clerkToken: "clerk-1", grant: OAUTH, accountId: "acc-2", decision: "take_over" },
      },
    ])
  })

  it("leaves out an account and a decision the owner has not given", async () => {
    const { client, sent } = installer(() =>
      Response.json({ backendUrl: "https://kiko.a.workers.dev", version: "2.0.0" }),
    )

    await Effect.runPromise(client.install({ clerkToken: "clerk-1", grant: { kind: "token", token: "cf-token" } }))

    expect(sent[0]?.body).toEqual({ clerkToken: "clerk-1", grant: { kind: "token", token: "cf-token" } })
  })

  it("reads choose_account as the accounts to pick from", async () => {
    const accounts = [
      { id: "acc-1", name: "Personal" },
      { id: "acc-2", name: "Team" },
    ]
    const { client } = installer(() =>
      problem(409, { code: "choose_account", retry: "same", message: "Pick the one Kiko goes in.", accounts }),
    )

    expect(await Effect.runPromise(client.install({ clerkToken: "c", grant: OAUTH }))).toEqual({
      _tag: "ChooseAccount",
      accounts,
    })
  })

  it("reads decide as the backend it found, with its owner and whether its chats can be kept", async () => {
    const other = { script: "kiko", owner: { _tag: "Other", hint: "k•••@gmail.com" }, keepable: true }
    const unknown = { script: "kiko-47ed", owner: { _tag: "Unknown" }, keepable: false }
    const answers = [other, unknown]
    const { client } = installer(() =>
      problem(409, { code: "decide", retry: "same", message: "Choose.", found: answers.shift() }),
    )

    expect(await Effect.runPromise(client.install({ clerkToken: "c", grant: OAUTH }))).toEqual({
      _tag: "Decide",
      found: other,
    })
    expect(await Effect.runPromise(client.install({ clerkToken: "c", grant: OAUTH }))).toEqual({
      _tag: "Decide",
      found: unknown,
    })
  })

  it.each(INSTALLER_RETRY)("fails %s with the retry class %s the installer sends", async (code, retry, status) => {
    const { client } = installer(() =>
      problem(status, { code, retry, message: "Said by the installer.", detail: "Cloudflare: no [10000]" }),
    )

    const failure = await failureOf(client.install({ clerkToken: "c", grant: OAUTH }))

    expect(failure).toMatchObject({
      _tag: "InstallerFailed",
      code,
      retry,
      message: "Said by the installer.",
      detail: "Cloudflare: no [10000]",
    })
  })

  it("keeps a code it does not know as unknown, with the installer's message and retry class", async () => {
    const { client } = installer(() =>
      problem(409, { code: "brand_new", retry: "new-grant", message: "Do the new thing first." }),
    )

    expect(await failureOf(client.install({ clerkToken: "c", grant: OAUTH }))).toMatchObject({
      code: "unknown",
      retry: "new-grant",
      message: "Do the new thing first.",
    })
  })

  it("resends as is when the installer names no retry class", async () => {
    const { client } = installer(() => problem(403, { code: "origin", message: "This origin is not allowed." }))

    expect(await failureOf(client.install({ clerkToken: "c", grant: OAUTH }))).toMatchObject({
      code: "unknown",
      retry: "same",
    })
  })

  it("fails as network, to resend as is, when the installer cannot be reached", async () => {
    const { client } = installer(() => Promise.reject(new TypeError("Failed to fetch")))

    expect(await failureOf(client.install({ clerkToken: "c", grant: OAUTH }))).toMatchObject({
      code: "network",
      retry: "same",
    })
  })

  it.each([
    ["an install answer without an address", () => Response.json({ version: "2.0.0" })],
    ["an error page", () => new Response("<h1>Error 1101</h1>", { status: 502 })],
    ["choose_account without accounts", () => problem(409, { code: "choose_account", retry: "same" })],
    ["decide without what it found", () => problem(409, { code: "decide", retry: "same" })],
  ])("fails as unreadable, to resend as is, on %s", async (_, reply) => {
    const { client } = installer(reply)

    expect(await failureOf(client.install({ clerkToken: "c", grant: OAUTH }))).toMatchObject({
      code: "unreadable",
      retry: "same",
    })
  })

  it("detaches with only the Clerk token and accepts the empty 204", async () => {
    const { client, sent } = installer(() => new Response(null, { status: 204 }))

    await Effect.runPromise(client.detach({ clerkToken: "clerk-9" }))

    expect(sent).toEqual([
      { url: `${BASE}/detach`, method: "POST", contentType: "application/json", body: { clerkToken: "clerk-9" } },
    ])
  })

  it("fails a detach with the installer's code", async () => {
    const { client } = installer(() =>
      problem(401, { code: "clerk_expired", retry: "same", message: "Your Kiko sign-in expired. Try again." }),
    )

    expect(await failureOf(client.detach({ clerkToken: "old" }))).toMatchObject({ code: "clerk_expired" })
  })

  it("reads the Cloudflare sign-in setup and the API token steps", async () => {
    const config = { clientId: "client", authorizeUrl: "https://dash.cloudflare.com/oauth2/auth", scopes: ["a", "b"] }
    const link = {
      url: "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=x",
      permissions: ["Workers"],
    }
    const { client, sent } = installer((request) =>
      Response.json(request.url.endsWith("/oauth/config") ? config : link),
    )

    expect(await Effect.runPromise(client.oauthConfig)).toEqual(config)
    expect(await Effect.runPromise(client.tokenLink)).toEqual(link)
    expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET ${BASE}/oauth/config`,
      `GET ${BASE}/token-link`,
    ])
  })

  it("fails the setup reads as unreadable or network, never with a raw answer", async () => {
    const down = installer(() => new Response("Not found", { status: 404 }))
    const offline = installer(() => Promise.reject(new TypeError("Failed to fetch")))

    expect(await failureOf(down.client.oauthConfig)).toMatchObject({ code: "unreadable" })
    expect(await failureOf(offline.client.tokenLink)).toMatchObject({ code: "network" })
  })
})
