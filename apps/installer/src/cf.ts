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

// The Free plan allows 100,000 rows written and 5,000,000 rows read a day for the whole account. Over that allowance
// Cloudflare answers with this sentence and no documented code, so the words are what is matched. It arrives either
// as an API error body or as a throw from a storage call inside an object.
// https://developers.cloudflare.com/durable-objects/platform/limits/
const ROWS_FULL = /exceeded allowed rows (?:written|read) in durable objects/i

function codeOf(status: number, errors: { code: number; message: string }[]): string {
  const codes = errors.map((e) => e.code)
  if (unknownToken(errors)) return "bad_token"
  if (errors.some((e) => ROWS_FULL.test(e.message))) return "storage_full"
  if (status === 401 || status === 403 || codes.some((c) => DENIED.includes(c))) return "no_permission"
  if (status === 429) return "busy"
  if (status >= 500) return "cloudflare_down"
  return "cloudflare_error"
}

/** A failure that repeating the same call will not fix, so a caller that swallows other errors must not swallow these. */
export const isBlocking = (e: unknown): e is InstallError => e instanceof InstallError && ["bad_token", "no_permission", "busy", "storage_full", "cloudflare_down"].includes(e.code)

const SENTENCE: Record<string, string> = {
  bad_token: "Cloudflare does not recognise this token. Paste the token value Cloudflare showed once when you created it.",
  no_permission: "Cloudflare did not let this sign-in do a step of the install.",
  busy: "Cloudflare is busy. Wait a minute, then try again.",
  storage_full: "This Cloudflare account has used its free daily allowance of Durable Object storage, so the install could not save its step. The allowance resets at 00:00 UTC, and trying again after that works. A paid Workers plan removes the daily limit.",
  cloudflare_down: "Cloudflare is having trouble right now. Try again in a few minutes.",
  cloudflare_error: "Cloudflare did not accept a step of the install.",
}

/** A thrown error made into the install failure it is, or null when it is one the catch-all does not know. A storage
 * call inside an object throws Cloudflare's row-limit sentence instead of an API error body. */
export const installFailure = (e: unknown): InstallError | null => {
  if (e instanceof InstallError) return e
  const said = e instanceof Error ? e.message : String(e)
  return ROWS_FULL.test(said) ? new InstallError("storage_full", SENTENCE.storage_full as string, 503, [], said) : null
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
