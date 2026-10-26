import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import handler, { type Env } from "./handler"
import type { InstallRequest } from "./install"

const ORIGIN = "https://app.test"
const NOW_S = Date.UTC(2026, 9, 24, 12) / 1000
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

async function clerkKeys() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair
  const spki = Buffer.from((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer).toString("base64")
  const sign = async (claims: Record<string, unknown>) => {
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}`
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(unsigned))
    return `${unsigned}.${Buffer.from(signature).toString("base64url")}`
  }
  return { pem: `-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----`, sign }
}

function envWith(pem: string) {
  const installs: InstallRequest[] = []
  const detached: string[] = []
  const env = {
    CLERK_JWT_KEY: pem,
    TRUSTED_ORIGINS: ORIGIN,
    CF_OAUTH_CLIENT_ID: "client",
    CLERK_SECRET_KEY: "sk_test",
    RELEASE_BASE_URL: "https://releases.test",
    RELEASE_PUBLIC_KEY: "key",
    INSTALLER: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get: () => ({
        install: async (request: InstallRequest) => {
          installs.push(request)
          return { status: 200, body: { backendUrl: "https://kiko.owner.workers.dev", version: "2.0.0" } }
        },
        detach: async (sub: string) => {
          detached.push(sub)
          return { status: 204, body: null }
        },
      }),
    },
  } satisfies Env
  return { env, installs, detached }
}

const post = (env: Env, path: string, body: unknown) =>
  handler.fetch(
    new Request(`https://api.test${path}`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  )

describe("installer routes", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW_S * 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("passes a verified caller and its decision to that caller's installer", async () => {
    const keys = await clerkKeys()
    const { env, installs } = envWith(keys.pem)
    const clerkToken = await keys.sign({ sub: "user_a", azp: ORIGIN, exp: NOW_S + 60, nbf: NOW_S - 5 })
    const grant = { kind: "token", token: "Bearer api-token" }
    const response = await post(env, "/install", { clerkToken, grant, decision: "take_over" })
    expect(response.status).toBe(200)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN)
    expect(installs).toEqual([{ sub: "user_a", grant: { kind: "token", token: "api-token" }, decision: "take_over" }])
  })

  it("answers an expired sign-in with a same-grant retry and a forged one as unauthorized", async () => {
    const keys = await clerkKeys()
    const forger = await clerkKeys()
    const { env, installs } = envWith(keys.pem)
    const grant = { kind: "token", token: "api-token" }
    const expired = await post(env, "/install", {
      clerkToken: await keys.sign({ sub: "user_a", azp: ORIGIN, exp: NOW_S - 60, nbf: NOW_S - 120 }),
      grant,
    })
    expect(expired.status).toBe(401)
    expect(await expired.json()).toMatchObject({ error: { code: "clerk_expired", retry: "same" } })
    const forged = await post(env, "/install", {
      clerkToken: await forger.sign({ sub: "user_a", azp: ORIGIN, exp: NOW_S + 60, nbf: NOW_S - 5 }),
      grant,
    })
    expect(await forged.json()).toMatchObject({ error: { code: "unauthorized", retry: "same" } })
    expect(installs).toEqual([])
  })

  it("detaches the verified caller with an empty 204", async () => {
    const keys = await clerkKeys()
    const { env, detached } = envWith(keys.pem)
    const response = await post(env, "/detach", {
      clerkToken: await keys.sign({ sub: "user_b", azp: ORIGIN, exp: NOW_S + 60, nbf: NOW_S - 5 }),
    })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
    expect(detached).toEqual(["user_b"])
  })
})
