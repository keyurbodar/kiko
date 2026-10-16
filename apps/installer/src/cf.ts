export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type AccountChoice = { id: string; name: string }

export class InstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly cfCodes: number[] = [],
    /** Cloudflare's own sentence, shown under ours so the person sees what Cloudflare said. */
    readonly detail?: string,
    /** The accounts to pick from, for `choose_account`. */
    readonly accounts?: AccountChoice[],
  ) {
    super(message)
  }
}

type CfBody<T> = { success: boolean; result: T; errors?: { code: number; message: string }[] }

const API = "https://api.cloudflare.com/client/v4"

// 10000 is Cloudflare's "Authentication error" and 9109 is "Unauthorized to access requested resource".
// UNVERIFIED on a live account: that every denied call carries one of these.
const DENIED = [10000, 9109]

// A token Cloudflare does not know answers 9109 "Invalid access token" (checked live 2026-10-16), and one that is
// not a token at all answers 6003 "Invalid request headers". Neither is a missing permission.
const unknownToken = (errors: { code: number; message: string }[]) =>
  errors.some((e) => e.code === 6003 || /invalid (access|api) token/i.test(e.message))

function codeOf(status: number, errors: { code: number; message: string }[]): string {
  const codes = errors.map((e) => e.code)
  if (unknownToken(errors)) return "bad_token"
  if (status === 401 || status === 403 || codes.some((c) => DENIED.includes(c))) return "no_permission"
  if (status === 429) return "busy"
  if (status >= 500) return "cloudflare_down"
  return "cloudflare_error"
}

/** A failure that repeating the same call will not fix, so a caller that swallows other errors must not swallow these. */
export const isBlocking = (e: unknown): e is InstallError => e instanceof InstallError && ["bad_token", "no_permission", "busy", "cloudflare_down"].includes(e.code)

const SENTENCE: Record<string, string> = {
  bad_token: "Cloudflare does not recognise this token. Paste the token value Cloudflare showed once when you created it.",
  no_permission: "Cloudflare did not let this sign-in do a step of the install.",
  busy: "Cloudflare is busy. Wait a minute, then try again.",
  cloudflare_down: "Cloudflare is having trouble right now. Try again in a few minutes.",
  cloudflare_error: "Cloudflare did not accept a step of the install.",
}

// One Cloudflare API call. The token goes in the header only; errors carry Cloudflare's own message and codes, never the token.
export async function cf<T>(token: string, path: string, init: RequestInit = {}, fetcher: FetchLike = fetch): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)
  let res: Response
  try {
    res = await fetcher(`${API}${path}`, { ...init, headers })
  } catch {
    throw new InstallError("cloudflare_down", SENTENCE.cloudflare_down as string, 502)
  }
  const body = (await res.json().catch(() => null)) as CfBody<T> | null
  if (!res.ok || !body?.success) {
    const errors = body?.errors ?? []
    const codes = errors.flatMap((e) => (typeof e.code === "number" ? [e.code] : []))
    const code = codeOf(res.status, errors)
    const said = errors[0]?.message ?? `Cloudflare answered ${res.status}.`
    throw new InstallError(code, SENTENCE[code] as string, 502, codes, `${said} (${init.method ?? "GET"} ${path.replace(/\/accounts\/\w+/, "/accounts/…")})`)
  }
  return body.result
}

export function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}
