import type {
  ClientToRoom as RoomOut,
  ClientToUser as UserOut,
  RoomToClient as RoomIn,
  UserToClient as UserIn,
} from "@kiko/protocol"
import { ClientToRoom, ClientToUser, OwnerToClient, RoomToClient, UserToClient } from "@kiko/protocol/schema"
import { Schema } from "effect"

export class VerifyError extends Error {}

type Entry = { at: number; dir: "in" | "out" | "bad"; frame: unknown }
type Match<In> = ((f: In) => boolean) | Record<string, unknown>

class Channel<In, Out> {
  readonly log: Entry[] = []
  readonly texts: string[] = []
  private socket!: WebSocket
  private cursor = 0
  private failure: VerifyError | null = null
  private waiters = new Set<() => void>()
  private readonly started = Date.now()

  constructor(
    readonly label: string,
    private readonly target: URL,
    private readonly auth: string,
    private readonly incoming: Schema.Codec<In, unknown>,
    private readonly outgoing: Schema.Codec<Out, unknown>,
    private readonly hello: Out | null,
    private readonly roomId?: string,
  ) {}

  async connect(): Promise<void> {
    this.cursor = this.log.length
    this.failure = null
    const headers = this.auth ? { authorization: this.auth } : undefined
    const socket = new WebSocket(this.target, { headers } as never)
    this.socket = socket
    let ready: (() => void) | undefined
    const userReady = this.roomId
      ? new Promise<void>((resolve) => {
          ready = resolve
        })
      : null
    socket.addEventListener("message", (ev) => {
      const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
      let frame: unknown = text
      this.texts.push(text)
      try {
        frame = JSON.parse(text)
        if (this.roomId) {
          const owner = Schema.decodeUnknownSync(OwnerToClient)(frame)
          if (owner.t !== "room") {
            if (owner.t === "reset" || owner.t === "events") ready?.()
            return
          }
          if (owner.roomId !== this.roomId) return
          frame = owner.frame
        }
        this.log.push({ at: this.now(), dir: "in", frame: Schema.decodeUnknownSync(this.incoming)(frame) })
      } catch (e) {
        this.log.push({ at: this.now(), dir: "bad", frame })
        this.failure = new VerifyError(
          `${this.label}: invalid frame ${text.slice(0, 200)}\n${e instanceof Error ? e.message : e}`,
        )
      }
      this.wake()
    })
    socket.addEventListener("close", () => this.wake())
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve())
      socket.addEventListener("error", () => reject(new VerifyError(`${this.label}: cannot connect to ${this.target}`)))
    })
    if (userReady) {
      socket.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          userReady,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new VerifyError(`${this.label}: user hello timed out`)), 5000)
          }),
        ])
      } catch (error) {
        socket.close()
        throw error
      } finally {
        clearTimeout(timer)
      }
    }
    if (this.hello) this.send(this.hello)
  }

  private now() {
    return Date.now() - this.started
  }

  private wake() {
    for (const w of this.waiters) w()
  }

  send(frame: Out): void {
    const wire = Schema.encodeSync(this.outgoing)(frame)
    this.log.push({ at: this.now(), dir: "out", frame })
    this.socket.send(JSON.stringify(this.envelope(wire)))
  }

  private envelope(wire: unknown): unknown {
    if (!this.roomId) return wire
    if (typeof wire === "object" && wire !== null && "t" in wire && wire.t === "hello") {
      return { t: "subscribe", roomId: this.roomId, lastSeq: "lastSeq" in wire ? wire.lastSeq : 0 }
    }
    return { t: "room", roomId: this.roomId, frame: wire }
  }

  sendRaw(text: string): void {
    this.log.push({ at: this.now(), dir: "out", frame: text })
    if (this.roomId) {
      try {
        text = JSON.stringify(this.envelope(JSON.parse(text)))
      } catch {}
    }
    this.socket.send(text)
  }

  async expect(match: Match<In>, timeout = 5000): Promise<In> {
    const test = typeof match === "function" ? match : (f: In) => subset(match, f)
    const deadline = Date.now() + timeout
    for (;;) {
      if (this.failure) throw this.failure
      while (this.cursor < this.log.length) {
        const entry = this.log[this.cursor++]
        if (entry?.dir === "in" && test(entry.frame as In)) return entry.frame as In
      }
      const left = deadline - Date.now()
      if (left <= 0) throw new VerifyError(this.timeoutMessage(match, timeout))
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const done = () => {
          clearTimeout(timer)
          this.waiters.delete(done)
          resolve()
        }
        timer = setTimeout(done, left)
        this.waiters.add(done)
      })
    }
  }

  async expectNone(match: Match<In>, ms = 300): Promise<void> {
    let frame: In
    try {
      frame = await this.expect(match, ms)
    } catch (e) {
      if (e instanceof VerifyError && e.message.includes("timed out")) return
      throw e
    }
    throw new VerifyError(`${this.label}: got a frame that should not arrive\n${JSON.stringify(frame, null, 2)}`)
  }

  async reconnect(): Promise<void> {
    this.close()
    await this.connect()
  }

  close(): void {
    this.socket?.close()
  }

  private timeoutMessage(match: Match<In>, timeout: number): string {
    const want =
      typeof match === "function" ? `a frame where ${match.toString()}` : `a frame like ${JSON.stringify(match)}`
    const last = this.log
      .slice(-20)
      .map(
        (e) =>
          `  ${String(e.at).padStart(6)}ms ${e.dir === "out" ? "->" : e.dir === "in" ? "<-" : "!!"} ${JSON.stringify(e.frame)}`,
      )
    return [
      `${this.label}: timed out after ${timeout}ms waiting for ${want}`,
      `last ${last.length} frames:`,
      ...(last.length ? last : ["  (none)"]),
    ].join("\n")
  }
}

