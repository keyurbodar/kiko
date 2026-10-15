import { beforeAll, describe, expect, test } from "bun:test"
import { authRoute, verifyToken } from "../src/auth/auth"

// The Clerk token exchange, with a key pair made here. The route runs without a Worker: it is plain WebCrypto.
const SECRET = "test-secret-that-is-at-least-32-characters-long"
const OWNER = "user_owner"
const PAGE = "https://app.example.test"
const NOW = 1_800_000_000

let pem: string
let signer: CryptoKey
let otherSigner: CryptoKey

const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url")
const part = (value: object) => b64(new TextEncoder().encode(JSON.stringify(value)))

async function pair() {
  return crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as Promise<CryptoKeyPair>
}

async function mint(claims: Record<string, unknown>, key = signer, header: object = { alg: "RS256", typ: "JWT" }) {
  const body = `${part(header)}.${part({ sub: OWNER, exp: NOW + 60, nbf: NOW - 10, ...claims })}`
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body))
  return `${body}.${b64(sig)}`
}

const env = () => ({ SESSION_SECRET: SECRET, CLERK_JWT_KEY: pem, OWNER_ID: OWNER, TRUSTED_ORIGINS: PAGE })

function exchange(token: unknown, e: Record<string, string | undefined> = env()) {
  const request = new Request("https://kiko.test/api/auth/clerk", { method: "POST", body: JSON.stringify({ token }) })
  return authRoute(request, e as never)
}

beforeAll(async () => {
  const keys = await pair()
  signer = keys.privateKey
  otherSigner = (await pair()).privateKey
  const spki = await crypto.subtle.exportKey("spki", keys.publicKey)
  pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(spki).toString("base64").match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`
  Date.now = () => NOW * 1000
})

describe("POST /api/auth/clerk", () => {
  test("a valid token for the owner gets a session token", async () => {
    const res = await exchange(await mint({ azp: PAGE }))
    expect(res?.status).toBe(200)
    const { user, token } = (await res?.json()) as { user: { id: string }; token: string }
    expect(user.id).toBe("owner")
    expect((await verifyToken(SECRET, token, "session"))?.id).toBe("owner")
  })

  test("a token with no azp is accepted", async () => {
    expect((await exchange(await mint({})))?.status).toBe(200)
  })

  test("an expired token is 401, and 5 seconds of skew is allowed", async () => {
    expect((await exchange(await mint({ exp: NOW - 6 })))?.status).toBe(401)
    expect((await exchange(await mint({ exp: NOW - 4 })))?.status).toBe(200)
  })

  test("a token that is not valid yet is 401, and 5 seconds of skew is allowed", async () => {
    expect((await exchange(await mint({ nbf: NOW + 6 })))?.status).toBe(401)
    expect((await exchange(await mint({ nbf: NOW + 4 })))?.status).toBe(200)
  })

  test("another user's token is 403", async () => {
    const res = await exchange(await mint({ sub: "user_someone_else" }))
    expect(res?.status).toBe(403)
  })

  test("an azp that is not trusted is 401", async () => {
    expect((await exchange(await mint({ azp: "https://evil.example.test" })))?.status).toBe(401)
  })

  test("a token signed with another key is 401", async () => {
    expect((await exchange(await mint({}, otherSigner)))?.status).toBe(401)
  })

  test("a tampered payload is 401", async () => {
    const [head, , sig] = (await mint({})).split(".")
    const forged = `${head}.${part({ sub: OWNER, exp: NOW + 99999 })}.${sig}`
    expect((await exchange(forged))?.status).toBe(401)
  })

  test("alg none and a non-token are 401", async () => {
    expect((await exchange(`${part({ alg: "none" })}.${part({ sub: OWNER, exp: NOW + 60 })}.`))?.status).toBe(401)
    expect((await exchange(await mint({}, signer, { alg: "HS256" })))?.status).toBe(401)
    expect((await exchange("not-a-token"))?.status).toBe(401)
  })

  test("a missing token is 400", async () => {
    expect((await exchange(undefined))?.status).toBe(400)
  })

  test("the route does not exist without CLERK_JWT_KEY or OWNER_ID", async () => {
    const token = await mint({})
    expect(await exchange(token, { ...env(), CLERK_JWT_KEY: undefined })).toBeNull()
    expect(await exchange(token, { ...env(), OWNER_ID: undefined })).toBeNull()
  })
})
