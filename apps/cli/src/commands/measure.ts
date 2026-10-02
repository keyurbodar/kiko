import { CliError, type Context } from "../main"

type TurnMeasurement = {
  coalesce: boolean
  status: string
  streamMs: number
  rowsWritten: number
  commits: number
  held: number
  answerChars: number
}

// kiko measure turn [--coalesce] [--ms <stream ms>]: asks a dev Worker to run one faux-model turn in an
// empty AgentDO and count the SQLite rows it writes (architecture section 17.5).
async function turn(ctx: Context) {
  const url = new URL("api/experiments/coalescing", ctx.url.endsWith("/") ? ctx.url : `${ctx.url}/`)
  url.searchParams.set("coalesce", ctx.coalesce ? "1" : "0")
  url.searchParams.set("ms", String(ctx.ms))
  let res: Response
  try {
    res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(ctx.ms + 60_000) })
  } catch (e) {
    throw new CliError(`measure failed: cannot reach ${url.origin} (${e instanceof Error ? e.message : e})`)
  }
  if (res.status === 404) throw new CliError("measure failed: the worker must run with NODE_ENV=development")
  if (!res.ok) throw new CliError(`measure failed: ${url.pathname} returned ${res.status}`)
  const m = (await res.json()) as TurnMeasurement
  if (m.status !== "done" || m.answerChars < 0) throw new CliError(`measure failed: the turn ended ${m.status}`)
  if (ctx.json) return console.log(JSON.stringify(m))
  console.log(
    `${m.coalesce ? "coalesced" : "as shipped"}: ${m.rowsWritten} rows written, ${m.commits} commits (${m.held} held), ${m.streamMs} ms`,
  )
}

export async function measure(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  if (sub === "turn") return turn(ctx)
  throw new CliError("usage: kiko measure turn [--coalesce] [--ms <stream ms>]")
}
