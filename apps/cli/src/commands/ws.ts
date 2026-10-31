import { CliError, type Context } from "../context"
import { sessionToken } from "./login"

const FIRST_REPLY_MS = 10_000

export async function ws(ctx: Context): Promise<void> {
  const path = ctx.args[0]
  if (!path) throw new CliError({ message: "ws needs a path, for example: kiko ws /api/rpc" })
  const target = new URL(path, ctx.url)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"

  const token = await sessionToken(ctx.url)
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {}
  const options: Bun.WebSocketOptions = { headers }
  const socket = new WebSocket(target, options as unknown as string[])
  const opened = Promise.withResolvers<void>()
  const onConnectError = () => {
    void refusal(target, headers).then((why) =>
      opened.reject(new CliError({ message: `ws failed: cannot connect to ${target}${why}` })),
    )
  }
  socket.addEventListener("open", () => opened.resolve())
  socket.addEventListener("error", onConnectError)
  await opened.promise
  socket.removeEventListener("error", onConnectError)

  let timer: ReturnType<typeof setTimeout> | undefined
  let stdinDone = false
  let heard = false
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => socket.close(), ctx.idle)
  }

  const closed = Promise.withResolvers<void>()
  const input = Bun.stdin.stream().getReader()
  socket.addEventListener("message", (ev) => {
    const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
    let frame: unknown = text
    try {
      frame = JSON.parse(text)
    } catch {}
    console.log(JSON.stringify(frame))
    heard = true
    if (stdinDone) arm()
  })
  socket.addEventListener("error", () =>
    closed.reject(new CliError({ message: `ws failed: connection to ${target} broke` })),
  )
  socket.addEventListener("close", (ev) => {
    clearTimeout(timer)
    void input.cancel().catch(() => {})
    if (ev.code === 1000 || ev.code === 1005) return closed.resolve()
    const reason = ev.reason ? `: ${ev.reason}` : ""
    closed.reject(new CliError({ message: `ws failed: connection to ${target} closed with ${ev.code}${reason}` }))
  })
  ;(async () => {
    let buf = ""
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await input.read()
      if (done) break
      if (socket.readyState !== WebSocket.OPEN) return
      buf += decoder.decode(value, { stream: true })
      let i = buf.indexOf("\n")
      while (i >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) socket.send(line)
        i = buf.indexOf("\n")
      }
    }
    if (buf.trim() && socket.readyState === WebSocket.OPEN) socket.send(buf.trim())
    stdinDone = true
    clearTimeout(timer)
    timer = setTimeout(() => socket.close(), heard ? ctx.idle : Math.max(ctx.idle, FIRST_REPLY_MS))
  })().catch(closed.reject)
  await closed.promise
}

async function refusal(target: URL, headers: Record<string, string>): Promise<string> {
  const http = new URL(target)
  http.protocol = target.protocol === "wss:" ? "https:" : "http:"
  try {
    const res = await fetch(http, { headers: { ...headers, upgrade: "websocket" }, signal: AbortSignal.timeout(5000) })
    await res.body?.cancel()
    return ` (${res.status})`
  } catch {
    return ""
  }
}
