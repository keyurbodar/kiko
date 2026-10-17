import { beforeEach, describe, expect, test } from "bun:test"
import { authorizeUrl, challengeOf, connect, failureOf, install, loadOAuthConfig, loadTokenLink, oauthGrant, type Fetch } from "./connect-flow"

const store = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
})
beforeEach(() => store.clear())

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe("pkce", () => {
  test("the challenge is base64url of the SHA-256 of the verifier, unpadded (RFC 7636 appendix B)", async () => {
    expect(await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })
  test("the authorize url carries every parameter", () => {
    const url = new URL(authorizeUrl({ clientId: "cid", authorizeUrl: "https://x.test/auth", scopes: ["a", "b"] }, { challenge: "ch", state: "st" }, "https://app.test/connect/callback"))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      redirect_uri: "https://app.test/connect/callback",
      response_type: "code",
      scope: "a b",
      code_challenge: "ch",
      code_challenge_method: "S256",
      state: "st",
    })
  })
})

describe("callback", () => {
  const pending = { verifier: "v", state: "good" }
  test("a mismatched state is rejected and gives no grant", () => {
    expect("error" in oauthGrant("?code=c&state=evil", pending, "u")).toBe(true)
  })
  test("a missing pending record is rejected", () => {
    expect("error" in oauthGrant("?code=c&state=good", null, "u")).toBe(true)
  })
  test("a matching state yields the oauth grant", () => {
    expect(oauthGrant("?code=c&state=good", pending, "https://a/connect/callback")).toEqual({ grant: { kind: "oauth", code: "c", verifier: "v", redirectUri: "https://a/connect/callback" } })
  })
  test("a denied consent carries the reason", () => {
    expect(oauthGrant("?error=access_denied", pending, "u")).toMatchObject({ error: { code: "oauth_denied" } })
  })
})

describe("errors", () => {
  test("each installer code maps to a sentence and at most one link", () => {
    expect(failureOf({ code: "r2_disabled", message: "x" }).link?.href).toContain("r2")
    expect(failureOf({ code: "no_subdomain", message: "x" }).link?.href).toContain("workers")
    expect(failureOf({ code: "oauth_failed", message: "Cloudflare said no." })).toEqual({ message: "Cloudflare said no." })
    expect(failureOf({ code: "not_ready", message: "Still starting." }).link).toBeUndefined()
  })
  test("install returns the installer's error shape", async () => {
    const f: Fetch = async () => json({ error: { code: "r2_disabled", message: "m" } }, 400)
    expect(await install("t", { kind: "token", token: "k" }, f)).toEqual({ ok: false, error: { code: "r2_disabled", message: "m" } })
  })
  test("a network failure is an error, not a throw", async () => {
    const f: Fetch = async () => {
      throw new Error("offline")
    }
    expect(await install("t", { kind: "token", token: "k" }, f)).toMatchObject({ ok: false, error: { code: "network" } })
  })
})

describe("connect", () => {
  test("posts the clerk token and grant, and stores the backend before the exchange", async () => {
    let body: unknown
    const f: Fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return json({ backendUrl: "https://kiko-abc.me.workers.dev", version: "1" })
    }
    let seen: string | null = "unset"
    const error = await connect("clerk", { kind: "token", token: "k" }, async () => void (seen = localStorage.getItem("kiko:backend")), f)
    expect(error).toBeNull()
    expect(body).toEqual({ clerkToken: "clerk", grant: { kind: "token", token: "k" } })
    expect(seen).toBe("https://kiko-abc.me.workers.dev")
  })
  test("a failed install stores nothing and skips the exchange", async () => {
    let exchanged = false
    const error = await connect("c", { kind: "token", token: "k" }, async () => void (exchanged = true), async () => json({ error: { code: "not_ready", message: "m" } }, 502))
    expect(error?.code).toBe("not_ready")
    expect(exchanged).toBe(false)
    expect(localStorage.getItem("kiko:backend")).toBeNull()
  })
})

describe("installer reads", () => {
  const page: Fetch = async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })
  test("a page instead of JSON, as from a host with no installer, is a plain error", async () => {
    await expect(loadOAuthConfig(page)).rejects.toThrow("Could not reach the installer. Try again.")
    await expect(loadTokenLink(page)).rejects.toThrow("Could not reach the installer. Try again.")
  })
  test("a network failure is the same error", async () => {
    await expect(loadOAuthConfig(async () => Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow("Could not reach the installer. Try again.")
  })
  test("a JSON answer of the right shape passes through", async () => {
    const config = { clientId: "cid", authorizeUrl: "https://dash.cloudflare.com/oauth2/auth", scopes: ["workers-scripts.write"] }
    expect(await loadOAuthConfig(async () => json(config))).toEqual(config)
  })
})
