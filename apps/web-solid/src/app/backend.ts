import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type { Exchange } from "./machine"
import { BackendKey, type BackendUrl, type BackendUser, type ClerkUserId, type Descriptor, SessionToken } from "./phase"

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const Current = Schema.Struct({
  kiko: Schema.Literal(1),
  version: Schema.String,
  protocol: Schema.Number,
  selfUpdate: Schema.Boolean,
})
const Legacy = Schema.Struct({ version: Schema.String })
const Session = Schema.Struct({
  token: SessionToken,
  user: Schema.Struct({ id: Schema.String, name: Schema.String }),
})
const Refusal = Schema.Struct({ code: Schema.String })

const current = Schema.decodeUnknownOption(Current)
const legacy = Schema.decodeUnknownOption(Legacy)
const session = Schema.decodeUnknownOption(Session)
const refusal = Schema.decodeUnknownOption(Refusal)

const transient = (status: number) => status >= 500 || status === 408 || status === 429

const bodyOf = (response: Response): Promise<unknown> => response.json().catch(() => null)

export const normalizeUrl = (url: string): BackendUrl => url.trim().replace(/\/+$/, "") as BackendUrl

function descriptorOf(body: unknown): Descriptor {
  const now = current(body)
  if (Option.isSome(now)) {
    const { version, protocol, selfUpdate } = now.value
    return { _tag: "Current", version, protocol, selfUpdate }
  }
  return Option.match(legacy(body), {
    onNone: () => ({ _tag: "Gone" }),
    onSome: ({ version }) => ({ _tag: "Legacy", version }),
  })
}

export async function describeBackend(url: BackendUrl, fetch: Fetch): Promise<Descriptor> {
  const response = await fetch(`${url}/api/version`, { cache: "no-store" }).catch(() => null)
  if (!response || transient(response.status)) return { _tag: "Unreachable" }
  if (!response.ok) return { _tag: "Gone" }
  return descriptorOf(await bodyOf(response))
}

async function refused(response: Response): Promise<Exchange> {
  if (transient(response.status)) return { _tag: "Unreachable" }
  if (response.status === 403) return { _tag: "NotOwner" }
  const code = Option.map(refusal(await bodyOf(response)), (body) => body.code)
  return response.status === 401 && Option.contains(code, "token_expired") ? { _tag: "Expired" } : { _tag: "Invalid" }
}

export const sessionOf = (body: unknown): { readonly token: SessionToken; readonly user: BackendUser } | null =>
  Option.match(session(body), { onNone: () => null, onSome: ({ token, user }) => ({ token, user }) })

export async function exchangeToken(url: BackendUrl, clerkToken: string, fetch: Fetch): Promise<Exchange> {
  const response = await fetch(`${url}/api/auth/clerk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: clerkToken }),
  }).catch(() => null)
  if (!response) return { _tag: "Unreachable" }
  if (!response.ok) return refused(response)
  const signed = sessionOf(await bodyOf(response))
  return signed ? { _tag: "Ok", ...signed } : { _tag: "Invalid" }
}

export async function backendKey(clerkUserId: ClerkUserId | null, url: BackendUrl): Promise<BackendKey> {
  const bytes = new TextEncoder().encode(`${clerkUserId ?? ""}\n${url}`)
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  const hex = Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("")
  return BackendKey.make(hex)
}
