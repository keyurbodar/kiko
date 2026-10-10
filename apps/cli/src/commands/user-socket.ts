import { CliError, type Context } from "../main"
import { sessionCookie } from "./login"

/**
 * Sends one frame on the user socket and returns the `result` of the answer of type `answer` with
 * the same `reqId`. Sign in first with `yuki login --dev`.
 */
export async function askUser<R>(ctx: Context, frame: Record<string, unknown>, answer: string): Promise<R> {
  const cookie = await sessionCookie(ctx.url)
  if (!cookie) throw new CliError("not signed in. run `yuki login --dev` first")
  const target = new URL("api/ws/user", ctx.url.endsWith("/") ? ctx.url : `${ctx.url}/`)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
  // Bun takes headers here. The DOM type that the default lib adds does not know that.
  const options: Bun.WebSocketOptions = { headers: { cookie } }
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
