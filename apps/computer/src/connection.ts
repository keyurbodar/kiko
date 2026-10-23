import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import { CONNECT_HEADERS, connectMessage, sign } from "@kiko/computer/sign"
import {
  Calls,
  PROTOCOL,
  ToDaemon,
  type FailCode,
  type FromDaemon,
  type Holder,
  type Op,
  type ToDaemon as Frame,
} from "@kiko/computer/wire"
import type { Policy } from "./config"
import type { Desktop } from "./desktop"
import type { LiveFrames } from "./live"
import { Deadline } from "./deadline"
import { Fail, failureCode, failureMessage, type Logger } from "./log"
import { read, shell, write } from "./ops"

const PING_MS = 20_000
const PING = JSON.stringify({ _tag: "Ping" })
const PONGS = new Set(["pong", JSON.stringify({ _tag: "Pong" })])
const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 300_000
const STABLE_MS = 30_000
const DEFAULT_DEADLINE_MS = 60_000
const MAX_DEADLINE_MS = 600_000

export type Endpoint = { url: string; userId: string; pcId: string; protocol: number }

export type Host = {
  endpoint: Endpoint
  key: JsonWebKey
  hello(): string
  policy(): Promise<Policy>
  desktop(): Desktop | null
  live: LiveFrames
  holder(): Holder
  log: Logger
  onWelcome?(name: string): void
}

type Call = Extract<Frame, { t: "call" }>

const decodeFrame = Schema.decodeUnknownOption(ToDaemon)

function decodeArgs(op: Op, raw: unknown): unknown {
  const decoded = Schema.decodeUnknownOption(Calls[op].args)(raw)
  if (Option.isNone(decoded))
    throw new Fail({ code: "failed", message: `the worker sent arguments that ${op} cannot use` })
  return decoded.value
}

function encodeValue(op: Op, value: unknown): unknown {
  const encoder = Schema.encodeSync(Calls[op].value) as (input: unknown) => unknown
  return encoder(value)
}

async function connectHeaders(endpoint: Endpoint, key: JsonWebKey, ts: number): Promise<Record<string, string>> {
  const signature = await sign(key, connectMessage(endpoint.userId, endpoint.pcId, ts, endpoint.protocol))
  return {
    [CONNECT_HEADERS.user]: endpoint.userId,
    [CONNECT_HEADERS.id]: endpoint.pcId,
    [CONNECT_HEADERS.ts]: String(ts),
    [CONNECT_HEADERS.sig]: signature,
    [CONNECT_HEADERS.protocol]: String(endpoint.protocol),
    "user-agent": `kiko-computer/0 (${process.platform})`,
  }
}

function socketUrl(base: string): string {
  const url = new URL("api/pc/connect", base.endsWith("/") ? base : `${base}/`)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function backoffMs(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.max(0, attempt - 1))
  return Math.round(base * (0.5 + Math.random() * 0.5))
}

class Link {
  private socket: WebSocket | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private pending = new Map<string, Deadline>()
  private stopping = false
  private rejection: Promise<void> | null = null
  removed = false

  constructor(private readonly host: Host) {}

  async loop(): Promise<void> {
    let attempt = 0
    while (!this.stopping) {
      const opened = await this.open()
      await this.rejection
      this.rejection = null
      if (this.stopping || this.removed) return
      attempt = opened !== null && Date.now() - opened > STABLE_MS ? 0 : attempt + 1
      const wait = backoffMs(attempt)
      this.host.log.info(`reconnecting in ${Math.round(wait / 1000)}s`)
      await Bun.sleep(wait)
    }
  }

  stop(): void {
    this.stopping = true
    const socket = this.socket
    this.release("the daemon is stopping")
    socket?.close(1000, "daemon stopping")
  }

