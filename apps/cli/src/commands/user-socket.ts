import { CliError, type Context } from "../context"
import { sessionToken } from "./login"

export type Frame = Record<string, unknown>

export async function askFrame(
  ctx: Context,
  send: Frame | null,
  match: (frame: Frame) => boolean,
  timeoutMs: number,
): Promise<Frame> {
  const token = await sessionToken(ctx.url)
  if (!token) throw new CliError("not signed in. run `kiko login --dev` first")
  const target = new URL("api/ws", ctx.url)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"
  const options: Bun.WebSocketOptions = { headers: { authorization: `Bearer ${token}` } }
  const socket = new WebSocket(target, options as unknown as string[])
  try {
    return await new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CliError(`no answer from the user socket in ${Math.round(timeoutMs / 1000)} s`)),
        timeoutMs,
      )
      socket.addEventListener("open", () => {
        if (send) socket.send(JSON.stringify(send))
      })
      socket.addEventListener("error", () => reject(new CliError(`cannot connect to ${target}`)))
      socket.addEventListener("message", (ev) => {
        try {
          const frame = JSON.parse(String(ev.data)) as Frame
          if (!match(frame)) return
          clearTimeout(timer)
          resolve(frame)
        } catch {}
      })
    })
  } finally {
    socket.close()
  }
}

export async function askUser<R>(ctx: Context, frame: Frame, answer: string): Promise<R> {
  const reqId = "cli1"
  const answered = await askFrame(
    ctx,
    { ...frame, reqId },
    (f) => f.t === answer && f.reqId === reqId && Boolean(f.result),
    30_000,
  )
  return answered.result as R
}
