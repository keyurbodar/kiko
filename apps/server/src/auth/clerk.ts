// Verifies a Clerk session token offline: an RS256 signature against the instance's public key, then the claims.
// No call to Clerk is made. The key is the PEM from the Clerk dashboard, in the CLERK_JWT_KEY secret.

export interface ClerkEnv {
  CLERK_JWT_KEY?: string
  OWNER_ID?: string
  TRUSTED_ORIGINS?: string
}

// Clock skew allowed on exp and nbf, in seconds.
const SKEW_S = 5

export type ClerkVerdict = { ok: true } | { ok: false; status: 401 | 403; message: string }

const bad = (message: string): ClerkVerdict => ({ ok: false, status: 401, message })

function base64Url(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function json(part: string | undefined): Record<string, unknown> | null {
  const bytes = part === undefined ? null : base64Url(part)
  if (!bytes) return null
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function publicKey(pem: string): Promise<CryptoKey | null> {
  const body = pem.replace(/\\n/g, "\n").replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")
  const der = base64Url(body)
  if (!der) return null
  return crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]).catch(() => null)
}

export async function verifyClerkToken(env: Required<Pick<ClerkEnv, "CLERK_JWT_KEY" | "OWNER_ID">> & ClerkEnv, token: string, nowMs = Date.now()): Promise<ClerkVerdict> {
  const parts = token.split(".")
  const [head, claimsPart, sig] = parts
  if (parts.length !== 3 || !head || !claimsPart || !sig) return bad("That token is not valid")
  const header = json(head)
  const claims = json(claimsPart)
  const signature = base64Url(sig)
  if (header?.alg !== "RS256" || !claims || !signature) return bad("That token is not valid")
  const key = await publicKey(env.CLERK_JWT_KEY)
  if (!key) return bad("That token is not valid")
  const signed = new TextEncoder().encode(`${head}.${claimsPart}`)
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed))) return bad("That token is not valid")

  const now = nowMs / 1000
  const { exp, nbf, azp, sub } = claims
  if (typeof exp !== "number" || exp + SKEW_S <= now) return bad("That token has expired")
  if (nbf !== undefined && (typeof nbf !== "number" || nbf - SKEW_S > now)) return bad("That token is not valid yet")
  if (azp !== undefined) {
    const trusted = env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []
    if (typeof azp !== "string" || !trusted.includes(azp)) return bad("That token is from an origin this backend does not trust")
  }
  if (sub !== env.OWNER_ID) return { ok: false, status: 403, message: "This backend belongs to someone else" }
  return { ok: true }
}
