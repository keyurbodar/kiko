import { CliError, type Context } from "../main"
import { sessionToken } from "./login"

export async function askUser<R>(ctx: Context, frame: Record<string, unknown>, answer: string): Promise<R> {
  const token = await sessionToken(ctx.url)
  if (!token) throw new CliError("not signed in. run `kiko login --dev` first")
  const target = new URL("api/ws", ctx.url)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
  // Bun takes headers here. The DOM type that the default lib adds does not know that.
  const options: Bun.WebSocketOptions = { headers: { authorization: `Bearer ${token}` } }
  const socket = new WebSocket(target, options as unknown as string[])
  const reqId = "cli1"
  try {
    return await new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CliError("no answer from the user socket in 30 s")), 30_000)
      socket.onopen = () => socket.send(JSON.stringify({ ...frame, reqId }))
      socket.onerror = () => reject(new CliError(`cannot connect to ${target}`))
      socket.onmessage = (ev) => {
        try {
          const f = JSON.parse(String(ev.data)) as { t?: string; reqId?: string; result?: R }
          if (f.t === answer && f.reqId === reqId && f.result) {
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
