import * as Schema from "effect/Schema"
import * as Option from "effect/Option"
import { encodeBinary } from "@kiko/computer/frame"
import { CONNECT_HEADERS, connectMessage, sign } from "@kiko/computer/sign"
import {
  Calls,
  PROTOCOL,
  TERMINAL_OPS,
  ToDaemon,
  type Args,
  type FailCode,
  type FromDaemon,
  type Holder,
  type Op,
  type ToDaemon as Frame,
  type Value,
} from "@kiko/computer/wire"
import type { DriverCall, Page } from "@kiko/computer/driver"
import type { Policy } from "./config"
import type { Driver } from "./driver"
import type { LiveFrames } from "./live"
import { abortReason, Deadline } from "./deadline"
import { splitImages } from "./images"
import { Fail, failureCode, failureMessage, type Logger } from "./log"
import { read, shell, write } from "./ops"
import type { TerminalManager } from "./terminal/manager"
import type { TerminalLink } from "./terminal/link"

const PING_MS = 20_000
const PING = JSON.stringify({ _tag: "Ping" })
const PONGS = new Set(["pong", JSON.stringify({ _tag: "Pong" })])
const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 300_000
const OPEN_TIMEOUT_MS = 20_000
const DEFAULT_DEADLINE_MS = 60_000
const MAX_DEADLINE_MS = 600_000
const SILENT_MS = 2.5 * PING_MS
const RECENT_MAX = 64
const RECENT_MAX_CHARS = 64_000
const RECENT_MS = 120_000
const CLOCK_SKEW_S = 60
const PAUSED = "the owner paused the agent from the kiko menu"
const INPUT_METHODS = new Set<DriverCall["method"]>(["desktop.call", "browser.act", "browser.open"])

export type Endpoint = { url: string; userId: string; pcId: string; protocol: number }

export type Host = {
  endpoint: Endpoint
  key: JsonWebKey
  hello(): string
  policy(): Promise<Policy>
  driver(): Driver | null
  terminal(): TerminalManager | null
  terminals: TerminalLink
  paused(): boolean
  live: LiveFrames
  holder(): Holder
  log: Logger
  onWelcome?(name: string, version: string | undefined): void
  onOffline?(): void
  onIdle?(): void
}

type Call = Extract<Frame, { t: "call" }>
type Result = Extract<FromDaemon, { t: "result" }>
type Held = { at: number; frame: Result }

const decodeFrame = Schema.decodeUnknownOption(ToDaemon)

