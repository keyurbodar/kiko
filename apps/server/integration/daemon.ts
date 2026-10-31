import { createHash, randomBytes } from "node:crypto"
import { request as httpRequest } from "node:http"
import type { Duplex } from "node:stream"
import { connectMessage, CONNECT_HEADERS, sign } from "@kiko/computer/sign"
import { PROTOCOL } from "@kiko/computer/wire"
import { Clock, Effect } from "effect"

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const OPEN_MS = "10 seconds"

export const HELLO = {
  t: "hello",
  protocol: PROTOCOL,
  version: "0.0.0-test",
  os: "linux",
  arch: "x64",
  host: "fake-daemon",
  caps: { shell: true, files: true, desktop: false, live: false, input: false },
  displays: [],
}

export type Paired = { id: string; name: string; userId: string }
export type Keys = { publicKey: string; privateKey: JsonWebKey }
export type Frame = Record<string, unknown>

export type Wire = {
  send(text: string): void
  next(message: string): Promise<string>
  take(ready: (frame: Frame) => boolean): Promise<Frame>
  seen(): readonly Frame[]
  close(): void
}

const post = (url: URL, body: unknown) =>
  Effect.tryPromise({
    try: async () => {
      const answer = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!answer.ok) throw new Error(`${url.pathname} answered ${answer.status}: ${await answer.text()}`)
      return (await answer.json()) as Paired
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

export const pair = (origin: URL, code: string, publicKey: string) =>
  post(new URL("api/pc/pair", origin), { code, publicKey, name: "fake daemon", hello: HELLO })

function encode(text: string): Buffer {
  const payload = Buffer.from(text)
  const mask = randomBytes(4)
  const header = Buffer.alloc(payload.length < 126 ? 2 : 4)
  header[0] = 0x81
  if (payload.length < 126) header[1] = 0x80 | payload.length
  else {
    header[1] = 0x80 | 126
    header.writeUInt16BE(payload.length, 2)
  }
  const masked = Buffer.alloc(payload.length)
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i]! ^ mask[i % 4]!
  return Buffer.concat([header, mask, masked])
}

function read(buffer: Buffer, onText: (text: string) => void): Buffer {
  for (;;) {
    if (buffer.length < 2) return buffer
    const opcode = buffer[0]! & 0x0f
    const short = buffer[1]! & 0x7f
    let length = short
    let offset = 2
    if (short === 126) {
      if (buffer.length < 4) return buffer
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (short === 127) {
      if (buffer.length < 10) return buffer
      length = Number(buffer.readBigUInt64BE(2))
      offset = 10
    }
    if (buffer.length < offset + length) return buffer
    const payload = buffer.subarray(offset, offset + length)
    buffer = buffer.subarray(offset + length)
    if (opcode === 0x1) onText(payload.toString())
  }
}

function wire(socket: Duplex, head: Buffer): Wire {
  let buffer = head
  const messages: string[] = []
  const frames: Frame[] = []
  let failure: Error | null = null
  let wake: (() => void) | null = null
  const wakeUp = () => {
    const next = wake
    wake = null
    next?.()
  }
  socket.on("data", (chunk: Buffer) => {
    buffer = read(Buffer.concat([buffer, chunk]), (text) => {
      messages.push(text)
      frames.push(JSON.parse(text) as Frame)
      wakeUp()
    })
  })
  socket.on("close", () => {
    failure = new Error("the worker closed the socket")
    wakeUp()
  })
  socket.on("error", (error) => {
    failure = error
    wakeUp()
  })
  return {
    send: (text) => socket.write(encode(text)),
    next: (message) =>
      new Promise((resolve, reject) => {
        const check = () => {
          if (failure) return reject(failure)
          const at = messages.indexOf(message)
          if (at >= 0) {
            messages.splice(at, 1)
            resolve(message)
            return
          }
          wake = check
        }
        check()
      }),
    take: (ready) =>
      new Promise((resolve, reject) => {
        const check = () => {
          if (failure) return reject(failure)
          const found = frames.find(ready)
          if (found) {
            resolve(found)
            return
          }
          wake = check
        }
        check()
      }),
    seen: () => frames,
    close: () => socket.destroy(),
  }
}

function dial(target: URL, headers: Record<string, string>): Promise<Wire> {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64")
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
        ...headers,
      },
    })
    request.on("upgrade", (response, socket, head) => {
      const accept = createHash("sha1").update(`${key}${GUID}`).digest("base64")
      if (response.headers["sec-websocket-accept"] !== accept) {
        socket.destroy()
        reject(new Error("the worker did not finish the websocket handshake"))
        return
      }
      resolve(wire(socket, head))
    })
    request.on("response", (response) => reject(new Error(`connect answered ${response.statusCode}`)))
    request.on("error", reject)
    request.end()
  })
}

export const connectDaemon = (url: URL, paired: Pick<Paired, "id" | "userId">, keys: Keys) =>
  Effect.gen(function* () {
    const ts = yield* Clock.currentTimeMillis
    const signature = yield* Effect.promise(() =>
      sign(keys.privateKey, connectMessage(paired.userId, paired.id, ts, PROTOCOL)),
    )
    const target = new URL("api/pc/connect", url)
    target.protocol = "ws:"
    return yield* Effect.promise(() =>
      dial(target, {
        [CONNECT_HEADERS.user]: paired.userId,
        [CONNECT_HEADERS.id]: paired.id,
        [CONNECT_HEADERS.ts]: String(ts),
        [CONNECT_HEADERS.sig]: signature,
        [CONNECT_HEADERS.protocol]: String(PROTOCOL),
      }),
    ).pipe(
      Effect.timeoutOrElse({
        duration: OPEN_MS,
        orElse: () => Effect.fail(new Error("the pc socket did not open")),
      }),
    )
  })
