export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class InstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly cfCodes: number[] = [],
  ) {
    super(message)
  }
}

type CfBody<T> = { success: boolean; result: T; errors?: { code: number; message: string }[] }

const API = "https://api.cloudflare.com/client/v4"

// 10000 is Cloudflare's "Authentication error" and 9109 is "Unauthorized to access requested resource".
// UNVERIFIED on a live account: that every denied call carries one of these.
const DENIED = [10000, 9109]

function codeOf(status: number, codes: number[]): string {
  if (status === 401 || status === 403 || codes.some((c) => DENIED.includes(c))) return "no_permission"
  if (status === 429) return "busy"
  if (status >= 500) return "cloudflare_down"
  return "cloudflare_error"
}

/** A failure that repeating the same call will not fix, so a caller that swallows other errors must not swallow these. */
export const isBlocking = (e: unknown): e is InstallError => e instanceof InstallError && ["no_permission", "busy", "cloudflare_down"].includes(e.code)

// One Cloudflare API call. The token goes in the header only; errors carry Cloudflare's own message and codes, never the token.
export async function cf<T>(token: string, path: string, init: RequestInit = {}, fetcher: FetchLike = fetch): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  const res = await fetcher(`${API}${path}`, { ...init, headers })
  const body = (await res.json().catch(() => null)) as CfBody<T> | null
  if (!res.ok || !body?.success) {
    const errors = body?.errors ?? []
    const codes = errors.map((e) => e.code)
    throw new InstallError(codeOf(res.status, codes), errors[0]?.message ?? `Cloudflare answered ${res.status}.`, 502, codes)
  }
  return body.result
}

export function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}