const elapsedMs = (started: number): number => Math.round(performance.now() - started)

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
  private readonly recent = new Map<string, Held>()
  private stopping = false
  private rejection: Promise<void> | null = null
  private lastInbound = 0
  private welcomed = false
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
    this.cancelAll("the daemon is stopping")
    socket?.close(1000, "daemon stopping")
  }

  private cancelAll(reason: string): void {
    for (const deadline of this.pending.values())
      deadline.controller.abort(new Fail({ code: "cancelled", message: reason }))
    this.pending.clear()
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
        if (socket) this.release(socket)
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
      if (current) this.release(socket)
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
      if (current) this.release(socket)
      if (current && !this.stopping)
        log.warn(`socket closed (${event.code}${event.reason ? `: ${event.reason}` : ""})${closeMeaning(event.code)}`)
      handlers.closed()
    })
    return socket
  }

  private greet(socket: WebSocket, drop: (code: number, reason: string) => void): void {
    this.host.log.info(`connected to ${this.host.endpoint.url}`)
    this.send(this.greeting())
    if (this.ping) clearInterval(this.ping)
    this.ping = setInterval(() => {
      if (this.socket !== socket) return
      if (Date.now() - this.lastInbound > SILENT_MS) return drop(4000, "no pong")
      this.send(PING)
    }, PING_MS)
  }

  private greeting(): string {
    this.prune()
    const hello = JSON.parse(this.host.hello()) as Record<string, unknown>
    return JSON.stringify({ ...hello, resume: { running: [...this.pending.keys()], recent: [...this.recent.keys()] } })
  }

  private prune(at = Date.now()): void {
    for (const [id, held] of this.recent) if (at - held.at > RECENT_MS) this.recent.delete(id)
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
        return this.liveFrame(() => this.host.live.control(frame))
      case "live":
        return this.liveFrame(() => this.host.live.live(frame))
      case "input":
        return this.liveFrame(() => this.host.live.input(frame))
      case "rtc":
        return this.liveFrame(() => this.host.live.rtc(frame))
      case "ack":
        return this.liveFrame(() => this.host.live.ack(frame))
      case "terminal":
        return this.terminalFrame(() => this.host.terminals.open(frame))
      case "terminalInput":
        return this.terminalFrame(() => this.host.terminals.input(frame))
      case "terminalResize":
        return this.terminalFrame(() => this.host.terminals.resize(frame))
      case "terminalAck":
        return this.terminalFrame(() => this.host.terminals.ack(frame))
      case "welcome":
        this.welcomed = true
        this.host.onWelcome?.(frame.name, frame.version)
    }
  }

  private liveFrame(run: () => void): void {
    try {
      run()
    } catch (error) {
      this.host.log.warn(`the live view could not handle a frame: ${failureMessage(error)}`)
    }
  }

  private terminalFrame(run: () => void): void {
    try {
      run()
    } catch (error) {
      this.host.log.warn(`the terminal view could not handle a frame: ${failureMessage(error)}`)
    }
  }

  private async dispatch(frame: Call): Promise<void> {
    const held = this.recall(frame.id)
    if (held) return this.answer(held)
    if (this.pending.has(frame.id)) return
    const context = new Deadline(clampDeadline(frame.deadlineMs))
    this.pending.set(frame.id, context)
    const timer = setTimeout(
      () => context.controller.abort(new Fail({ code: "timeout", message: `${frame.op} ran out of time` })),
      context.budgetMs,
    )
    let result: Result
    const started = performance.now()
    try {
      const args = decodeArgs(frame.op, frame.args)
      const value = await this.execute(frame.op, args, context)
      if (context.aborted) throw abortReason(context.signal)
      result = { t: "result", id: frame.id, ok: true, value: encodeValue(frame.op, value), opMs: elapsedMs(started) }
    } catch (error) {
      result = { t: "result", id: frame.id, ok: false, error: failure(error), opMs: elapsedMs(started) }
    } finally {
      clearTimeout(timer)
      this.pending.delete(frame.id)
      if (this.pending.size === 0) this.host.onIdle?.()
    }
    await this.answer(result)
  }

  private recall(id: string): Result | null {
    const held = this.recent.get(id)
    if (!held) return null
    if (Date.now() - held.at > RECENT_MS) {
      this.recent.delete(id)
      return null
    }
    return held.frame
  }

  private remember(frame: Result): void {
    const at = Date.now()
    this.recent.delete(frame.id)
    this.recent.set(frame.id, { at, frame })
    this.prune(at)
    while (this.recent.size > RECENT_MAX) {
      const oldest = this.recent.keys().next().value
      if (oldest === undefined) break
      this.recent.delete(oldest)
    }
  }

  private async execute(op: Op, args: unknown, context: Deadline) {
    if (op === "shell") return shell(args as Parameters<typeof shell>[0], await this.host.policy(), context)
    if (op === "read") return read(args as Parameters<typeof read>[0], await this.host.policy(), context)
    if (op === "write") return write(args as Parameters<typeof write>[0], await this.host.policy(), context)
    if (op === "driver") return this.driver(args as DriverCall, context)
    if (op === "browser_steps") return this.browserSteps(args as Args<"browser_steps">, context)
    if (TERMINAL_OPS.has(op)) return this.terminal(op, args, context)
    throw new Fail({ code: "unsupported", message: `${op} is not a call this machine makes` })
  }

  private async terminal(op: Op, args: unknown, context: Deadline): Promise<unknown> {
    const policy = await this.host.policy()
    if (!policy.shell)
      throw new Fail({ code: "denied", message: "policy.json turns off shell commands and terminals on this machine" })
    const terminals = this.host.terminal()
    if (!terminals) throw new Fail({ code: "unsupported", message: "this machine cannot open terminal sessions" })
    if (op === "terminal_send" && this.host.holder() === "human")
      throw new Fail({ code: "busy", message: "the owner has control of this terminal" })
    if (op === "terminal_open") return terminals.open(args as Args<"terminal_open">)
    if (op === "terminal_send") return terminals.send(args as Args<"terminal_send">, context.signal)
    if (op === "terminal_read") return terminals.read(args as Args<"terminal_read">)
    if (op === "terminal_wait") return terminals.wait(args as Args<"terminal_wait">, context.signal)
    if (op === "terminal_resize") return terminals.resize(args as Args<"terminal_resize">)
    if (op === "terminal_close") return terminals.close(args as Args<"terminal_close">)
    return terminals.list()
  }

  private async driver(call: DriverCall, context: Deadline): Promise<unknown> {
    const driver = await this.backgroundDriver(call)
    if (this.host.holder() === "human")
      throw new Fail({ code: "busy", message: "the owner has control of this screen right now" })
    return driver.call(call, context)
  }

  private async backgroundDriver(call: DriverCall): Promise<Driver> {
    const policy = await this.host.policy()
    if (!policy.desktop)
      throw new Fail({ code: "denied", message: "policy.json turns desktop control off on this machine" })
    if (!policy.input && INPUT_METHODS.has(call.method))
      throw new Fail({ code: "denied", message: "policy.json turns input off on this machine" })
    if (this.host.paused()) throw new Fail({ code: "busy", message: PAUSED })
    const driver = this.host.driver()
    if (!driver) throw new Fail({ code: "unsupported", message: "the kiko app is not running on this machine" })
    return driver
  }

  private async browserSteps(args: Args<"browser_steps">, context: Deadline): Promise<Value<"browser_steps">> {
    const driver = await this.backgroundDriver({ method: "browser.act" })
    const outcome = await this.runSteps(driver, args, context)
    if (outcome.stoppedBy !== undefined || !args.read) return outcome
    const page = await driver.call(
      {
        method: "browser.read",
        params: {
          tab: args.tab,
          image: args.image ?? false,
          ...(args.max_width !== undefined ? { max_width: args.max_width } : {}),
        },
      },
      context,
    )
    return { ...outcome, page: page as Page }
  }

  private async runSteps(
    driver: Driver,
    args: Args<"browser_steps">,
    context: Deadline,
  ): Promise<Value<"browser_steps">> {
    let done = 0
    for (const step of args.steps) {
      if (this.host.paused() || this.host.holder() === "human") return { done, stoppedBy: "owner" }
      try {
        await driver.call(
          {
            method: "browser.act",
            params: {
              tab: args.tab,
              ref: step.ref,
              action: step.action,
              ...(args.mode !== undefined ? { mode: args.mode } : {}),
              ...(step.text !== undefined ? { text: step.text } : {}),
            },
          },
          context,
        )
      } catch (error) {
        const reason = failure(error)
        return { done, failed: { index: done, code: reason.code, error: reason.message } }
      }
      done += 1
    }
    return { done }
  }

  private cancel(id: string): void {
    this.pending.get(id)?.controller.abort(new Fail({ code: "cancelled", message: "the agent cancelled this call" }))
  }

  private async answer(
    frame:
      | { t: "result"; id: string; ok: true; value: unknown }
      | { t: "result"; id: string; ok: false; error: { code: FailCode; message: string } },
  ): Promise<void> {
    const split = frame.ok ? await splitImages(frame.value) : null
    if (split) {
      this.binary(
        encodeBinary({ t: "result", id: frame.id, ok: true, value: split.value, parts: split.parts }, split.data),
      )
      return
    }
    const text = JSON.stringify(frame)
    if (text.length <= RECENT_MAX_CHARS) this.remember(frame)
    this.send(text)
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

  private release(socket?: WebSocket): void {
    if (socket !== undefined && socket !== this.socket) return
    if (this.ping) clearInterval(this.ping)
    this.ping = null
    this.socket = null
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
