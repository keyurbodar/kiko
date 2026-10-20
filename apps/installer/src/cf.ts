export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type AccountChoice = { id: string; name: string }

export class InstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly cfCodes: number[] = [],
    readonly detail?: string,
    readonly accounts?: AccountChoice[],
  ) {
    super(message)
  }
}

type CfBody<T> = { success: boolean; result: T; errors?: { code: number; message: string }[] }

const API = "https://api.cloudflare.com/client/v4"

const DENIED = [10000, 9109]

const unknownToken = (errors: { code: number; message: string }[]) =>
  errors.some((e) => e.code === 6003 || /invalid (access|api) token/i.test(e.message))

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

export const isBlocking = (e: unknown): e is InstallError => e instanceof InstallError && ["bad_token", "no_permission", "busy", "storage_full", "cloudflare_down"].includes(e.code)

const SENTENCE: Record<string, string> = {
  bad_token: "Cloudflare does not recognise this token. Paste the token value Cloudflare showed once when you created it.",
  no_permission: "Cloudflare did not let this sign-in do a step of the install.",
  busy: "Cloudflare is busy. Wait a minute, then try again.",
  storage_full: "This Cloudflare account has used its free daily allowance of Durable Object storage, so the install could not save its step. The allowance resets at 00:00 UTC, and trying again after that works. A paid Workers plan removes the daily limit.",
  cloudflare_down: "Cloudflare is having trouble right now. Try again in a few minutes.",
  cloudflare_error: "Cloudflare did not accept a step of the install.",
}

export const installFailure = (e: unknown): InstallError | null => {
  if (e instanceof InstallError) return e
  const said = e instanceof Error ? e.message : String(e)
  return ROWS_FULL.test(said) ? new InstallError("storage_full", SENTENCE.storage_full as string, 503, [], said) : null
}

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
