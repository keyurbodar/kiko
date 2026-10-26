import { afterEach, describe, expect, it, vi } from "@effect/vitest"
import { type AuthEnv, authRoute } from "./auth"

const ORIGIN = "http://localhost:5173"

async function clerkKey() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair
  const spki = Buffer.from((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer).toString("base64")
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----`
  const sign = async (claims: Record<string, unknown>) => {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
    const unsigned = `${part({ alg: "RS256" })}.${part(claims)}`
    const mac = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(unsigned))
    return `${unsigned}.${Buffer.from(mac).toString("base64url")}`
  }
  return { pem, sign }
}

const exchange = async (env: AuthEnv, token: string) => {
  const response = await authRoute(
    new Request("http://kiko.test/api/auth/clerk", { method: "POST", body: JSON.stringify({ token }) }),
    env,
  )
  return { status: response?.status, body: (await response?.json()) as Record<string, unknown> }
}

const NOW_S = Date.UTC(2026, 9, 24) / 1000

describe("POST /api/auth/clerk", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it("issues a session to the owner and names every refusal with a code and today's message", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.useFakeTimers({ now: NOW_S * 1000 })
    const key = await clerkKey()
    const otherInstance = await clerkKey()
    const env: AuthEnv = { SESSION_SECRET: "s", OWNER_ID: "user_a", CLERK_JWT_KEY: key.pem, TRUSTED_ORIGINS: ORIGIN }
    const claims = { sub: "user_a", azp: ORIGIN, exp: NOW_S + 60 }

    const signedIn = await exchange(env, await key.sign(claims))
    expect(signedIn.status).toBe(200)
    expect(signedIn.body).toMatchObject({ user: { id: "owner" }, token: expect.stringMatching(/^owner\.session\./) })

    const refusals = await Promise.all([
      exchange(env, await key.sign({ ...claims, exp: NOW_S - 60 })),
      exchange(env, await key.sign({ ...claims, nbf: NOW_S + 60 })),
      exchange(env, await otherInstance.sign(claims)),
      exchange(env, await key.sign({ ...claims, azp: "https://kiko-app.keyurbodar16.workers.dev" })),
      exchange(env, await key.sign({ ...claims, sub: "user_b" })),
    ])
    expect(refusals).toEqual([
      { status: 401, body: { code: "token_expired", message: "That token has expired" } },
      { status: 401, body: { code: "token_expired", message: "That token is not valid yet" } },
      { status: 401, body: { code: "token_invalid", message: "That token is not valid" } },
      {
        status: 401,
        body: { code: "origin_untrusted", message: "That token is from an origin this backend does not trust" },
      },
      { status: 403, body: { code: "not_owner", message: "This backend belongs to someone else" } },
    ])
  })

  it("verifies against the key shipped in the release and ignores an env copy outside development", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.useFakeTimers({ now: NOW_S * 1000 })
    const key = await clerkKey()
    const env: AuthEnv = { SESSION_SECRET: "s", OWNER_ID: "user_a", CLERK_JWT_KEY: key.pem, TRUSTED_ORIGINS: ORIGIN }
    const refused = await exchange(env, await key.sign({ sub: "user_a", azp: ORIGIN, exp: NOW_S + 60 }))
    expect(refused).toEqual({ status: 401, body: { code: "token_invalid", message: "That token is not valid" } })
  })

  it("is not served by a backend that has no owner", async () => {
    const response = await authRoute(new Request("http://kiko.test/api/auth/clerk", { method: "POST", body: "{}" }), {
      SESSION_SECRET: "s",
    })
    expect(response).toBeNull()
  })
})
