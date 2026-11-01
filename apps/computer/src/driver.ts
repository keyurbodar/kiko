import { connect, type Socket } from "node:net"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  DriverResponse,
  Status,
  type BrowserStatus,
  type DriverCall,
  type Grant,
  type Permissions,
} from "@kiko/computer/driver"
import type { FailCode } from "@kiko/computer/wire"
import { abortReason, type Deadline } from "./deadline"
import { Fail, type Logger } from "./log"

const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
const STATUS_POLL_MS = 30_000
const STATUS_TIMEOUT_MS = 10_000

export type DriverState = { permissions: Permissions; browsers: readonly BrowserStatus[] }

export type Scheduler = {
  after(ms: number, run: () => void): () => void
  repeat(ms: number, run: () => void): () => void
}

export type DriverOptions = {
  path: string
  log: Logger
  onChange?: () => void
  scheduler?: Scheduler
}

export type Driver = {
  call(call: DriverCall, deadline: Deadline): Promise<unknown>
  state(): DriverState | null
  background(): boolean
  browser(): boolean
  close(): void
}

type Pending = {
  resolve(value: unknown): void
  reject(error: Fail): void
  stop(): void
}

const decodeResponse = Schema.decodeUnknownOption(DriverResponse)
const decodeStatus = Schema.decodeUnknownOption(Status)

const system: Scheduler = {
  after: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  },
  repeat: (ms, run) => {
    const timer = setInterval(run, ms)
    return () => clearInterval(timer)
  },
}

const CODES: Readonly<Record<string, FailCode>> = {
  denied: "denied",
  background_unavailable: "unsupported",
  stale: "stale",
  not_found: "failed",
  timeout: "timeout",
  unsupported: "unsupported",
  failed: "failed",
}

const NOT_CONNECTED = "the kiko app is not connected, so background work is off"

function failOf(error: { code: string; message: string }): Fail {
  return new Fail({
    code: CODES[error.code] ?? "failed",
    message: error.code === "background_unavailable" ? `background_unavailable: ${error.message}` : error.message,
  })
}

function permitted(grant: Grant): boolean {
  return grant === "granted" || grant === "not_needed"
}

function endpoint(path: string): string {
  if (process.platform !== "win32" || path.startsWith("\\\\")) return path
  return `\\\\.\\pipe\\${path}`
}

function allGranted(status: Status | null): boolean {
  if (!status) return false
  return (
    permitted(status.permissions.accessibility) &&
    permitted(status.permissions.screen) &&
    permitted(status.permissions.automation)
  )
}

class Client implements Driver {
  private socket: Socket | null = null
  private buffer = ""
  private nextId = 1
  private pending = new Map<number, Pending>()
  private status: Status | null = null
  private connected = false
  private attempt = 0
  private closed = false
  private retry: (() => void) | null = null
  private poll: (() => void) | null = null
  private snapshot = ""

  constructor(
    private readonly options: DriverOptions,
    private readonly scheduler: Scheduler,
  ) {}

  start(): void {
    this.open()
  }

  state(): DriverState | null {
    if (!this.status) return null
    return { permissions: this.status.permissions, browsers: this.status.browsers }
  }

  background(): boolean {
    const permissions = this.status?.permissions
    return this.connected && permissions !== undefined && permitted(permissions.accessibility)
  }

  browser(): boolean {
    return this.connected && (this.status?.browsers.some((browser) => browser.state === "connected") ?? false)
  }

  call(call: DriverCall, deadline: Deadline): Promise<unknown> {
    if (!this.connected) return Promise.reject(new Fail({ code: "unsupported", message: NOT_CONNECTED }))
    return this.request(call, Math.max(1, deadline.remaining()), deadline.signal)
  }

  close(): void {
    this.closed = true
    this.stopPoll()
    this.retry?.()
    this.retry = null
    const socket = this.socket
    this.socket = null
    this.connected = false
    socket?.destroy()
    this.rejectAll(new Fail({ code: "failed", message: "the daemon is stopping" }))
  }

