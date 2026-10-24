import { describe, expect, it } from "vitest"
import { backendKey, describeBackend, exchangeToken, type Fetch, sessionOf } from "./backend"
import type { BackendUrl, ClerkUserId } from "./phase"

const URL_A = "https://kiko.alice.workers.dev" as BackendUrl

const answering =
  (status: number, body: unknown): Fetch =>
  async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status })

const offline: Fetch = async () => {
  throw new TypeError("Failed to fetch")
}

describe("describing a backend", () => {
  it("reads a current backend from /api/version", async () => {
    const seen: string[] = []
    const fetch: Fetch = async (url) => {
      seen.push(String(url))
      return Response.json({ kiko: 1, version: "1.4.0", protocol: 3, selfUpdate: true, rpc: true })
    }
    expect(await describeBackend(URL_A, fetch)).toEqual({
      _tag: "Current",
      version: "1.4.0",
      protocol: 3,
      selfUpdate: true,
    })
    expect(seen).toEqual(["https://kiko.alice.workers.dev/api/version"])
  })

  it.each([
    ["a version without kiko: 1", { version: "0.8.2", rpc: true }, { _tag: "Legacy", version: "0.8.2" }],
    ["no version", { kiko: 1 }, { _tag: "Gone" }],
    ["a body that is not JSON", "<html>nothing here</html>", { _tag: "Gone" }],
  ])("tells %s apart", async (_, body, descriptor) => {
    expect(await describeBackend(URL_A, answering(200, body))).toEqual(descriptor)
  })

  it.each([404, 410])("calls a %i gone", async (status) => {
    expect(await describeBackend(URL_A, answering(status, "not found"))).toEqual({ _tag: "Gone" })
  })

  it.each([
    ["a server error", answering(503, "busy")],
    ["a network failure", offline],
  ])("calls %s unreachable", async (_, fetch) => {
    expect(await describeBackend(URL_A, fetch)).toEqual({ _tag: "Unreachable" })
  })
})

describe("exchanging a Clerk token", () => {
  it("posts the token and returns the session", async () => {
    const seen: { url: string; body: unknown }[] = []
    const fetch: Fetch = async (url, init) => {
      seen.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return Response.json({ token: "owner.session.9.mac", user: { id: "owner", name: "owner" } })
    }
    expect(await exchangeToken(URL_A, "clerk-jwt", fetch)).toEqual({
      _tag: "Ok",
      token: "owner.session.9.mac",
      user: { id: "owner", name: "owner" },
    })
    expect(seen).toEqual([{ url: "https://kiko.alice.workers.dev/api/auth/clerk", body: { token: "clerk-jwt" } }])
  })

  it.each([
    ["an expired token", answering(401, { code: "token_expired", message: "expired" }), "Expired"],
    ["an invalid token", answering(401, { code: "token_invalid", message: "bad" }), "Invalid"],
    ["an untrusted origin", answering(401, { code: "origin_untrusted", message: "origin" }), "Invalid"],
    ["a missing token", answering(400, { code: "token_invalid" }), "Invalid"],
    ["a backend without the route", answering(404, "not found"), "Invalid"],
    ["a session it cannot read", answering(200, { token: 7 }), "Invalid"],
    [
      "another owner",
      answering(403, { code: "not_owner", message: "This backend belongs to someone else" }),
      "NotOwner",
    ],
    ["a server error", answering(502, "bad gateway"), "Unreachable"],
    ["a network failure", offline, "Unreachable"],
  ] as const)("reads %s", async (_, fetch, tag) => {
    expect((await exchangeToken(URL_A, "clerk-jwt", fetch))._tag).toBe(tag)
  })
})

describe("the backend key", () => {
  it("is 16 hex characters that differ by account and by backend", async () => {
    const alice = "user_alice" as ClerkUserId
    const bob = "user_bob" as ClerkUserId
    const other = "https://kiko.other.workers.dev" as BackendUrl
    const key = await backendKey(alice, URL_A)
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(await backendKey(alice, URL_A)).toBe(key)
    expect(
      new Set([key, await backendKey(bob, URL_A), await backendKey(alice, other), await backendKey(null, URL_A)]).size,
    ).toBe(4)
  })
})

describe("a session answer", () => {
  it("reads the token and the user", () => {
    expect(sessionOf({ token: "owner.session.1.mac", user: { id: "owner", name: "owner" }, extra: 1 })).toEqual({
      token: "owner.session.1.mac",
      user: { id: "owner", name: "owner" },
    })
  })

  it.each([
    ["no body", null],
    ["no token", { user: { id: "owner", name: "owner" } }],
    ["no user", { token: "owner.session.1.mac" }],
    ["a user without a name", { token: "owner.session.1.mac", user: { id: "owner" } }],
  ] as const)("rejects %s", (_, body) => {
    expect(sessionOf(body)).toBeNull()
  })
})
