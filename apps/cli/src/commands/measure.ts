import { CliError, type Context } from "../main"
import { sessionCookie } from "./login"

// kiko measure turn --runs N [--tail <file>]
// Runs the experiment turn route on a fresh Durable Object per run and prints what each turn cost.
// Row counts come from the Worker, which needs KIKO_DEBUG_ROWS=1. CPU and wall time come from a
// `wrangler tail --format json` capture, passed with --tail. Local `wrangler dev` has no tail.

interface TurnReply {
  status: string
  openMs: number
  wallMs: number
  rows?: { open: Counts; turn: Counts }
  objectId: string
}
interface Counts {
  rowsRead: number
  rowsWritten: number
  statements: number
}
export interface TailEvent {
  requests: number
  cpuMs: number
  wallMs: number
}

/**
 * Reads a `wrangler tail --format json` capture and sums the invocations of one run: every event of
 * the Durable Object with that id (RPC calls and alarms, cancelled alarms included), plus the Worker
 * request whose url holds the run name. Wall time is the Worker request's, which spans the whole turn.
 */
export function readTail(text: string, objectId: string, name: string): TailEvent {
  let requests = 0
  let cpuMs = 0
  let wallMs = 0
  // `wrangler tail --format json` prints one pretty-printed object per event.
  for (const chunk of text.split(/\n(?=\{)/)) {
    if (!chunk.trim()) continue
    const event = JSON.parse(chunk) as { cpuTime?: number; wallTime?: number; durableObjectId?: string; event?: { request?: { url?: string } } }
    const isObject = event.durableObjectId === objectId
    const isWorker = event.event?.request?.url?.includes(`name=${name}&`) === true
    if (!isObject && !isWorker) continue
    requests += 1
    cpuMs += event.cpuTime ?? 0
    if (isWorker) wallMs = event.wallTime ?? 0
  }
  return { requests, cpuMs, wallMs }
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

export async function measure(ctx: Context): Promise<void> {
  if (ctx.args[0] !== "turn") throw new CliError("usage: kiko measure turn --runs <n> [--tail <file>]")
  const runs = Number(ctx.runs)
  if (!Number.isInteger(runs) || runs < 1) throw new CliError(`bad --runs: ${ctx.runs}`)
  const base = ctx.url.endsWith("/") ? ctx.url : `${ctx.url}/`
  const batch = Date.now().toString(36)
  const rows: Record<string, number | string>[] = []
  const objectIds: Record<string, string> = {}
  // The turn uses the signed-in user's own `opencode-go` credential. Run `kiko login` and connect it first.
  const cookie = await sessionCookie(ctx.url)
  if (!cookie) throw new CliError("not signed in. run kiko login first")
  for (let i = 1; i <= runs; i++) {
    const name = `${batch}-${i}`
    const res = await fetch(new URL(`api/experiments/turn?name=${name}&id=${name}${process.env.KIKO_MEASURE_HEARTBEAT === "0" ? "&heartbeat=0" : ""}`, base), { method: "POST", headers: { cookie }, signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new CliError(`run ${i} failed: ${res.status}`)
    const reply = (await res.json()) as TurnReply
    if (reply.status !== "done") throw new CliError(`run ${i} did not answer: ${reply.status}`)
    if (!reply.rows) throw new CliError("the Worker did not report rows. Start it with KIKO_DEBUG_ROWS=1")
    objectIds[name] = reply.objectId
    rows.push({ run: i, name, rowsWritten: reply.rows.turn.rowsWritten, rowsRead: reply.rows.turn.rowsRead, statements: reply.rows.turn.statements, openRowsWritten: reply.rows.open.rowsWritten, openMs: reply.openMs, wallMs: reply.wallMs })
  }
  if (ctx.tail) {
    // Give the tail a moment to flush, then match each run's events by its name.
    await new Promise((resolve) => setTimeout(resolve, 6000))
    const text = await Bun.file(ctx.tail).text()
    for (const row of rows) {
      const tail = readTail(text, objectIds[String(row.name)]!, String(row.name))
      row.requests = tail.requests
      row.cpuMs = Math.round(tail.cpuMs * 10) / 10
      row.tailWallMs = Math.round(tail.wallMs)
    }
  }
  const summary: Record<string, number> = {}
  for (const key of ["rowsWritten", "rowsRead", "statements", "requests", "cpuMs", "wallMs"]) {
    const values = rows.flatMap((row) => (typeof row[key] === "number" ? [row[key] as number] : []))
    if (values.length) summary[key] = Math.round(mean(values) * 10) / 10
  }
  if (ctx.json) return console.log(JSON.stringify({ rows, mean: summary }))
  const columns = Object.keys(rows[0]!).filter((key) => key !== "name")
  console.log(columns.join("\t"))
  for (const row of rows) console.log(columns.map((key) => row[key] ?? "").join("\t"))
  console.log(`mean\t${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(" ")}`)
}
