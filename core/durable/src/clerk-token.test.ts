import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { type ClerkTrust, verifyClerkToken } from "./clerk-token"

const NOW_MS = Date.UTC(2026, 9, 24, 12)
const NOW_S = NOW_MS / 1000
const ORIGIN = "https://app.kiko.works"

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")

const keyPair = () =>
  Effect.promise(async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair
    const spki = Buffer.from((await crypto.subtle.exportKey("spki", pair.publicKey)) as ArrayBuffer).toString("base64")
    return { privateKey: pair.privateKey, pem: `-----BEGIN PUBLIC KEY-----\n${spki}\n-----END PUBLIC KEY-----` }
  })

const sign = (key: CryptoKey, claims: Record<string, unknown>) =>
  Effect.promise(async () => {
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}`
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned))
    return `${unsigned}.${Buffer.from(signature).toString("base64url")}`
  })

const claims = (extra: Record<string, unknown> = {}) => ({
  sub: "user_a",
  azp: ORIGIN,
  exp: NOW_S + 60,
  nbf: NOW_S - 5,
  ...extra,
})

const verdict = (trust: ClerkTrust, token: string) =>
  verifyClerkToken(trust, token, NOW_MS).pipe(
    Effect.result,
    Effect.map(Result.match({ onSuccess: (value) => value.sub, onFailure: (error) => error.code })),
  )

describe("verifyClerkToken", () => {
  it.effect("accepts a current token from a trusted origin and returns its subject", () =>
    Effect.gen(function* () {
      const { privateKey, pem } = yield* keyPair()
      const token = yield* sign(privateKey, claims())
      assert.strictEqual(yield* verdict({ key: pem, trustedOrigins: [ORIGIN] }, token), "user_a")
    }),
  )

  it.effect("names why a token is refused", () =>
    Effect.gen(function* () {
      const { privateKey, pem } = yield* keyPair()
      const other = yield* keyPair()
      const trust = { key: pem, trustedOrigins: [ORIGIN] }
      const expired = yield* sign(privateKey, claims({ exp: NOW_S - 6 }))
      const early = yield* sign(privateKey, claims({ nbf: NOW_S + 30 }))
      const foreign = yield* sign(other.privateKey, claims())
      const untrusted = yield* sign(privateKey, claims({ azp: "https://kiko-app.example.workers.dev" }))
      assert.deepStrictEqual(
        [
          yield* verdict(trust, expired),
          yield* verdict(trust, early),
          yield* verdict(trust, foreign),
          yield* verdict(trust, untrusted),
          yield* verdict(trust, "not.a.token"),
          yield* verdict({ key: "not a key", trustedOrigins: [ORIGIN] }, yield* sign(privateKey, claims())),
        ],
        ["token_expired", "token_expired", "token_invalid", "origin_untrusted", "token_invalid", "token_invalid"],
      )
    }),
  )

  it.effect("allows five seconds of clock skew on expiry", () =>
    Effect.gen(function* () {
      const { privateKey, pem } = yield* keyPair()
      const token = yield* sign(privateKey, claims({ exp: NOW_S - 4 }))
      assert.strictEqual(yield* verdict({ key: pem, trustedOrigins: [ORIGIN] }, token), "user_a")
    }),
  )
})
