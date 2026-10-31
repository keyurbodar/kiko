import { basename, isAbsolute, resolve } from "node:path"
import type { Args, Value } from "@kiko/computer/wire"
import { Fail } from "../log"
import { BoundedHistory } from "./history"
import { KEY_NAMES, keyBytes } from "./keys"
import { bunPty, defaultCwd, defaultShell, type Pty, type PtySpawn } from "./pty"
import { createScreen, type Screen } from "./screen"
import { plain, plainTail } from "./text"

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 30
const MAX_TERMINALS = 16
const IDLE_MS = 30 * 60_000
const WAIT_DEFAULT_MS = 30_000
const WAIT_MAX_MS = 120_000
const CLOSE_GRACE_MS = 1_000
const READ_LINES = 200
const READ_CHARS = 64_000

type Timer = ReturnType<typeof setTimeout>

type Waiter = {
  test(screen: string, tail: string): boolean
  settle(matched: boolean, timedOut: boolean, exited: boolean): void
}

type Session = {
  id: string
  name: string
  cwd: string
  shell: string
  cols: number
  rows: number
  status: "running" | "exited"
  exitCode: number | null
  history: BoundedHistory
  screen: Screen
  pty: Pty
  decoder: TextDecoder
  idle: Timer | null
  waiters: Set<Waiter>
  drains: Set<() => void>
  pendingWrites: number
  disposed: boolean
}

export type TerminalOptions = {
  spawn?: PtySpawn
  idleMs?: number
  screen?: (cols: number, rows: number, onReply: (data: string) => void) => Screen
}

export class TerminalManager {
  private readonly sessions = new Map<string, Session>()
  private readonly spawn: PtySpawn
  private readonly idleMs: number
  private readonly makeScreen: NonNullable<TerminalOptions["screen"]>
  private counter = 0

  constructor(options: TerminalOptions = {}) {
    this.spawn = options.spawn ?? bunPty
    this.idleMs = options.idleMs ?? IDLE_MS
    this.makeScreen = options.screen ?? createScreen
  }

