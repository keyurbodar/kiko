import { CliError, type Context } from "../main"
import { sessionCookie } from "./login"

// yuki composio connect | developer [remove] | disconnect | status: speaks the user socket frames
// of the Composio integration. `connect` reads the key from COMPOSIO_API_KEY and `developer` from
// COMPOSIO_DEVELOPER_KEY, so neither lands in shell history.
// Sign in first with `yuki login --dev`.

type Result = { ok: true; status: { connected: boolean; rows: number; developer: boolean }; tools?: string[] } | { ok: false; error: string }

async function ask(ctx: Context, frame: Record<string, unknown>): Promise<Result> {
  const cookie = await sessionCookie(ctx.url)
  if (!cookie) throw new CliError("not signed in. run `yuki login --dev` first")
  const target = new URL("api/ws/user", ctx.url.endsWith("/") ? ctx.url : `${ctx.url}/`)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
  // Bun takes headers here. The DOM type that the default lib adds does not know that.
  const options: Bun.WebSocketOptions = { headers: { cookie } }
  const socket = new WebSocket(target, options as unknown as string[])
  const reqId = "cli1"
  try {
    return await new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CliError("no answer from the user socket in 30 s")), 30_000)
      socket.onopen = () => socket.send(JSON.stringify({ ...frame, reqId }))
      socket.onerror = () => reject(new CliError(`cannot connect to ${target}`))
      socket.onmessage = (ev) => {
        try {
          const f = JSON.parse(String(ev.data)) as { t?: string; reqId?: string; result?: Result }
          if (f.t === "composio" && f.reqId === reqId && f.result) {
            clearTimeout(timer)
            resolve(f.result)
          }
        } catch {}
      }
    })
  } finally {
    socket.close()
  }
}

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
  const result = await ask(ctx, frame)
  if (ctx.json) console.log(JSON.stringify(result))
  else if (!result.ok) throw new CliError(result.error)
  else {
    console.log(`connected: ${result.status.connected}, developer key: ${result.status.developer}, rows: ${result.status.rows}`)
    for (const t of result.tools ?? []) console.log(t)
  }
}
