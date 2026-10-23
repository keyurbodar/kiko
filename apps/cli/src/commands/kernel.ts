import { CommandId } from "@kiko/protocol"
import * as Schema from "effect/Schema"
import { CliError, type Context } from "../context"
import { withOwner } from "../owner"

const commandId = () => Schema.decodeSync(CommandId)(crypto.randomUUID())

export async function kernel(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  const result = await withOwner(ctx, (client) => {
    if (sub === "connect") {
      const apiKey = process.env.KERNEL_API_KEY
      if (!apiKey) throw new CliError({ message: "set KERNEL_API_KEY to the Kernel key" })
      return client["kernel.connect"]({ commandId: commandId(), apiKey })
    }
    if (sub === "disconnect") return client["kernel.disconnect"]({ commandId: commandId() })
    if (sub === "status") return client["kernel.status"]()
    throw new CliError({ message: "usage: kiko kernel <connect | disconnect | status>" })
  })
  if (ctx.json) console.log(JSON.stringify(result))
  else if (!result.ok) throw new CliError({ message: result.error })
  else {
    const { connected, broken, browser } = result.status
    console.log(
      `connected: ${connected}, key rejected: ${broken}, browser: ${browser ? `${browser.mode}, tabs ${JSON.stringify(browser.tabs)}` : "none"}`,
    )
  }
}
