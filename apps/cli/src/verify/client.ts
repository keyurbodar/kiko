import type {
  ClientToRoom as RoomOut,
  ClientToUser as UserOut,
  RoomToClient as RoomIn,
  UserToClient as UserIn,
} from "@kiko/protocol"
import { ClientToRoom, ClientToUser, RoomToClient, UserToClient } from "@kiko/protocol/schema"
import { Schema } from "effect"

export class VerifyError extends Error {}

type Entry = { at: number; dir: "in" | "out" | "bad"; frame: unknown }
type Match<In> = ((f: In) => boolean) | Record<string, unknown>

/** One socket with a frame log. Every received frame is validated against its schema. */
export class Channel<In, Out> {
  readonly log: Entry[] = []
  private socket!: WebSocket
  private cursor = 0
  private failure: VerifyError | null = null
  private waiters = new Set<() => void>()
  private readonly started = Date.now()

  constructor(
    readonly label: string,
    private readonly target: URL,
    private readonly cookie: string,
    private readonly incoming: Schema.Codec<In, unknown>,
    private readonly outgoing: Schema.Codec<Out, unknown>,
    private readonly hello: Out,
  ) {}

  async connect(): Promise<void> {
    this.cursor = this.log.length
    this.failure = null
    const headers = this.cookie ? { cookie: this.cookie } : undefined
    const socket = new WebSocket(this.target, { headers } as never)
    this.socket = socket
    socket.onmessage = (ev) => {
      const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer)
      let frame: unknown = text
      try {
        frame = JSON.parse(text)
        this.log.push({ at: this.now(), dir: "in", frame: Schema.decodeUnknownSync(this.incoming)(frame) })
      } catch (e) {
        this.log.push({ at: this.now(), dir: "bad", frame })
        this.failure = new VerifyError(
          `${this.label}: invalid frame ${text.slice(0, 200)}\n${e instanceof Error ? e.message : e}`,
        )
      }
      this.wake()
    }
    socket.onclose = () => this.wake()
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new VerifyError(`${this.label}: cannot connect to ${this.target}`))
    })
    this.send(this.hello)
  }

  private now() {
    return Date.now() - this.started
  }

  private wake() {
    for (const w of [...this.waiters]) w()
  }

  send(frame: Out): void {
    const wire = Schema.encodeSync(this.outgoing)(frame)
    this.log.push({ at: this.now(), dir: "out", frame })
    this.socket.send(JSON.stringify(wire))
  }

  /** Sends text as is, so a suite can test how the server treats a bad frame. */
  sendRaw(text: string): void {
    this.log.push({ at: this.now(), dir: "out", frame: text })
    this.socket.send(text)
  }

  /**
   * Waits for the next unread frame that matches. Frames are read in order, and a
   * frame that does not match is skipped. `match` is a predicate or a subset object.
   */
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
        const done = () => {
          clearTimeout(timer)
          this.waiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, left)
        this.waiters.add(done)
      })
    }
  }

  /** Passes when no matching frame arrives within `ms`. */
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

  /** Closes the socket, opens a new one, and sends hello again. */
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
      .map((e) => `  ${String(e.at).padStart(6)}ms ${e.dir === "out" ? "->" : e.dir === "in" ? "<-" : "!!"} ${JSON.stringify(e.frame)}`)
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

/** A readable line diff of two values, for expectations on plain data. */
export function diff(expected: unknown, actual: unknown): string {
  const a = JSON.stringify(expected, null, 2).split("\n")
  const b = JSON.stringify(actual, null, 2).split("\n")
  const out: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) out.push(`  ${a[i]}`)
    else {
      if (a[i] !== undefined) out.push(`- ${a[i]}`)
      if (b[i] !== undefined) out.push(`+ ${b[i]}`)
    }
  }
  return out.join("\n")
}

export function expectEqual(actual: unknown, expected: unknown, what = "value"): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new VerifyError(`${what} differs (- expected, + actual)\n${diff(expected, actual)}`)
  }
}

export type UserChannel = Channel<UserIn, UserOut>
export type RoomChannel = Channel<RoomIn, RoomOut>

export interface RoomHandle {
  /** Sends a human message and returns its clientId. */
  send(text: string): string
  expect: RoomChannel["expect"]
  expectNone: RoomChannel["expectNone"]
  reconnect(): Promise<void>
  raw: RoomChannel
}

export interface Session {
  name: string
  userId: string
  cookie: string
  /** Opens the signed-in user's socket, `/api/ws/user`. Use `(await s.user()).expect(...)`. */
  user(): Promise<UserChannel>
  /** Opens the socket for one room, `/api/ws/room/:id`. */
  room(roomId: string): Promise<RoomHandle>
}

export interface Verifier {
  url: string
  /** Signs in as a dev user. The same name is the same user. Sockets open when asked for. */
  as(name: string): Promise<Session>
  closeAll(): void
}

function withSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`
}

/** Signs in through the dev-only route, the same one `kiko login --dev` uses. */
export async function devSession(url: string, name: string): Promise<{ cookie: string; userId: string }> {
  const res = await fetch(new URL("api/auth/dev/session", withSlash(url)), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(5000),
  }).catch((e) => {
    throw new VerifyError(`cannot reach ${url} (${e instanceof Error ? e.message : e})`)
  })
  if (!res.ok) throw new VerifyError(`dev sign-in failed with ${res.status}. start the Worker with NODE_ENV=development`)
  const cookie = res.headers
    .getSetCookie()
    .map((l) => l.split(";", 1)[0] ?? "")
    .join("; ")
  const { user } = (await res.json()) as { user: { id: string } }
  return { cookie, userId: user.id }
}

export function createVerifier(url: string): Verifier {
  const open: { close(): void }[] = []
  const wsUrl = (path: string) => {
    const u = new URL(path, withSlash(url))
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
    return u
  }
  return {
    url,
    async as(name) {
      const { cookie, userId } = await devSession(url, name)
      return {
        name,
        userId,
        cookie,
        async user() {
          const user: UserChannel = new Channel(`${name}/user`, wsUrl("api/ws/user"), cookie, UserToClient, ClientToUser, {
            t: "hello",
            lastSeq: 0,
          })
          open.push(user)
          await user.connect()
          return user
        },
        async room(roomId) {
          const raw: RoomChannel = new Channel(
            `${name}/room ${roomId}`,
            wsUrl(`api/ws/room/${roomId}`),
            cookie,
            RoomToClient,
            ClientToRoom,
            { t: "hello", lastSeq: 0 },
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
      }
    },
    closeAll() {
      for (const c of open) c.close()
    },
  }
}
