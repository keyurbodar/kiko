import { CliError, type Context } from "../main"
import { askUser } from "./user-socket"

// kiko composio connect | disconnect | status: speaks the user socket frames of the Composio
// integration. `connect` reads the project key from COMPOSIO_API_KEY, so it never lands in shell history.
// Sign in first with `kiko login --dev`.

type Result = { ok: true; status: { connected: boolean; rows: number }; tools?: string[] } | { ok: false; error: string }

export async function composio(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  let frame: Record<string, unknown>
  if (sub === "connect") {
    const apiKey = process.env.COMPOSIO_API_KEY
    if (!apiKey) throw new CliError("set COMPOSIO_API_KEY to the Composio project key (ak_...)")
    frame = { t: "connectComposio", apiKey }
  } else if (sub === "disconnect") frame = { t: "disconnectComposio" }
  else if (sub === "status") frame = { t: "composioStatus", tools: true }
  else throw new CliError("usage: kiko composio <connect | disconnect | status>")
  const result = await askUser<Result>(ctx, frame, "composio")
  if (ctx.json) console.log(JSON.stringify(result))
  else if (!result.ok) throw new CliError(result.error)
  else {
    console.log(`connected: ${result.status.connected}, rows: ${result.status.rows}`)
    for (const t of result.tools ?? []) console.log(t)
  }
}
