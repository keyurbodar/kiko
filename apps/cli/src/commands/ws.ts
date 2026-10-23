import { CliError, type Context } from "../main"
import { sessionToken } from "./login"

export async function ws(ctx: Context): Promise<void> {
  const path = ctx.args[0]
  if (!path) throw new CliError("ws needs a path, for example: kiko ws /api/ws")
  const target = new URL(path, ctx.url)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"

  const token = await sessionToken(ctx.url)
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {}
  const options: Bun.WebSocketOptions = { headers }
  const socket = new WebSocket(target, options as unknown as string[])
  const opened = Promise.withResolvers<void>()
  socket.onopen = () => opened.resolve()
  socket.onerror = () => {
    void refusal(target, headers).then((why) =>
      opened.reject(new CliError(`ws failed: cannot connect to ${target}${why}`)),
    )
  }
  await opened.promise

  let timer: ReturnType<typeof setTimeout> | undefined
  let stdinDone = false
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => socket.close(), ctx.idle)
  }

  const closed = Promise.withResolvers<void>()
  socket.onmessage = (ev) => {
    const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
    let frame: unknown = text
    try {
      frame = JSON.parse(text)
    } catch {}
    console.log(JSON.stringify(frame))
    if (stdinDone) arm()
  }
  socket.onerror = () => closed.reject(new CliError(`ws failed: connection to ${target} broke`))
  socket.onclose = () => {
    clearTimeout(timer)
    closed.resolve()
  }
  ;(async () => {
    for await (const line of lines()) {
      if (socket.readyState !== WebSocket.OPEN) return
      socket.send(line)
    }
    stdinDone = true
    arm()
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

async function* lines(): AsyncGenerator<string> {
  let buf = ""
  const decoder = new TextDecoder()
  for await (const chunk of Bun.stdin.stream()) {
    buf += decoder.decode(chunk, { stream: true })
    let i = buf.indexOf("\n")
    while (i >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) yield line
      i = buf.indexOf("\n")
    }
  }
  if (buf.trim()) yield buf.trim()
}
