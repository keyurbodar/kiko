import { CliError, type Context } from "../main"
import { askUser } from "./user-socket"

// yuki kernel connect | disconnect | status: speaks the user socket frames of the Kernel browser
// integration. `connect` reads the key from KERNEL_API_KEY, so it does not land in shell history.
// Sign in first with `yuki login --dev`.

type Result = { ok: true; status: { connected: boolean; broken: boolean; browser: { mode: string; tabs: Record<string, number> } | null } } | { ok: false; error: string }

export async function kernel(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  let frame: Record<string, unknown>
  if (sub === "connect") {
    const apiKey = process.env.KERNEL_API_KEY
    if (!apiKey) throw new CliError("set KERNEL_API_KEY to the Kernel key")
    frame = { t: "connectKernel", apiKey }
  } else if (sub === "disconnect") frame = { t: "disconnectKernel" }
  else if (sub === "status") frame = { t: "kernelStatus" }
  else throw new CliError("usage: yuki kernel <connect | disconnect | status>")
  const result = await askUser<Result>(ctx, frame, "kernel")
  if (ctx.json) console.log(JSON.stringify(result))
  else if (!result.ok) throw new CliError(result.error)
  else {
    const { connected, broken, browser } = result.status
    console.log(`connected: ${connected}, key rejected: ${broken}, browser: ${browser ? `${browser.mode}, tabs ${JSON.stringify(browser.tabs)}` : "none"}`)
  }
}
