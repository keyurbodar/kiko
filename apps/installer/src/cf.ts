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

// One Cloudflare API call. The token goes in the header only; errors carry Cloudflare's own message and codes, never the token.
export async function cf<T>(token: string, path: string, init: RequestInit = {}, fetcher: FetchLike = fetch): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  const res = await fetcher(`${API}${path}`, { ...init, headers })
  const body = (await res.json().catch(() => null)) as CfBody<T> | null
  if (!res.ok || !body?.success) {
    const errors = body?.errors ?? []
    throw new InstallError("cloudflare_error", errors[0]?.message ?? `Cloudflare answered ${res.status}.`, 502, errors.map((e) => e.code))
  }
  return body.result
}

export function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}
