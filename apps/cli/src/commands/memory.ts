import { CliError, type Context } from "../main"
import { sessionCookie } from "./login"

/** What `POST /api/memory/tidy` answers. Mirrors `TidyReport` in the server's `user/tidy.ts`. */
export type TidyReport = {
  ran: boolean
  skipped?: "off" | "unchanged" | "no provider" | "model error"
  appended: number
  rewritten: number
  merged: number
  corrected: number
  archived: number
  souls: number
}

/** Runs the signed-in user's memory tidy now. It can call the user's model, so it waits up to two minutes. */
export async function tidyNow(url: string, cookie: string): Promise<TidyReport> {
  const target = new URL("api/memory/tidy", url.endsWith("/") ? url : `${url}/`)
  let res: Response
  try {
    res = await fetch(target, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    throw new CliError(`memory tidy failed: cannot reach ${target.origin} (${e instanceof Error ? e.message : e})`)
  }
  if (!res.ok) throw new CliError(`memory tidy failed: ${target} answered ${res.status}`)
  return (await res.json()) as TidyReport
}

// kiko memory tidy --now
export async function memory(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  if (sub !== "tidy" || !ctx.now) throw new CliError("usage: kiko memory tidy --now")
  const cookie = await sessionCookie(ctx.url)
  if (!cookie) throw new CliError("not signed in. run kiko login --dev first")
  const report = await tidyNow(ctx.url, cookie)
  if (ctx.json) return console.log(JSON.stringify(report))
  const counts = `appended ${report.appended}, rewritten ${report.rewritten}, merged ${report.merged}, corrected ${report.corrected}, archived ${report.archived}`
  console.log(report.ran ? `tidied: ${counts}` : `skipped (${report.skipped}): ${counts}`)
}