  private open(): void {
    if (this.closed || this.socket) return
    const socket = connect(endpoint(this.options.path))
    this.socket = socket
    this.buffer = ""
    socket.setEncoding("utf8")
    socket.on("connect", () => {
      this.attempt = 0
      this.connected = true
      this.changed()
      void this.refresh()
    })
    socket.on("data", (chunk: string) => this.receive(chunk))
    socket.on("error", (error: Error) => this.options.log.warn(`the kiko app: ${error.message}`))
    socket.on("close", () => this.lost(socket))
  }

  private lost(socket: Socket): void {
    if (this.socket !== socket) return
    this.socket = null
    this.connected = false
    this.buffer = ""
    this.status = null
    this.stopPoll()
    this.rejectAll(new Fail({ code: "failed", message: "the kiko app stopped answering" }))
    this.schedule()
    this.changed()
  }

  private schedule(): void {
    if (this.closed || this.retry) return
    const wait = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** this.attempt)
    this.attempt += 1
    this.options.log.info(
      `the kiko app is not reachable at ${this.options.path}; retrying in ${Math.round(wait / 1000)}s`,
    )
    this.retry = this.scheduler.after(wait, () => {
      this.retry = null
      this.open()
    })
  }

  private changed(): void {
    const snapshot = JSON.stringify({ connected: this.connected, status: this.status })
    if (snapshot === this.snapshot) return
    this.snapshot = snapshot
    this.options.onChange?.()
  }

  private async refresh(): Promise<void> {
    if (!this.connected) return
    const value = await this.request({ method: "status" }, STATUS_TIMEOUT_MS).catch(() => null)
    if (!this.connected) return
    if (value !== null) {
      const status = decodeStatus(value)
      if (Option.isSome(status)) this.status = status.value
    }
    this.changed()
    this.syncPoll()
  }

  private syncPoll(): void {
    const wanted = this.connected && !allGranted(this.status)
    if (wanted && !this.poll) this.poll = this.scheduler.repeat(STATUS_POLL_MS, () => void this.refresh())
    else if (!wanted) this.stopPoll()
  }

  private stopPoll(): void {
    this.poll?.()
    this.poll = null
  }

  private request(call: DriverCall, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = this.socket
      if (!socket || !this.connected) {
        reject(new Fail({ code: "unsupported", message: NOT_CONNECTED }))
        return
      }
      if (signal?.aborted) {
        reject(abortReason(signal))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(
        () => this.settle(id, new Fail({ code: "timeout", message: "the kiko app did not answer in time" })),
        timeoutMs,
      )
      const abort = () => {
        if (signal) this.settle(id, abortReason(signal))
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.pending.set(id, {
        resolve,
        reject,
        stop: () => {
          clearTimeout(timer)
          signal?.removeEventListener("abort", abort)
        },
      })
      try {
        socket.write(`${JSON.stringify({ id, ...call })}\n`)
      } catch (error) {
        this.settle(id, new Fail({ code: "failed", message: error instanceof Error ? error.message : String(error) }))
      }
    })
  }

  private settle(id: number, error: Fail): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    pending.stop()
    pending.reject(error)
  }

  private rejectAll(error: Fail): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const entry of pending) {
      entry.stop()
      entry.reject(error)
    }
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf("\n")
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      this.deliver(line)
      index = this.buffer.indexOf("\n")
    }
  }

  private deliver(line: string): void {
    if (line.trim() === "") return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    const decoded = decodeResponse(parsed)
    if (Option.isNone(decoded)) return
    const response = decoded.value
    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    pending.stop()
    if (response.ok) pending.resolve(response.value)
    else pending.reject(failOf(response.error))
  }
}

export function startDriver(options: DriverOptions): Driver {
  const client = new Client(options, options.scheduler ?? system)
  client.start()
  return client
}
