import { CommandId } from "@kiko/protocol"
import * as Schema from "effect/Schema"
import { CliError, type Context } from "../context"
import { withOwner } from "../owner"

const commandId = () => Schema.decodeSync(CommandId)(crypto.randomUUID())

export async function composio(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  const result = await withOwner(ctx, (client) => {
    if (sub === "connect") {
      const apiKey = process.env.COMPOSIO_API_KEY
      if (!apiKey) throw new CliError({ message: "set COMPOSIO_API_KEY to the Composio project key (ak_...)" })
      return client["composio.connect"]({ commandId: commandId(), apiKey })
    }
    if (sub === "disconnect") return client["composio.disconnect"]({ commandId: commandId() })
    if (sub === "status") return client["composio.status"]({ tools: true })
    throw new CliError({ message: "usage: kiko composio <connect | disconnect | status>" })
  })
  if (ctx.json) console.log(JSON.stringify(result))
  else if (!result.ok) throw new CliError({ message: result.error })
  else {
    console.log(`connected: ${result.status.connected}, rows: ${result.status.rows}`)
    for (const t of result.tools ?? []) console.log(t)
  }
}
