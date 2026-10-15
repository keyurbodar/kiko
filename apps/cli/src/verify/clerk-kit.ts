// The Clerk Backend API, for the clerk suite and for scripts/clerk-dev.ts. It needs CLERK_SECRET_KEY from the
// shell (`set -a; . apps/server/.dev.vars; set +a`). Test users are found by external_id, so a rerun reuses
// them and cleanup is safe to repeat.
import { createPublicKey } from "node:crypto"

const API = "https://api.clerk.com/v1"

export const OWNER_EXTERNAL_ID = "kiko-verify-owner"
export const STRANGER_EXTERNAL_ID = "kiko-verify-stranger"

export const clerkSecret = () => process.env.CLERK_SECRET_KEY

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${clerkSecret()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Clerk ${method} ${path} answered ${res.status}`)
  return (await res.json()) as T
}

/** The instance's public key as one line of base64 (the PEM body). The Worker accepts it as CLERK_JWT_KEY. */
export async function instanceKey(): Promise<string> {
  const { keys } = await call<{ keys: JsonWebKey[] }>("GET", "/jwks")
  const jwk = keys[0]
  if (!jwk) throw new Error("Clerk returned no signing key")
  return createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "der" }).toString("base64")
}

export async function ensureUser(externalId: string): Promise<string> {
  const found = await call<{ id: string }[]>("GET", `/users?external_id=${encodeURIComponent(externalId)}`)
  if (found[0]) return found[0].id
  // The dev instance has no email identifier, so a username is what lets a sign-in token work.
  return (await call<{ id: string }>("POST", "/users", { external_id: externalId, username: externalId, first_name: "Kiko", last_name: "Verify" })).id
}

export async function deleteUser(externalId: string): Promise<void> {
  for (const user of await call<{ id: string }[]>("GET", `/users?external_id=${encodeURIComponent(externalId)}`)) {
    await call("DELETE", `/users/${user.id}`)
  }
}

export async function setBackendUrl(userId: string, backendUrl: string): Promise<void> {
  await call("PATCH", `/users/${userId}/metadata`, { public_metadata: { backendUrl } })
}

export async function sessionToken(userId: string): Promise<string> {
  const session = await call<{ id: string }>("POST", "/sessions", { user_id: userId })
  return (await call<{ jwt: string }>("POST", `/sessions/${session.id}/tokens`, {})).jwt
}

export async function signInToken(userId: string): Promise<string> {
  return (await call<{ token: string }>("POST", "/sign_in_tokens", { user_id: userId, expires_in_seconds: 600 })).token
}
