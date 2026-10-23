import type { ClientToOwner, Message, OwnerToClient, RoomId, RoomToClient } from "@kiko/protocol"
import { newRoomId } from "@kiko/protocol"
import { OwnerToClient as OwnerFrames } from "@kiko/protocol/schema"
import { Schema } from "effect"

const decodeFrame = Schema.decodeUnknownSync(OwnerFrames)

export type Counters = Record<string, number>
export type Meter = { counters: Counters; billingVersion?: number }

class OwnerSocket {
  readonly frames: OwnerToClient[] = []
  private failure: Error | null = null
  private closed = false
  private readonly waiters = new Set<() => void>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
      try {
        this.frames.push(decodeFrame(JSON.parse(text)))
      } catch (error) {
        this.failure = new Error(
          `invalid frame ${text.slice(0, 200)}\n${error instanceof Error ? error.message : error}`,
        )
      }
      this.wake()
    })
    socket.addEventListener("close", () => {
      this.closed = true
      this.wake()
    })
  }

  static async open(url: URL, token: string): Promise<OwnerSocket> {
    const target = new URL("api/ws", url)
    target.protocol = "ws:"
    const socket = new WebSocket(target, ["kiko", token])
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true })
      socket.addEventListener("error", () => reject(new Error(`cannot connect to ${target}`)), { once: true })
    })
    const owner = new OwnerSocket(socket)
    owner.send({ t: "hello", lastSeq: 0 })
    await owner.until(() => owner.frames.some((frame) => frame.t === "reset" || frame.t === "events"))
    return owner
  }

  send(frame: ClientToOwner): void {
    this.socket.send(JSON.stringify(frame))
  }

  async until(ready: () => boolean): Promise<void> {
    for (;;) {
      if (this.failure) throw this.failure
      if (ready()) return
      if (this.closed) throw new Error(`socket closed. last frames:\n${this.tail()}`)
      await new Promise<void>((resolve) => {
        const done = () => {
          this.waiters.delete(done)
          resolve()
        }
        this.waiters.add(done)
      })
    }
  }

  close(): void {
    this.socket.close()
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter()
  }

  private tail(): string {
    return this.frames
      .slice(-20)
      .map((frame) => `  ${JSON.stringify(frame).slice(0, 300)}`)
      .join("\n")
  }
}

export class Room {
  private cursor = 0

  constructor(
    readonly roomId: RoomId,
    private readonly socket: OwnerSocket,
  ) {}

  frames(): RoomToClient[] {
    return this.socket.frames.flatMap((frame) =>
      frame.t === "room" && frame.roomId === this.roomId ? [frame.frame] : [],
    )
  }

  messages(): Message[] {
    const byId = new Map<string, Message>()
    for (const frame of this.frames()) {
      if (frame.t !== "events") continue
      for (const event of frame.events) if (event.t === "message") byId.set(event.id, event)
    }
    return [...byId.values()].sort((a, b) => a.seq - b.seq)
  }

  errorRows(): Message[] {
    return this.messages().filter((message) => message.event?.kind === "run_error")
  }

  send(text: string): string {
    const clientId = crypto.randomUUID()
    this.socket.send({ t: "room", roomId: this.roomId, frame: { t: "send", clientId, text } })
    return clientId
  }

  async next(match: (frame: RoomToClient) => boolean): Promise<RoomToClient> {
    let found: RoomToClient | undefined
    await this.socket.until(() => {
      const frames = this.frames()
      while (!found && this.cursor < frames.length) {
        const frame = frames[this.cursor++]
        if (frame && match(frame)) found = frame
      }
      return found !== undefined
    })
    return found as RoomToClient
  }

  until(ready: () => boolean): Promise<void> {
    return this.socket.until(ready)
  }

  close(): void {
    this.socket.close()
  }
}

export type Owner = AsyncDisposable & {
  readonly url: URL
  newRoom(title: string): Promise<Room>
  openRoom(roomId: RoomId): Promise<Room>
  post(path: string, body: unknown): Promise<unknown>
  meter(): Promise<Meter>
}

export async function signIn(url: URL, name: string): Promise<Owner> {
  const response = await fetch(new URL("api/auth/dev/session", url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: url.origin },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error(`dev sign-in answered ${response.status}`)
  const { token } = (await response.json()) as { token: string }
  const auth = `Bearer ${token}`
  const sockets: OwnerSocket[] = []
  const connect = async () => {
    const socket = await OwnerSocket.open(url, token)
    sockets.push(socket)
    return socket
  }
  const subscribe = async (socket: OwnerSocket, roomId: RoomId) => {
    socket.send({ t: "subscribe", roomId, lastSeq: 0 })
    const room = new Room(roomId, socket)
    await room.next((frame) => frame.t === "events" || frame.t === "reset")
    return room
  }
  const user = await connect()
  return {
    url,
    async newRoom(title) {
      const roomId = newRoomId()
      user.send({ t: "chat", op: { op: "create", roomId, title } })
      await user.until(() =>
        user.frames.some(
          (frame) =>
            frame.t === "events" && frame.events.some((event) => event.t === "chat" && event.chat.roomId === roomId),
        ),
      )
      return subscribe(await connect(), roomId)
    },
    async openRoom(roomId) {
      return subscribe(await connect(), roomId)
    },
    async post(path, body) {
      const answer = await fetch(new URL(path, url), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify(body),
      })
      if (!answer.ok) throw new Error(`${path} answered ${answer.status}`)
      return answer.json()
    },
    async meter() {
      const answer = await fetch(new URL("api/dev/stats", url), { headers: { authorization: auth } })
      if (!answer.ok) throw new Error(`api/dev/stats answered ${answer.status}`)
      return (await answer.json()) as Meter
    },
    async [Symbol.asyncDispose]() {
      for (const socket of sockets) socket.close()
    },
  }
}

export function idle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