function subset(want: unknown, got: unknown): boolean {
  if (want && typeof want === "object") {
    if (!got || typeof got !== "object") return false
    return Object.entries(want).every(([k, v]) => subset(v, (got as Record<string, unknown>)[k]))
  }
  return Object.is(want, got)
}

export type UserChannel = Channel<UserIn, UserOut>
export type RoomChannel = Channel<RoomIn, RoomOut>

export interface RoomHandle {
  send(text: string): string
  expect: RoomChannel["expect"]
  expectNone: RoomChannel["expectNone"]
  reconnect(): Promise<void>
  raw: RoomChannel
}

export interface Session {
  name: string
  userId: string
  auth: string
  user(): Promise<UserChannel>
  signInSocket(): Promise<UserChannel>
  room(roomId: string): Promise<RoomHandle>
  connectProvider(provider: string, apiKey: string): Promise<void>
  disconnectProvider(provider: string): Promise<void>
  putFile(roomId: string, path: string, body: BodyInit, options?: { expect?: string; type?: string }): Promise<Response>
}

export interface Verifier {
  url: string
  fake: boolean
  as(name: string): Promise<Session>
  closeAll(): void
}

function withSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`
}

async function devSession(url: string, name: string): Promise<{ auth: string; userId: string }> {
  if (process.env.KIKO_BEARER) return { auth: `Bearer ${process.env.KIKO_BEARER}`, userId: "owner" }
  const code = process.env.KIKO_ACCESS_CODE
  const res = await fetch(new URL(code ? "api/auth/access-code" : "api/auth/dev/session", withSlash(url)), {
    method: "POST",
    headers: { "content-type": "application/json", origin: new URL(url).origin },
    body: JSON.stringify(code ? { code } : { name }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => {
    throw new VerifyError(`cannot reach ${url} (${e instanceof Error ? e.message : e})`)
  })
  if (!res.ok) {
    throw new VerifyError(
      code
        ? `access-code sign-in failed with ${res.status}. check KIKO_ACCESS_CODE`
        : `dev sign-in failed with ${res.status}. start the Worker with NODE_ENV=development`,
    )
  }
  const { user, token } = (await res.json()) as { user: { id: string }; token: string }
  return { auth: `Bearer ${token}`, userId: user.id }
}

export function createVerifier(baseUrl: string, options: { fake?: boolean } = {}): Verifier {
  const url = withSlash(baseUrl)
  const open: { close(): void }[] = []
  async function credentials(auth: string, method: "PUT" | "DELETE", provider: string, body?: unknown): Promise<void> {
    const res = await fetch(new URL(`api/credentials/${provider}`, url), {
      method,
      headers:
        body === undefined ? { authorization: auth } : { authorization: auth, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new VerifyError(`${method} api/credentials/${provider} answered ${res.status}`)
  }
  const wsUrl = (path: string) => {
    const u = new URL(path, url)
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
    return u
  }
  return {
    url,
    fake: options.fake ?? false,
    async as(name) {
      const { auth, userId } = await devSession(url, name)
      return {
        name,
        userId,
        auth,
        async user() {
          const user: UserChannel = new Channel(`${name}/user`, wsUrl("api/ws"), auth, UserToClient, ClientToUser, {
            t: "hello",
            lastSeq: 0,
          })
          open.push(user)
          await user.connect()
          return user
        },
        async signInSocket() {
          const socket: UserChannel = new Channel(
            `${name}/sign-in`,
            wsUrl("api/ws"),
            auth,
            UserToClient,
            ClientToUser,
            null,
          )
          open.push(socket)
          await socket.connect()
          return socket
        },
        async room(roomId) {
          const raw: RoomChannel = new Channel(
            `${name}/room ${roomId}`,
            wsUrl("api/ws"),
            auth,
            RoomToClient,
            ClientToRoom,
            { t: "hello", lastSeq: 0 },
            roomId,
          )
          open.push(raw)
          await raw.connect()
          return {
            raw,
            send(text) {
              const clientId = crypto.randomUUID()
              raw.send({ t: "send", clientId, text })
              return clientId
            },
            expect: raw.expect.bind(raw),
            expectNone: raw.expectNone.bind(raw),
            reconnect: () => raw.reconnect(),
          }
        },
        async connectProvider(provider, apiKey) {
          await credentials(auth, "PUT", provider, { apiKey })
        },
        async disconnectProvider(provider) {
          await credentials(auth, "DELETE", provider)
        },
        putFile(roomId, path, body, options = {}) {
          return fetch(new URL(`api/files/${roomId}?path=${encodeURIComponent(path)}`, url), {
            method: "PUT",
            headers: {
              authorization: auth,
              "content-type": options.type ?? "text/plain",
              "x-kiko-if-sha256": options.expect ?? "none",
            },
            body,
          })
        },
      }
    },
    closeAll() {
      for (const c of open) c.close()
    },
  }
}
