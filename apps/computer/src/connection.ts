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
import type { DriverCall } from "@kiko/computer/driver"
import type { Policy } from "./config"
import type { Desktop } from "./desktop"
import type { Driver } from "./driver"
import type { LiveFrames } from "./live"
import { Deadline } from "./deadline"
import { Fail, failureCode, failureMessage, type Logger } from "./log"
import { read, shell, write } from "./ops"

const PING_MS = 20_000
const PING = JSON.stringify({ _tag: "Ping" })
const PONGS = new Set(["pong", JSON.stringify({ _tag: "Pong" })])
const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 300_000
const OPEN_TIMEOUT_MS = 20_000
const DEFAULT_DEADLINE_MS = 60_000
const MAX_DEADLINE_MS = 600_000
const SILENT_MS = 2.5 * PING_MS
const CLOCK_SKEW_S = 60
const PAUSED = "the owner paused the agent from the kiko menu"

export type Endpoint = { url: string; userId: string; pcId: string; protocol: number }

export type Host = {
  endpoint: Endpoint
  key: JsonWebKey
  hello(): string
  policy(): Promise<Policy>
  desktop(): Desktop | null
  driver(): Driver | null
  paused(): boolean
  live: LiveFrames
  holder(): Holder
  log: Logger
  onWelcome?(name: string, version: string | undefined): void
  onOffline?(): void
  onWorking?(app: string): void
  onIdle?(): void
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function rememberWindow(windows: Map<string, string>, value: unknown): string | null {
  const window = record(value)
  if (!window || typeof window.id !== "string" || typeof window.app !== "string") return null
  windows.set(window.id, window.app)
  return window.app
}

function openedApp(args: unknown): string | null {
  const steps = record(args)?.steps
  if (!Array.isArray(steps)) return null
  for (const step of steps) {
    const opened = record(step)
    if (opened?.op === "open" && typeof opened.app === "string") return opened.app
  }
  return null
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

function closeMeaning(code: number): string {
  if (code === 4001) return " (that worker speaks a different computer protocol; update one of them)"
  if (code === 1008) return " (that worker was not ready for this daemon; update the worker)"
  return ""
}

class Link {
  private socket: WebSocket | null = null
  private ping: ReturnType<typeof setInterval> | null = null
  private pending = new Map<string, Deadline>()
  private stopping = false
  private rejection: Promise<void> | null = null
  private lastInbound = 0
  private welcomed = false
  private readonly windowApps = new Map<string, string>()
  private readonly drops = new WeakMap<WebSocket, (code: number, reason: string) => void>()
  removed = false

  constructor(private readonly host: Host) {}

  async loop(): Promise<void> {
    let attempt = 0
    while (!this.stopping) {
      await this.open()
      await this.rejection
      this.rejection = null
      if (this.stopping || this.removed) return
      attempt = this.welcomed ? 0 : attempt + 1
      const wait = backoffMs(attempt)
      this.host.log.info(`reconnecting in ${Math.round(wait / 1000)}s`)
      await Bun.sleep(wait)
    }
  }

  busy(): boolean {
    return this.pending.size > 0
  }

  reconnect(): void {
    const socket = this.socket
    if (!socket) return
    this.drops.get(socket)?.(4002, "capabilities changed")
  }

  stop(): void {
    this.stopping = true
    const socket = this.socket
    this.release("the daemon is stopping")
    socket?.close(1000, "daemon stopping")
  }

  private async open(): Promise<void> {
    const { endpoint, log } = this.host
    const headers = await connectHeaders(endpoint, this.host.key, Date.now()).catch((error: unknown) => {
      log.error(`cannot sign the connect request: ${failureMessage(error)}`)
      return null
    })
    if (!headers) return
    const url = socketUrl(endpoint.url)
    this.welcomed = false
    return new Promise<void>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let socket: WebSocket | null = null
      const finish = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        timer = null
        resolve()
      }
      timer = setTimeout(() => {
        log.warn(`no answer from ${endpoint.url} after ${OPEN_TIMEOUT_MS / 1000}s; retrying`)
        try {
          socket?.close(4000, "connect timed out")
        } catch {}
        if (socket) this.release("the worker did not answer", socket)
        finish()
      }, OPEN_TIMEOUT_MS)
      socket = this.createSocket(url, headers, {
        opened: () => {
          if (timer) clearTimeout(timer)
          timer = null
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
    handlers: { opened(): void; closed(): void },
  ): WebSocket | null {
    const { log } = this.host
    let socket: WebSocket
    try {
      socket = new WebSocket(url, { headers } as unknown as string[])
    } catch (error) {
      log.error(`cannot reach ${url}: ${failureMessage(error)}`)
      return null
    }
    const drop = (code: number, reason: string) => {
      const current = this.socket === socket
      try {
        socket.close(code, reason)
      } catch {}
      if (current) this.release("the daemon lost the worker", socket)
      if (current && !this.stopping)
        log.warn(`socket closed (${code}${reason ? `: ${reason}` : ""})${closeMeaning(code)}`)
      handlers.closed()
    }
    this.drops.set(socket, drop)
    socket.addEventListener("open", () => {
      handlers.opened()
      if (this.socket !== socket) return
      this.lastInbound = Date.now()
      this.greet(socket, drop)
    })
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return
      this.receive(event.data)
    })
    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        handlers.closed()
        return
      }
      this.rejection = this.explainRejection(url)
      drop(4000, "socket error")
    })
    socket.addEventListener("close", (event) => {
      const current = this.socket === socket
      if (current) this.release("the worker closed the socket", socket)
      if (current && !this.stopping)
        log.warn(`socket closed (${event.code}${event.reason ? `: ${event.reason}` : ""})${closeMeaning(event.code)}`)
      handlers.closed()
    })
    return socket
  }

  private greet(socket: WebSocket, drop: (code: number, reason: string) => void): void {
    this.host.log.info(`connected to ${this.host.endpoint.url}`)
    this.send(this.host.hello())
    if (this.ping) clearInterval(this.ping)
    this.ping = setInterval(() => {
      if (this.socket !== socket) return
      if (Date.now() - this.lastInbound > SILENT_MS) return drop(4000, "no pong")
      this.send(PING)
    }, PING_MS)
  }

  private async explainRejection(url: string): Promise<void> {
    const { log, endpoint } = this.host
    const probe = url.replace(/^ws/, "http")
    const headers = await connectHeaders(endpoint, this.host.key, Date.now()).catch(() => null)
    if (!headers) return
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
      if (response.status === 401) {
        const server = Date.parse(response.headers.get("date") ?? "")
        const off = Number.isFinite(server) ? Math.round((Date.now() - server) / 1000) : 0
        if (Math.abs(off) > CLOCK_SKEW_S)
          log.error(`this machine's clock is ${off}s off the worker's; fix the system time`)
      }
      log.error(`the worker refused the connection: ${response.status} ${response.statusText}`)
    } catch (error) {
      log.error(`cannot reach ${endpoint.url}: ${failureMessage(error)}`)
    }
  }

  private receive(data: unknown): void {
    this.lastInbound = Date.now()
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
        this.welcomed = true
        this.host.onWelcome?.(frame.name, frame.version)
    }
  }

  private async dispatch(frame: Call): Promise<void> {
    const context = new Deadline(clampDeadline(frame.deadlineMs))
    this.pending.set(frame.id, context)
    const args = decodeArgs(frame.op, frame.args)
    const timer = setTimeout(
      () => context.controller.abort(new Fail({ code: "timeout", message: `${frame.op} ran out of time` })),
      context.budgetMs,
    )
    try {
      const value = await this.execute(frame.op, args, context)
      this.working(frame.op, args, value)
      this.answer({ t: "result", id: frame.id, ok: true, value: encodeValue(frame.op, value) })
    } catch (error) {
      this.answer({ t: "result", id: frame.id, ok: false, error: failure(error) })
    } finally {
      clearTimeout(timer)
      this.pending.delete(frame.id)
      if (this.pending.size === 0) this.host.onIdle?.()
    }
  }

  private working(op: Op, args: unknown, value: unknown): void {
    const app = this.appOf(op, args, value)
    if (app !== null) this.host.onWorking?.(app)
  }

  private appOf(op: Op, args: unknown, value: unknown): string | null {
    if (op === "act") return openedApp(args)
    if (op !== "driver") return null
    const call = args as DriverCall
    if (call.method === "windows") {
      for (const window of Array.isArray(value) ? value : []) rememberWindow(this.windowApps, window)
      return null
    }
    if (call.method === "look") return rememberWindow(this.windowApps, record(value)?.window)
    if (call.method === "act") return this.windowApps.get(call.params.window) ?? null
    return null
  }

  private async execute(op: Op, args: unknown, context: Deadline) {
    if (op === "shell") return shell(args as Parameters<typeof shell>[0], await this.host.policy(), context)
    if (op === "read") return read(args as Parameters<typeof read>[0], await this.host.policy())
    if (op === "write") return write(args as Parameters<typeof write>[0], await this.host.policy())
    if (op === "driver") return this.driver(args as DriverCall, context)
    const desktop = await this.desktop(op)
    if (op === "look") return desktop.look(args as Parameters<Desktop["look"]>[0], context)
    return desktop.act(args as Parameters<Desktop["act"]>[0], context)
  }

  private async driver(call: DriverCall, context: Deadline): Promise<unknown> {
    const policy = await this.host.policy()
    if (!policy.desktop)
      throw new Fail({ code: "denied", message: "policy.json turns desktop control off on this machine" })
    if (this.host.paused()) throw new Fail({ code: "busy", message: PAUSED })
    if (this.host.holder() === "human")
      throw new Fail({ code: "busy", message: "the owner has control of this screen right now" })
    const driver = this.host.driver()
    if (!driver) throw new Fail({ code: "unsupported", message: "the kiko app is not running on this machine" })
    return driver.call(call, context)
  }

  private async desktop(op: Op): Promise<Desktop> {
    const machine = this.host.desktop()
    if (!machine) throw new Fail({ code: "unsupported", message: "this machine has no desktop to look at or act on" })
    const policy = await this.host.policy()
    if (!policy.desktop)
      throw new Fail({ code: "denied", message: "policy.json turns desktop control off on this machine" })
    if (op === "act" && !policy.input)
      throw new Fail({ code: "denied", message: "policy.json turns input off on this machine" })
    if (this.host.paused()) throw new Fail({ code: "busy", message: PAUSED })
    if (op === "act" && this.host.holder() === "human") {
      throw new Fail({ code: "busy", message: "the owner has control of this screen right now" })
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
      this.drops.get(socket)?.(4000, "cannot send")
    }
  }

  private release(reason: string, socket?: WebSocket): void {
    if (socket !== undefined && socket !== this.socket) return
    if (this.ping) clearInterval(this.ping)
    this.ping = null
    this.socket = null
    for (const deadline of this.pending.values())
      deadline.controller.abort(new Fail({ code: "failed", message: reason }))
    this.pending.clear()
    this.host.onOffline?.()
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