  open(args: Args<"terminal_open">): Value<"terminal_open"> {
    if (this.sessions.size >= MAX_TERMINALS)
      throw new Fail({
        code: "busy",
        message: `this computer already has ${MAX_TERMINALS} terminals open; close one with terminal_close first`,
      })
    const shell = args.shell?.trim() || defaultShell()
    const cwd = resolve(args.cwd ? expandHome(args.cwd) : defaultCwd())
    const cols = args.cols ?? DEFAULT_COLS
    const rows = args.rows ?? DEFAULT_ROWS
    const id = crypto.randomUUID()
    this.counter += 1
    const name = (args.name?.trim() || `${basename(shell)} ${this.counter}`).slice(0, 60)
    let session: Session | undefined
    const screen = this.makeScreen(cols, rows, (data) => session?.pty.write(data))
    let pty: Pty
    try {
      pty = this.spawn({
        command: [shell],
        cwd,
        cols,
        rows,
        onData: (chunk) => {
          if (session) this.receive(session, chunk)
        },
        onExit: (code) => {
          if (session) this.exited(session, code)
        },
      })
    } catch (error) {
      screen.dispose()
      throw new Fail({
        code: "failed",
        message: `could not start ${shell} in ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    const created: Session = {
      id,
      name,
      cwd,
      shell,
      cols,
      rows,
      status: "running",
      exitCode: null,
      history: new BoundedHistory(),
      screen,
      pty,
      decoder: new TextDecoder(),
      idle: null,
      waiters: new Set(),
      drains: new Set(),
      pendingWrites: 0,
      disposed: false,
    }
    session = created
    this.sessions.set(id, created)
    this.scheduleIdle(created)
    return this.info(created)
  }

  send(args: Args<"terminal_send">): Value<"terminal_send"> {
    const session = this.get(args.id)
    const keys = args.keys ?? []
    if (args.text === undefined && keys.length === 0)
      throw new Fail({ code: "failed", message: "terminal_send needs text, keys, or both" })
    let payload = args.text ?? ""
    for (const key of keys) {
      const bytes = keyBytes(key)
      if (bytes === null)
        throw new Fail({
          code: "failed",
          message: `terminal_send does not know the key ${key}; use ${KEY_NAMES.join(", ")}`,
        })
      payload += bytes
    }
    session.pty.write(payload)
    this.scheduleIdle(session)
    return { id: session.id, bytes: Buffer.byteLength(payload) }
  }

  async read(args: Args<"terminal_read">): Promise<Value<"terminal_read">> {
    const session = this.get(args.id)
    this.scheduleIdle(session)
    await this.drained(session)
    const { text, truncated } = args.mode === "screen" ? this.screenText(session) : this.tail(session, args.lines)
    return {
      id: session.id,
      mode: args.mode,
      text,
      truncated,
      cols: session.cols,
      rows: session.rows,
      status: session.status,
      exitCode: session.exitCode,
    }
  }

  private drained(session: Session): Promise<void> {
    if (session.pendingWrites === 0 || session.disposed) return Promise.resolve()
    return new Promise((resolve) => session.drains.add(resolve))
  }

  private settleDrains(session: Session): void {
    if (session.pendingWrites > 0) return
    for (const resolve of session.drains) resolve()
    session.drains.clear()
  }

  private screenText(session: Session): { text: string; truncated: boolean } {
    const text = session.screen.text()
    if (text.length <= READ_CHARS) return { text, truncated: false }
    return { text: text.slice(0, READ_CHARS), truncated: true }
  }

  private tail(session: Session, lines = READ_LINES): { text: string; truncated: boolean } {
    const { text, truncated } = session.history.lines(lines)
    const clean = plain(text)
    if (clean.length <= READ_CHARS) return { text: clean, truncated }
    return { text: clean.slice(clean.length - READ_CHARS), truncated: true }
  }

  wait(args: Args<"terminal_wait">, signal?: AbortSignal): Promise<Value<"terminal_wait">> {
    const session = this.get(args.id)
    const matcher = matcherFor(args.until, args.regex === true)
    const timeoutMs = Math.min(Math.max(args.timeoutMs ?? WAIT_DEFAULT_MS, 1_000), WAIT_MAX_MS)
    this.scheduleIdle(session)
    return new Promise((resolve, reject) => {
      let timer: Timer | undefined
      let abort = () => {}
      let waiter: Waiter
      const finish = (matched: boolean, timedOut: boolean, exited: boolean) => {
        session.waiters.delete(waiter)
        if (timer) clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        resolve({ id: session.id, matched, timedOut, exited, text: plainTail(session.history.value()) })
      }
      waiter = {
        test: (screen, tail) => matcher(screen) || matcher(tail),
        settle: (matched, timedOut, exited) => finish(matched, timedOut, exited),
      }
      timer = setTimeout(() => finish(false, true, false), timeoutMs)
      unref(timer)
      abort = () => {
        session.waiters.delete(waiter)
        if (timer) clearTimeout(timer)
        reject(signal?.reason instanceof Error ? signal.reason : new Fail({ code: "cancelled", message: "cancelled" }))
      }
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) {
        abort()
        return
      }
      session.waiters.add(waiter)
      this.poke(session)
    })
  }

  resize(args: Args<"terminal_resize">): Value<"terminal_resize"> {
    const session = this.get(args.id)
    session.cols = args.cols
    session.rows = args.rows
    session.screen.resize(args.cols, args.rows)
    session.pty.resize(args.cols, args.rows)
    this.scheduleIdle(session)
    return { id: session.id, cols: session.cols, rows: session.rows }
  }

  async close(args: Args<"terminal_close">): Promise<Value<"terminal_close">> {
    const session = this.get(args.id)
    this.sessions.delete(session.id)
    if (!session.disposed) {
      session.pty.kill()
      const grace = setTimeout(() => session.pty.close(), CLOSE_GRACE_MS)
      unref(grace)
      await Promise.race([session.pty.exited, sleep(CLOSE_GRACE_MS * 2)])
      clearTimeout(grace)
      this.finish(session)
    }
    return { id: session.id, closed: true }
  }

  list(): Value<"terminal_list"> {
    return { terminals: [...this.sessions.values()].map((session) => this.info(session)) }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.pty.kill()
      this.finish(session)
    }
    this.sessions.clear()
  }

  private get(id: string): Session {
    const session = this.sessions.get(id)
    if (!session) {
      const open = [...this.sessions.values()].map((entry) => entry.id).join(", ")
      throw new Fail({
        code: "failed",
        message: `there is no terminal ${id}${open ? `; the open terminals are ${open}` : "; terminal_list shows the open ones"}`,
      })
    }
    return session
  }

  private info(session: Session): Value<"terminal_open"> {
    return {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      shell: session.shell,
      cols: session.cols,
      rows: session.rows,
      status: session.status,
      exitCode: session.exitCode,
    }
  }

  private receive(session: Session, chunk: Uint8Array): void {
    if (session.disposed) return
    this.feed(session, session.decoder.decode(chunk, { stream: true }))
  }

  private feed(session: Session, text: string): void {
    if (!text) return
    session.history.append(text)
    session.pendingWrites += 1
    session.screen.write(text, () => {
      session.pendingWrites -= 1
      this.settleDrains(session)
      this.poke(session)
    })
  }

  private exited(session: Session, code: number | null): void {
    if (session.disposed) return
    this.feed(session, session.decoder.decode())
    session.status = "exited"
    session.exitCode = code
    this.scheduleIdle(session)
    for (const waiter of session.waiters) waiter.settle(false, false, true)
  }

  private poke(session: Session): void {
    if (session.disposed || session.waiters.size === 0) return
    if (session.pendingWrites > 0) return
    const screen = session.screen.text()
    const tail = plainTail(session.history.value())
    for (const waiter of session.waiters) {
      if (waiter.test(screen, tail)) waiter.settle(true, false, false)
    }
  }

  private scheduleIdle(session: Session): void {
    if (session.idle) clearTimeout(session.idle)
    const timer = setTimeout(() => {
      if (session.waiters.size > 0) {
        this.scheduleIdle(session)
        return
      }
      this.sessions.delete(session.id)
      session.pty.kill()
      this.finish(session)
    }, this.idleMs)
    unref(timer)
    session.idle = timer
  }

  private finish(session: Session): void {
    if (session.disposed) return
    session.disposed = true
    if (session.idle) clearTimeout(session.idle)
    session.idle = null
    for (const resolve of session.drains) resolve()
    session.drains.clear()
    for (const waiter of session.waiters) waiter.settle(false, false, true)
    session.waiters.clear()
    session.screen.dispose()
    session.pty.close()
  }
}

function matcherFor(until: string, regex: boolean): (text: string) => boolean {
  if (!until) throw new Fail({ code: "failed", message: "terminal_wait needs some text to look for" })
  if (!regex) return (text) => text.includes(until)
  let pattern: RegExp
  try {
    pattern = new RegExp(until)
  } catch (error) {
    throw new Fail({
      code: "failed",
      message: `until is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
  return (text) => pattern.test(text)
}

function expandHome(path: string): string {
  if (path === "~") return defaultCwd()
  if (path.startsWith("~/") || path.startsWith("~\\")) return resolve(defaultCwd(), path.slice(2))
  return isAbsolute(path) ? path : resolve(defaultCwd(), path)
}

function unref(timer: Timer): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) (timer as { unref(): void }).unref()
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, ms)
    unref(timer)
  })
}
