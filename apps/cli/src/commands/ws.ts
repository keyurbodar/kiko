import { CliError, type Context } from "../main"

/** Opens a WebSocket, sends each stdin line as a frame, prints each received frame as one JSON line. */
export async function ws(ctx: Context): Promise<void> {
  const path = ctx.args[0]
  if (!path) throw new CliError("ws needs a path, for example: kiko ws /api/ws")
  const target = new URL(path, ctx.url)
  target.protocol = target.protocol === "https:" ? "wss:" : "ws:"

  const socket = new WebSocket(target)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new CliError(`ws failed: cannot connect to ${target}`))
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  let stdinDone = false
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => socket.close(), ctx.idle)
  }

  await new Promise<void>((resolve, reject) => {
    socket.onmessage = (ev) => {
      const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
      let frame: unknown = text
      try {
        frame = JSON.parse(text)
      } catch {}
      console.log(JSON.stringify(frame))
      if (stdinDone) arm()
    }
    socket.onerror = () => reject(new CliError(`ws failed: connection to ${target} broke`))
    socket.onclose = () => {
      clearTimeout(timer)
      resolve()
    }
    ;(async () => {
      for await (const line of lines()) {
        if (socket.readyState !== WebSocket.OPEN) return
        socket.send(line)
      }
      stdinDone = true
      arm()
    })().catch(reject)
  })
}

async function* lines(): AsyncGenerator<string> {
  let buf = ""
  const decoder = new TextDecoder()
  for await (const chunk of Bun.stdin.stream()) {
    buf += decoder.decode(chunk, { stream: true })
    let i: number
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) yield line
    }
  }
  if (buf.trim()) yield buf.trim()
}