  private async open(): Promise<number | null> {
    const { endpoint, log } = this.host
    const headers = await connectHeaders(endpoint, this.host.key, Date.now()).catch((error: unknown) => {
      log.error(`cannot sign the connect request: ${failureMessage(error)}`)
      return null
    })
    if (!headers) return null
    const url = socketUrl(endpoint.url)
    return new Promise<number | null>((resolve) => {
      let opened: number | null = null
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve(opened)
      }
      const socket = this.createSocket(url, headers, {
        opened: (at) => {
          opened = at
        },
        closed: finish,
      })
      if (!socket) {
        finish()
        return
      }
      this.socket = socket
    })
  }

  private createSocket(
    url: string,
    headers: Record<string, string>,
    handlers: { opened(at: number): void; closed(): void },
  ): WebSocket | null {
    const { log } = this.host
    let socket: WebSocket
    try {
      socket = new WebSocket(url, { headers } as unknown as string[])
    } catch (error) {
      log.error(`cannot reach ${url}: ${failureMessage(error)}`)
      return null
    }
    socket.addEventListener("open", () => {
      handlers.opened(Date.now())
      this.greet()
    })
    socket.addEventListener("message", (event) => this.receive(event.data))
    socket.addEventListener("error", () => {
      if (this.socket !== socket) return
      this.rejection = this.explainRejection(url, headers)
    })
    socket.addEventListener("close", (event) => {
      this.release("the worker closed the socket")
      if (!this.stopping) log.warn(`socket closed (${event.code}${event.reason ? `: ${event.reason}` : ""})`)
      handlers.closed()
    })
    return socket
  }

  private greet(): void {
    this.host.log.info(`connected to ${this.host.endpoint.url}`)
    this.send(this.host.hello())
    if (this.ping) clearInterval(this.ping)
    this.ping = setInterval(() => this.send(PING), PING_MS)
  }

  private async explainRejection(url: string, headers: Record<string, string>): Promise<void> {
    const { log, endpoint } = this.host
    const probe = url.replace(/^ws/, "http")
    try {
      const response = await fetch(probe, { headers, signal: AbortSignal.timeout(10_000) })
      if (response.status === 410) {
        this.removed = true
        log.error(`${endpoint.url} no longer has this machine; pair it again with kiko-computer pair <url>`)
        return
      }
      const advertised = response.headers.get(CONNECT_HEADERS.protocol)
      if (advertised) {
        log.error(
          `that worker speaks computer protocol ${advertised} and this daemon speaks ${PROTOCOL}; update one of them`,
        )
        return
      }
      log.error(`the worker refused the connection: ${response.status} ${response.statusText}`)
    } catch (error) {
      log.error(`cannot reach ${endpoint.url}: ${failureMessage(error)}`)
    }
  }

  private receive(data: unknown): void {
    if (typeof data !== "string" || PONGS.has(data)) return
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      this.host.log.warn("the worker sent a frame that is not JSON")
      return
    }
    const decoded = decodeFrame(parsed)
    if (Option.isNone(decoded)) {
      this.host.log.warn("the worker sent a frame this daemon does not understand")
      return
    }
    this.route(decoded.value)
  }

  private route(frame: Frame): void {
    switch (frame.t) {
      case "call":
        void this.dispatch(frame)
        return
      case "cancel":
        this.cancel(frame.id)
        return
      case "control":
        return this.host.live.control(frame)
      case "live":
        return this.host.live.live(frame)
      case "input":
        return this.host.live.input(frame)
      case "rtc":
        return this.host.live.rtc(frame)
      case "ack":
        return this.host.live.ack(frame)
      case "welcome":
        this.host.onWelcome?.(frame.name)
    }
  }

  private async dispatch(frame: Call): Promise<void> {
    const context = new Deadline(clampDeadline(frame.deadlineMs))
    this.pending.set(frame.id, context)
    const timer = setTimeout(
      () => context.controller.abort(new Fail({ code: "timeout", message: `${frame.op} ran out of time` })),
      context.budgetMs,
    )
    try {
      const value = await this.execute(frame.op, decodeArgs(frame.op, frame.args), context)
      this.answer({ t: "result", id: frame.id, ok: true, value: encodeValue(frame.op, value) })
    } catch (error) {
      this.answer({ t: "result", id: frame.id, ok: false, error: failure(error) })
    } finally {
      clearTimeout(timer)
      this.pending.delete(frame.id)
    }
  }

  private async execute(op: Op, args: unknown, context: Deadline) {
    if (op === "shell") return shell(args as Parameters<typeof shell>[0], await this.host.policy(), context)
    if (op === "read") return read(args as Parameters<typeof read>[0], await this.host.policy())
    if (op === "write") return write(args as Parameters<typeof write>[0], await this.host.policy())
    const desktop = await this.desktop(op)
    if (op === "look") return desktop.look(args as Parameters<Desktop["look"]>[0], context)
    return desktop.act(args as Parameters<Desktop["act"]>[0], context)
  }

  private async desktop(op: Op): Promise<Desktop> {
    const machine = this.host.desktop()
    if (!machine) throw new Fail({ code: "unsupported", message: "this machine has no desktop to look at or act on" })
    const policy = await this.host.policy()
    if (!policy.desktop)
      throw new Fail({ code: "denied", message: "policy.json turns desktop control off on this machine" })
    if (op === "act" && !policy.input)
      throw new Fail({ code: "denied", message: "policy.json turns input off on this machine" })
    if (op === "act" && this.host.holder() === "human") {
      throw new Fail({ code: "denied", message: "the owner has control of this screen right now" })
    }
    return machine
  }

  private cancel(id: string): void {
    this.pending.get(id)?.controller.abort(new Fail({ code: "cancelled", message: "the agent cancelled this call" }))
  }

  private answer(
    frame:
      | { t: "result"; id: string; ok: true; value: unknown }
      | { t: "result"; id: string; ok: false; error: { code: FailCode; message: string } },
  ): void {
    this.send(JSON.stringify(frame))
  }

  frame(frame: FromDaemon): void {
    this.send(JSON.stringify(frame))
  }

  binary(bytes: Uint8Array<ArrayBuffer>): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(bytes)
  }

  private send(payload: string): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(payload)
    } catch (error) {
      this.host.log.warn(`cannot send to the worker: ${failureMessage(error)}`)
    }
  }

  private release(reason: string): void {
    if (this.ping) clearInterval(this.ping)
    this.ping = null
    this.socket = null
    for (const deadline of this.pending.values())
      deadline.controller.abort(new Fail({ code: "failed", message: reason }))
    this.pending.clear()
  }
}

export function runLink(host: Host): Link {
  return new Link(host)
}

export type { Link }

function failure(error: unknown): { code: FailCode; message: string } {
  return { code: failureCode(error), message: failureMessage(error) }
}

function clampDeadline(deadlineMs: number): number {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return DEFAULT_DEADLINE_MS
  return Math.max(1_000, Math.min(deadlineMs, MAX_DEADLINE_MS))
}
