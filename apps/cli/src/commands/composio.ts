import { CliError, type Context } from "../main"
import { askUser } from "./user-socket"

// yuki composio connect | developer [remove] | disconnect | status: speaks the user socket frames
// of the Composio integration. `connect` reads the key from COMPOSIO_API_KEY and `developer` from
// COMPOSIO_DEVELOPER_KEY, so neither lands in shell history.
// Sign in first with `yuki login --dev`.

type Result = { ok: true; status: { connected: boolean; rows: number; developer: boolean }; tools?: string[] } | { ok: false; error: string }

export async function composio(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  let frame: Record<string, unknown>
  if (sub === "connect") {
    const apiKey = process.env.COMPOSIO_API_KEY
    if (!apiKey) throw new CliError("set COMPOSIO_API_KEY to the consumer key (ck_...)")
    frame = { t: "connectComposio", apiKey }
  } else if (sub === "developer") {
    const key = ctx.args[1] === "remove" ? null : process.env.COMPOSIO_DEVELOPER_KEY
    if (key === undefined) throw new CliError("set COMPOSIO_DEVELOPER_KEY to the developer key (ak_...), or pass remove")
    frame = { t: "setComposioDeveloperKey", key }
  } else if (sub === "disconnect") frame = { t: "disconnectComposio" }
  else if (sub === "status") frame = { t: "composioStatus", tools: true }
  else throw new CliError("usage: yuki composio <connect | developer [remove] | disconnect | status>")
  const result = await askUser<Result>(ctx, frame, "composio")
  if (ctx.json) console.log(JSON.stringify(result))
  else if (!result.ok) throw new CliError(result.error)
  else {
    console.log(`connected: ${result.status.connected}, developer key: ${result.status.developer}, rows: ${result.status.rows}`)
    for (const t of result.tools ?? []) console.log(t)
  }
}
