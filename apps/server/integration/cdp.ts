import { createHash } from "node:crypto"
import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import type { Duplex } from "node:stream"

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const PAGE = JSON.stringify({
  key: "page",
  url: "https://one.example/",
  title: "One",
  controls: [{ id: 1, role: "button", label: "Go" }],
  text: "hello from the fake page",
  omitted: 0,
})

type Message = { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string }

type Cdp = { url: string; close(): Promise<void> }

function reply(message: Message, nextTarget: () => string): unknown {
  switch (message.method) {
    case "Target.createTarget":
      return { targetId: nextTarget() }
    case "Target.attachToTarget":
      return { sessionId: "s1" }
    case "Target.getTargets":
      return { targetInfos: [{ targetId: "t1", type: "page", url: "about:blank", title: "" }] }
    case "Target.closeTarget":
      return { success: true }
    case "Page.getNavigationHistory":
      return { currentIndex: 0, entries: [{ id: 1, url: "about:blank" }] }
    case "Page.getLayoutMetrics":
      return {
        cssVisualViewport: { clientWidth: 1280, clientHeight: 800, pageX: 0, pageY: 0, scale: 1 },
        cssContentSize: { x: 0, y: 0, width: 1280, height: 800 },
        contentSize: { x: 0, y: 0, width: 1280, height: 800 },
      }
    case "Page.captureScreenshot":
      return { data: "AAAA" }
    case "Runtime.evaluate":
      return { result: { value: valueOf(String(message.params?.expression ?? "")) } }
    default:
      return {}
  }
}

function valueOf(expression: string): unknown {
  if (expression.includes("(async () => {")) return PAGE
  if (expression.includes("els.get(")) return { status: "ok", x: 10, y: 10, label: "Go", menu: false }
  if (expression.includes("document.body ? document.body.innerText")) return "hello from the fake page"
  return true
}

function acceptKey(key: string): string {
  return createHash("sha1").update(`${key}${GUID}`).digest("base64")
}

function frame(text: string): Buffer {
  const payload = Buffer.from(text)
  const header = Buffer.alloc(payload.length < 126 ? 2 : 4)
  header[0] = 0x81
  if (payload.length < 126) header[1] = payload.length
  else {
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  }
  return Buffer.concat([header, payload])
}

function read(buffer: Buffer, onText: (text: string) => void): Buffer {
  for (;;) {
    if (buffer.length < 2) return buffer
    const opcode = buffer[0]! & 0x0f
    const masked = (buffer[1]! & 0x80) !== 0
    let length = buffer[1]! & 0x7f
    let offset = 2
    if (length === 126) {
      if (buffer.length < 4) return buffer
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (buffer.length < 10) return buffer
      length = Number(buffer.readBigUInt64BE(2))
      offset = 10
    }
    const maskAt = offset
    if (masked) offset += 4
    if (buffer.length < offset + length) return buffer
    const payload = Buffer.from(buffer.subarray(offset, offset + length))
    if (masked) for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ buffer[maskAt + (i % 4)]!
    buffer = buffer.subarray(offset + length)
    if (opcode === 0x1) onText(payload.toString())
  }
}

function handshake(request: IncomingMessage, socket: Duplex): void {
  const key = request.headers["sec-websocket-key"]
  if (typeof key !== "string") {
    socket.destroy()
    return
  }
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  )
}

export function startCdp(): Promise<Cdp> {
  const sockets = new Set<Duplex>()
  let targets = 0
  const nextTarget = () => `t${++targets}`
  return new Promise((resolve, reject) => {
    const server = createServer((_request, response) => response.writeHead(404).end())
    server.on("upgrade", (request, socket, head) => {
      sockets.add(socket)
      socket.on("close", () => sockets.delete(socket))
      handshake(request, socket)
      let buffer: Buffer = head
      socket.on("data", (chunk: Buffer) => {
        buffer = read(Buffer.concat([buffer, chunk]), (text) => {
          const message = JSON.parse(text) as Message
          if (!message.method || message.id === undefined) return
          socket.write(frame(JSON.stringify({ id: message.id, result: reply(message, nextTarget) })))
          if (message.method === "Page.navigate" || message.method === "Page.reload")
            socket.write(
              frame(
                JSON.stringify({
                  method: "Page.loadEventFired",
                  params: { timestamp: 0 },
                  sessionId: message.sessionId,
                }),
              ),
            )
        })
      })
      socket.on("error", () => {})
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `ws://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          }),
      })
    })
  })
}
