import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

const SKEW_S = 5

export class ClerkTokenError extends Schema.TaggedError<ClerkTokenError>()("ClerkTokenError", {
  code: Schema.Literals(["token_expired", "token_invalid", "origin_untrusted"]),
  message: Schema.String,
}) {}

export interface ClerkTrust {
  readonly key: string
  readonly trustedOrigins: ReadonlyArray<string>
}

export interface ClerkClaims {
  readonly sub: string
}

const Header = Schema.Struct({ alg: Schema.Literal("RS256") })

const Claims = Schema.Struct({
  sub: Schema.String,
  exp: Schema.Number,
  nbf: Schema.optionalKey(Schema.Number),
  azp: Schema.optionalKey(Schema.String),
})

const decodeHeader = Schema.decodeUnknownOption(Schema.fromJsonString(Header))
const decodeClaims = Schema.decodeUnknownOption(Schema.fromJsonString(Claims))

function base64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  try {
    return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

const utf8 = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : "")

const importKey = (pem: string) =>
  Effect.tryPromise({
    try: () => {
      const der = Uint8Array.from(
        atob(
          pem
            .replace(/\\n/g, "\n")
            .replace(/-----[A-Z ]+-----/g, "")
            .replace(/\s+/g, ""),
        ),
        (c) => c.charCodeAt(0),
      )
      return crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"])
    },
    catch: () => new ClerkTokenError({ code: "token_invalid", message: "That token is not valid" }),
  })

export const verifyClerkToken = Effect.fn("verifyClerkToken")(function* (
  trust: ClerkTrust,
  token: string,
  nowMs: number,
) {
  const [head = "", body = "", sig = "", ...rest] = token.split(".")
  const signature = base64Url(sig)
  const claims = decodeClaims(utf8(base64Url(body)))
  if (rest.length > 0 || !signature || Option.isNone(decodeHeader(utf8(base64Url(head)))) || Option.isNone(claims))
    return yield* new ClerkTokenError({ code: "token_invalid", message: "That token is not valid" })
  const key = yield* importKey(trust.key)
  const signed = new TextEncoder().encode(`${head}.${body}`)
  const valid = yield* Effect.promise(() => crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed))
  if (!valid) return yield* new ClerkTokenError({ code: "token_invalid", message: "That token is not valid" })
  const { sub, exp, nbf, azp } = claims.value
  const now = nowMs / 1000
  if (exp + SKEW_S <= now)
    return yield* new ClerkTokenError({ code: "token_expired", message: "That token has expired" })
  if (nbf !== undefined && nbf - SKEW_S > now)
    return yield* new ClerkTokenError({ code: "token_expired", message: "That token is not valid yet" })
  if (azp === undefined || !trust.trustedOrigins.includes(azp))
    return yield* new ClerkTokenError({
      code: "origin_untrusted",
      message: "That token is from an origin this backend does not trust",
    })
  return { sub } satisfies ClerkClaims
})
