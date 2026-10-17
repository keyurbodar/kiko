import { beforeEach, describe, expect, test } from "bun:test"
import { authorizeUrl, challengeOf, connect, failureOf, install, loadOAuthConfig, loadTokenLink, oauthGrant, retryKind, tokenProblem, type Fetch } from "./connect-flow"

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
    for (const code of ["not_ready", "cloudflare_error"]) expect(failureOf({ code, message: "raw" }).link?.href).toContain("workers-and-pages")
    for (const code of ["no_permission", "cannot_create"]) expect(failureOf({ code, message: "raw" }).link?.href).toContain("api-tokens")
    expect(failureOf({ code: "cannot_create", message: "x" }).message).toContain("Workers Admin")
    expect(failureOf({ code: "cloudflare_error", message: "raw cloudflare text" }).message).not.toContain("raw")
    expect(failureOf({ code: "no_account", message: "x" }).link?.href).toContain("sign-up")
    expect(failureOf({ code: "cloudflare_down", message: "x" }).link?.href).toContain("cloudflarestatus")
    expect(failureOf({ code: "busy", message: "x" }).link).toBeUndefined()
    expect(failureOf({ code: "no_subdomain", message: "x" }).link?.href).toContain("workers")
    expect(failureOf({ code: "oauth_failed", message: "x" }).message).toContain("Connect again")
    expect(failureOf({ code: "some_new_code", message: "The installer's own sentence." })).toEqual({ message: "The installer's own sentence." })
  })
  test("Cloudflare's own words ride along under the sentence", () => {
    expect(failureOf({ code: "no_permission", message: "x", detail: "No access to the specified resource. (PUT /accounts/…/workers/scripts/kiko)" }).detail).toContain("No access")
  })
  test("Try again signs in again after an install, starts over after a failed Cloudflare sign-in, and repeats otherwise", () => {
    expect(retryKind({ code: "unreachable", message: "x", installed: true })).toBe("sign-in")
    for (const code of ["oauth_failed", "oauth_denied", "state_mismatch", "busy", "cloudflare_down"]) expect(retryKind({ code, message: "x" }, "oauth")).toBe("new-grant")
    for (const code of ["busy", "cannot_create", "cloudflare_down"]) expect(retryKind({ code, message: "x" }, "token")).toBe("same")
    expect(retryKind({ code: "bad_token", message: "x" }, "token")).toBe("token")
  })

  test("a Global API Key or a token ID is caught before it is sent", () => {
    expect(tokenProblem("0123456789abcdef0123456789abcdef01234")).toContain("Global API Key")
    expect(tokenProblem("0123456789abcdef0123456789abcdef")).toContain("token's ID")
    expect(tokenProblem("Ab3dEf_ghIjkLmn0pQrStuvWxYz0123456789-_A")).toBeNull()
  })
  test("install returns the installer's error shape", async () => {
    const f: Fetch = async () => json({ error: { code: "failed_step", message: "m" } }, 400)
    expect(await install("t", { kind: "token", token: "k" }, f)).toEqual({ ok: false, error: { code: "failed_step", message: "m" } })
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
  test("an install whose sign-in fails keeps the address and says only the sign-in failed", async () => {
    const error = await connect("c", { kind: "token", token: "k" }, async () => {
      throw new Error("This device cannot reach kiko.me.workers.dev yet.")
    }, async () => json({ backendUrl: "https://kiko.me.workers.dev", version: "1" }))
    expect(error).toEqual({ code: "unreachable", message: "This device cannot reach kiko.me.workers.dev yet.", installed: true })
    expect(localStorage.getItem("kiko:backend")).toBe("https://kiko.me.workers.dev")
  })
  test("the installer's account list and Cloudflare detail reach the screen", async () => {
    const f: Fetch = async () => json({ error: { code: "choose_account", message: "m", accounts: [{ id: "a", name: "Mine" }], detail: "d" } }, 409)
    expect(await install("t", { kind: "token", token: "k" }, f, undefined)).toEqual({ ok: false, error: { code: "choose_account", message: "m", accounts: [{ id: "a", name: "Mine" }], detail: "d" } })
  })
  test("a picked account is sent with the grant", async () => {
    let body: unknown
    const f: Fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return json({ backendUrl: "https://kiko.me.workers.dev", version: "1" })
    }
    await connect("c", { kind: "token", token: "k" }, async () => {}, f, "acc2")
    expect(body).toMatchObject({ accountId: "acc2" })
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
