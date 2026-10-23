import { CliError, type Context } from "../context"

export async function health(ctx: Context): Promise<void> {
  const url = new URL("api/health", ctx.url)
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  } catch (e) {
    throw new CliError(`health failed: cannot reach ${url.origin} (${e instanceof Error ? e.message : e})`)
  }
  if (!res.ok) throw new CliError(`health failed: ${url} returned ${res.status}`)
  const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
  if (body?.ok !== true) throw new CliError(`health failed: unexpected body from ${url}`)
  console.log(ctx.json ? JSON.stringify({ ok: true, url: url.origin }) : "ok")
}
