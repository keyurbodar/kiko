import { Schema } from "effect"
import {
  BinaryResult,
  Calls,
  type FailCode,
  type FromDaemon,
  FromDaemon as FromDaemonSchema,
  type Hello,
  type Holder,
  type IceServer,
  type InputEvent,
  type Op,
  OLDEST_PROTOCOL,
  PROTOCOL,
  type RtcSignal,
  TERMINAL_OPS,
  type ToDaemon,
} from "@kiko/computer/wire"
import { CONNECT_HEADERS, CONNECT_SKEW_MS, connectMessage, verify } from "@kiko/computer/sign"
import type { DesktopInfo } from "@kiko/computer/driver"
import { decodeBinary, decodeFrame } from "@kiko/computer/frame"
import type { AgentSlug, ComputerSummary, RoomId, TerminalEvent } from "@kiko/protocol"
import type { Env } from "../index"
import { ago } from "../lib/ago"
import { BACKEND } from "../lib/version"
import { socketView } from "../owner/socket"
import type { RequestId } from "../rpc/wire"
import { joinImages } from "./binary"
import type { ComputerRow, ComputerStore, NewComputer } from "./store"
import { terminalStream, terminalText } from "./terminals"
import type { PcTaken } from "./types"

const HOLD_MS = 30 * 60_000
const HOLD_ACK_MS = 1_500
const PRESENCE_MS = 45_000
const DEFAULT_DEADLINE_MS = 60_000
const BUSY_PUSH_MS = 500
export const MAX_DEADLINE_MS = 10 * 60_000
export const COMPUTER_WAKEUP = "computer_hold"

const BUSY_OPS: ReadonlySet<Op> = new Set<Op>(["shell"])
const DESK_MS = 60_000
const MAX_WAITERS = 8

const STUN: IceServer = { urls: "stun:stun.cloudflare.com:3478" }
const TURN_TTL_S = 3600
const TURN_CACHE_MS = 30 * 60_000
const TURN_TIMEOUT_MS = 5_000
const RELAY = { fps: 15, maxWidth: 1600, quality: 65 } as const
const CLOSE = { replaced: 4000, notReady: 1008, protocol: 4001 } as const
const OFFLINE_WAIT_MS = 5_000

const CLOSE_TEXT: Readonly<Record<number, string>> = {
  1000: "it closed normally",
  1001: "it went away",
  1006: "the network dropped",
  1008: "it was not ready",
  1011: "it hit an internal error",
  4000: "it was replaced by a newer connection",
  4001: "its daemon speaks a different protocol version",
}

function closeText(code?: number, reason?: string): string {
  const sent = reason?.trim().replace(/[.!?]$/, "")
  if (sent) return sent
  if (code === undefined) return "the connection ended"
  return CLOSE_TEXT[code] ?? `it closed with code ${code}`
}

const decodeDaemon = Schema.decodeUnknownSync(FromDaemonSchema)

export type PcAgent = { slug: AgentSlug; roomId: RoomId; reason?: string }

type PcHold = {
  holder: Holder
  heldBy?: string
  heldEpoch?: number
  heldSince?: number
  agent?: PcAgent
  waiters?: PcAgent[]
  hello?: Hello
}

type PcMark = { seenAt?: number; reason?: string; version?: string }

type PairOutcome = { ok: true } | { ok: false; error: string }

type RenameOutcome = { ok: true } | { ok: false; reason: "missing" | "taken"; error: string }

export type PcAttachment = {
  kind: "pc"
  id: string
  hello: Hello | null
  holder: Holder
  heldBy?: string
  heldEpoch?: number
  heldSince?: number
  agent?: PcAgent
  waiters?: PcAgent[]
  at: number
}

type CallTarget = { ws: WebSocket; saved: PcAttachment; hello: Hello }

export type CallOutcome = { ok: true; value: unknown } | { ok: false; code: FailCode; message: string }

export type TerminalAttachOutcome =
  | { ok: true; value: `term:${string}` }
  | { ok: false; code: FailCode; message: string }

export type PcReleased = { pcId: string; name: string; waiters: PcAgent[]; expired: boolean }

type TabAttachment = { pcSession?: string; user?: { pcSession?: string } }

type Pending = {
  pcId: string
  frame: Extract<ToDaemon, { t: "call" }>
  resolve: (outcome: CallOutcome) => void
  timer: ReturnType<typeof setTimeout>
  detach: () => void
}

type TerminalAttach = {
  pcId: string
  terminal: string
  tab: WebSocket
  requestId: RequestId
  stream: string
}

export type HubDeps = {
  ctx: DurableObjectState
  env: Env
  store: ComputerStore
  ownerId: string
  released: (out: PcReleased) => void
  taken: (out: PcTaken) => void
  wakeup: { set(at: number): Promise<void>; clear(): Promise<void> }
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

function attachmentOf(ws: WebSocket): PcAttachment | null {
  const saved = ws.deserializeAttachment() as PcAttachment | null
  return saved?.kind === "pc" && typeof saved.id === "string" ? saved : null
}

function claimsDesk(op: Op, args: unknown): boolean {
  if (op !== "driver") return false
  const call = args as { params?: { mode?: unknown } }
  return call.params?.mode === "foreground"
}

export function pcSocketId(ws: WebSocket): string | null {
  return attachmentOf(ws)?.id ?? null
}

type LiveAttachment = { kind: "live"; pcId: string; want?: boolean }

type LiveMessage =
  | { t: "ack"; seq?: number }
  | { t: "live"; on?: boolean; fps?: number; maxWidth?: number; quality?: number }
  | { t: "screen"; id?: string }

function liveOf(ws: WebSocket): LiveAttachment | null {
  const saved = ws.deserializeAttachment() as LiveAttachment | null
  return saved?.kind === "live" && typeof saved.pcId === "string" ? saved : null
}

function profileOf(message: Extract<LiveMessage, { t: "live" }>): {
  fps?: number
  maxWidth?: number
  quality?: number
} {
  return {
    ...(typeof message.fps === "number" ? { fps: message.fps } : {}),
    ...(typeof message.maxWidth === "number" ? { maxWidth: message.maxWidth } : {}),
    ...(typeof message.quality === "number" ? { quality: message.quality } : {}),
  }
}

export class ComputerHub {
  private readonly pending = new Map<string, Pending>()
  private readonly takes = new Map<string, { epoch: number; settle: (ok: boolean) => void }>()
  private readonly desk = new Map<string, { user: string; name: string; until: number }>()
  private readonly relaying = new Set<string>()
  private readonly profiles = new Map<string, { fps: number; maxWidth: number; quality: number }>()
  private readonly attaches = new Map<string, TerminalAttach>()
  private readonly memory = new Map<string, PcHold>()
  private readonly desktop = new Map<string, DesktopInfo>()
  private readonly marks = new Map<string, PcMark>()
  private readonly arrivals = new Map<string, Set<() => void>>()
  private readonly running = new Map<string, number>()
  private readonly busyPushAt = new Map<string, number>()
  private readonly busyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly sentTo = new WeakMap<WebSocket, string>()
  private readonly heard = new WeakMap<WebSocket, number>()
  private turn?: { at: number; servers: IceServer[] }
  private turning?: Promise<IceServer[]>

  constructor(private readonly d: HubDeps) {}

  rows(): ComputerRow[] {
    return this.d.store.list()
  }

  row(id: string): ComputerRow | null {
    return this.d.store.get(id)
  }

  find(nameOrId: string): ComputerRow | null {
    const all = this.rows()
    const wanted = nameOrId.trim().toLowerCase()
    return all.find((row) => row.id === nameOrId) ?? all.find((row) => row.name.toLowerCase() === wanted) ?? null
  }

  nameOwner(name: string, except?: string): ComputerRow | null {
    const wanted = name.trim().toLowerCase()
    return this.rows().find((row) => row.id !== except && row.name.toLowerCase() === wanted) ?? null
  }

  private sockets(id: string): WebSocket[] {
    return this.d.ctx.getWebSockets(`pc:${id}`)
  }

  private socket(id: string): WebSocket | null {
    return this.sockets(id).find((ws) => ws.readyState === WebSocket.OPEN) ?? null
  }

  private arm(): void {
    const at = this.nextHold()
    void (at === undefined ? this.d.wakeup.clear() : this.d.wakeup.set(at)).catch((e: unknown) =>
      console.error(`computer wakeup failed: ${e instanceof Error ? e.message : String(e)}`),
    )
  }

  private hold(id: string): PcHold {
    const ws = this.socket(id)
    const saved = ws && attachmentOf(ws)
    if (!saved) return this.memory.get(id) ?? { holder: "agent" }
    return {
      holder: saved.holder,
      ...(saved.heldBy ? { heldBy: saved.heldBy } : {}),
      ...(saved.heldEpoch === undefined ? {} : { heldEpoch: saved.heldEpoch }),
      ...(saved.heldSince ? { heldSince: saved.heldSince } : {}),
      ...(saved.agent ? { agent: saved.agent } : {}),
      ...(saved.waiters?.length ? { waiters: saved.waiters } : {}),
      ...(saved.hello ? { hello: saved.hello } : {}),
    }
  }

  private save(id: string, hold: PcHold): void {
    this.memory.set(id, hold)
    const ws = this.socket(id)
    const saved = ws && attachmentOf(ws)
    if (!ws || !saved) return
    ws.serializeAttachment({ ...hold, kind: "pc", id, hello: saved.hello, at: saved.at } satisfies PcAttachment)
  }

  private name(id: string): string {
    return this.d.store.get(id)?.name ?? id
  }

  helloOf(id: string): Hello | null {
    const ws = this.socket(id)
    return (ws && attachmentOf(ws)?.hello) ?? this.memory.get(id)?.hello ?? null
  }

  desktopInfo(id: string): DesktopInfo | null {
    return this.desktop.get(id) ?? this.d.store.desktop(id)
  }

  private rememberDesktop(id: string, info: DesktopInfo | undefined): void {
    if (!info) {
      this.desktop.delete(id)
      return
    }
    this.desktop.set(id, info)
    this.d.store.saveDesktop(id, info)
  }

  holder(id: string): Holder {
    return this.hold(id).holder
  }

  online(id: string): boolean {
    const now = Date.now()
    for (const ws of this.sockets(id)) {
      if (ws.readyState !== WebSocket.OPEN) continue
      const seen = this.d.ctx.getWebSocketAutoResponseTimestamp(ws)
      if (seen && now - seen.getTime() < PRESENCE_MS) return true
      const at = Math.max(attachmentOf(ws)?.at ?? 0, this.heard.get(ws) ?? 0)
      if (now - at < PRESENCE_MS) return true
    }
    return false
  }

  private pause(ms: number): Promise<void> {
    if (this.d.sleep) return this.d.sleep(ms)
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private waitForArrival(id: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        const waiters = this.arrivals.get(id)
        waiters?.delete(finish)
        if (waiters?.size === 0) this.arrivals.delete(id)
        resolve()
      }
      const waiters = this.arrivals.get(id) ?? new Set<() => void>()
      waiters.add(finish)
      this.arrivals.set(id, waiters)
      void this.pause(ms).then(finish)
    })
  }

  private arrived(id: string): void {
    const waiters = this.arrivals.get(id)
    if (!waiters) return
    this.arrivals.delete(id)
    for (const wake of waiters) wake()
  }

  private offlineMessage(row: ComputerRow): string {
    const mark = this.marks.get(row.id) ?? {}
    const version = mark.version ?? this.helloOf(row.id)?.version
    const seen =
      mark.seenAt === undefined
        ? `${row.name} is offline: it has not connected since it was paired`
        : `${row.name} is offline: last seen ${ago(Date.now() - mark.seenAt)}`
    const why = mark.reason ? `, the last connection ended because ${mark.reason}` : ""
    const daemon = version ? `its daemon is ${version}.` : "its daemon version is unknown."
    return `${seen}${why}. ${daemon}`
  }

  private sessionOf(tab: WebSocket): string | undefined {
    const saved = tab.deserializeAttachment() as TabAttachment | null
    return saved?.pcSession ?? saved?.user?.pcSession
  }

  summaries(tab?: WebSocket): ComputerSummary[] {
    const mine = tab && this.sessionOf(tab)
    return this.rows().map((row) => {
      const hold = this.hold(row.id)
      const hello = this.helloOf(row.id)
      const mark = this.marks.get(row.id) ?? {}
      const version = mark.version ?? hello?.version
      const heldBy = tab && hold.heldBy ? (mine === hold.heldBy ? "you" : "other") : undefined
      return {
        id: row.id,
        name: row.name,
        os: row.os,
        online: this.online(row.id),
        caps: hello?.caps ?? this.d.store.caps(row),
        holder: hold.holder,
        busy: this.busy(row.id),
        ...(heldBy ? { heldBy } : {}),
        ...(hold.agent ? { agent: hold.agent } : {}),
        displays: hello?.displays ?? [],
        ...(hello?.access ? { access: hello.access } : {}),
        background: hello?.caps.background ?? false,
        browsers: hello?.driver?.browsers ?? [],
        ...(hello?.note ? { note: hello.note } : {}),
        ...(version ? { version } : {}),
        ...(mark.seenAt === undefined ? {} : { lastSeenAt: mark.seenAt }),
        ...(mark.reason ? { lastCloseReason: mark.reason } : {}),
      }
    })
  }

  sendState(tab: WebSocket): void {
    const text = JSON.stringify({ t: "pcState", computers: this.summaries(tab) })
    if (this.sentTo.get(tab) === text) return
    try {
      if ((tab.send(text) as unknown as boolean | undefined) === false) return
      this.sentTo.set(tab, text)
    } catch {}
  }

  push(): void {
    for (const ws of this.d.ctx.getWebSockets("tab")) {
      if (!(ws.deserializeAttachment() as { user?: { ready?: boolean } } | null)?.user?.ready) continue
      this.sendState(socketView(ws))
    }
  }

  private nameTaken(name: string, owner: ComputerRow): string {
    return `${name} is already the name of another computer (${owner.os}, ${owner.id}). rename that one first, or use a different name.`
  }

  private busy(id: string): boolean {
    return (this.running.get(id) ?? 0) > 0
  }

  private track(id: string, active: boolean): void {
    const before = this.running.get(id) ?? 0
    const after = Math.max(0, before + (active ? 1 : -1))
    if (after) this.running.set(id, after)
    else this.running.delete(id)
    if (before > 0 === after > 0) return
    this.scheduleBusyPush(id)
  }

  private scheduleBusyPush(id: string): void {
    if (this.busyTimers.has(id)) return
    const wait = Math.max(0, BUSY_PUSH_MS - (Date.now() - (this.busyPushAt.get(id) ?? 0)))
    if (!wait) {
      this.busyPushAt.set(id, Date.now())
      this.push()
      return
    }
    this.busyTimers.set(
      id,
      setTimeout(() => {
        this.busyTimers.delete(id)
        this.busyPushAt.set(id, Date.now())
        this.push()
      }, wait),
    )
  }

  pair(
    input: Omit<NewComputer, "os" | "arch" | "host" | "caps" | "at"> & { hello: Hello; replaces?: string },
  ): PairOutcome {
    const { hello, replaces, ...rest } = input
    const owner = this.nameOwner(rest.name, replaces)
    if (owner) return { ok: false, error: this.nameTaken(rest.name, owner) }
    const inserted = this.d.store.insert(
      { ...rest, os: hello.os, arch: hello.arch, host: hello.host, caps: hello.caps, at: Date.now() },
      replaces,
    )
    if (!inserted) return { ok: false, error: "that pairing code was already used" }
    this.marks.set(rest.id, { version: hello.version })
    if (replaces) this.forget(replaces)
    this.push()
    return { ok: true }
  }

  async connect(request: Request): Promise<Response> {
    const id = request.headers.get(CONNECT_HEADERS.id) ?? ""
    const user = request.headers.get(CONNECT_HEADERS.user) ?? ""
    const ts = Number(request.headers.get(CONNECT_HEADERS.ts) ?? "")
    const sig = request.headers.get(CONNECT_HEADERS.sig) ?? ""
    const protocol = Number(request.headers.get(CONNECT_HEADERS.protocol) ?? "")
    if (!id || user !== this.d.ownerId || !sig) return new Response("bad connect", { status: 401 })
    if (protocol < OLDEST_PROTOCOL || protocol > PROTOCOL)
      return new Response("protocol mismatch", {
        status: 426,
        headers: { [CONNECT_HEADERS.protocol]: String(PROTOCOL) },
      })
    if (!Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > CONNECT_SKEW_MS)
      return new Response("stale connect", { status: 401 })
    const row = this.d.store.get(id)
    if (!row) return new Response("this computer was removed", { status: 410 })
    if (!(await verify(row.public_key, sig, connectMessage(user, id, ts, protocol))))
      return new Response("bad signature", { status: 401 })
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("expected a websocket upgrade", { status: 426 })

    const inherited = this.hold(id)
    for (const older of this.sockets(id)) {
      if (older.readyState !== WebSocket.OPEN) continue
      try {
        older.close(CLOSE.replaced, "replaced")
      } catch {}
    }
    this.relaying.delete(id)
    this.dropTerminalsFor(id, "the computer reconnected")
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.d.ctx.acceptWebSocket(server, ["pc", `pc:${id}`])
    const { hello: _hello, ...hold } = inherited
    server.serializeAttachment({ ...hold, kind: "pc", id, hello: null, at: Date.now() } satisfies PcAttachment)
    this.push()
    return new Response(null, { status: 101, webSocket: client })
  }

  private dropCalls(id: string): void {
    for (const [callId, call] of this.pending)
      if (call.pcId === id) this.settle(callId, { ok: false, code: "cancelled", message: "the computer reconnected" })
  }

  async message(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const saved = attachmentOf(ws)
    if (!saved) {
      ws.close(CLOSE.notReady, "not a computer")
      return
    }
    this.heard.set(ws, Date.now())
    this.marks.set(saved.id, { ...this.marks.get(saved.id), seenAt: Date.now() })
    if (typeof raw !== "string") {
      const bytes = new Uint8Array(raw)
      const binary = decodeBinary(bytes)
      if (binary) return this.binaryResult(binary.header, binary.data)
      this.relayFrame(saved.id, bytes)
      return
    }
    let frame: FromDaemon
    try {
      frame = decodeDaemon(JSON.parse(raw))
    } catch {
      return
    }
    if (frame.t === "hello") return this.hello(ws, saved, frame)
    if (!saved.hello) {
      ws.close(CLOSE.notReady, "hello required")
      return
    }
    if (frame.t === "result") return this.result(frame)
    if (frame.t === "held") return this.held(saved.id, frame)
    if (frame.t === "clipboard") return this.clipboard(saved.id, frame.text)
    if (frame.t === "rtc") return this.daemonRtc(saved.id, frame.session, frame.signal)
    if (frame.t === "terminal") return this.terminalEvent(frame)
    if (frame.t === "humanInput") {
      this.enterHuman(saved.id)
      this.push()
    }
  }

  private hello(ws: WebSocket, saved: PcAttachment, hello: Hello): void {
    if (saved.hello) {
      ws.close(CLOSE.notReady, "duplicate hello")
      return
    }
    if (hello.protocol < OLDEST_PROTOCOL || hello.protocol > PROTOCOL) {
      ws.close(CLOSE.protocol, "protocol mismatch")
      return
    }
    ws.serializeAttachment({ ...saved, hello } satisfies PcAttachment)
    this.memory.set(saved.id, { ...saved, hello })
    this.rememberDesktop(saved.id, hello.desktop)
    this.marks.set(saved.id, { version: hello.version })
    this.arrived(saved.id)
    this.send(ws, { t: "welcome", id: saved.id, name: this.name(saved.id), version: BACKEND.version })
    this.tellHolder(saved.id, saved.holder)
    this.syncRelay(saved.id)
    void this.iceServers().catch(() => {})
    this.push()
    this.resume(saved.id, hello)
  }

  private resume(pcId: string, hello: Hello): void {
    const waiting = [...this.pending].filter(([, call]) => call.pcId === pcId)
    if (!waiting.length) return
    if (!hello.resume) {
      for (const [id] of waiting) this.settle(id, { ok: false, code: "cancelled", message: "the computer reconnected" })
      return
    }
    const running = new Set(hello.resume.running)
    const ws = this.socket(pcId)
    if (!ws) return
    for (const [id, call] of waiting) if (!running.has(id)) this.send(ws, call.frame)
  }

  private result(frame: Extract<FromDaemon, { t: "result" }>): void {
    this.settle(
      frame.id,
      frame.ok ? { ok: true, value: frame.value } : { ok: false, code: frame.error.code, message: frame.error.message },
    )
  }

  private binaryResult(header: Record<string, unknown>, data: Uint8Array): void {
    let decoded: BinaryResult
    try {
      decoded = Schema.decodeUnknownSync(BinaryResult)(header)
    } catch {
      return
    }
    this.settle(decoded.id, { ok: true, value: joinImages(decoded.value, decoded.parts, data) })
  }

  private settle(callId: string, outcome: CallOutcome): boolean {
    const call = this.pending.get(callId)
    if (!call) return false
    this.pending.delete(callId)
    clearTimeout(call.timer)
    call.detach()
    call.resolve(outcome)
    return true
  }

  private target(pcId: string): CallTarget | null {
    const ws = this.socket(pcId)
    const saved = ws && attachmentOf(ws)
    if (!ws || !saved || !saved.hello) return null
    return { ws, saved, hello: saved.hello }
  }

  private async wakeAndTarget(pcId: string, deadlineMs: number): Promise<CallTarget | null> {
    await this.waitForArrival(pcId, Math.min(OFFLINE_WAIT_MS, deadlineMs))
    if (!this.online(pcId)) return null
    return this.target(pcId)
  }

  private offline(row: ComputerRow): CallOutcome {
    return { ok: false, code: "failed", message: this.offlineMessage(row) }
  }

  async call(
    pcId: string,
    op: Op,
    args: unknown,
    options: { deadlineMs?: number; signal?: AbortSignal; user?: { key: string; name: string } } = {},
  ): Promise<CallOutcome> {
    const row = this.d.store.get(pcId)
    if (!row) return { ok: false, code: "unsupported", message: "there is no such computer" }
    const deadlineMs = Math.min(Math.max(1_000, Number(options.deadlineMs ?? DEFAULT_DEADLINE_MS)), MAX_DEADLINE_MS)
    let target = this.target(pcId)
    if (!this.online(pcId)) target = await this.wakeAndTarget(pcId, deadlineMs)
    if (!target) return this.offline(row)
    const { ws, saved, hello } = target
    const cap = TERMINAL_OPS.has(op)
      ? "terminal"
      : op === "shell"
        ? "shell"
        : op === "read" || op === "write"
          ? "files"
          : "desktop"
    if (op === "driver") {
      if (!hello.caps.background)
        return { ok: false, code: "unsupported", message: `${row.name} does not allow background work` }
    } else if (!hello.caps[cap]) {
      return {
        ok: false,
        code: "unsupported",
        message: `${row.name} does not allow ${cap === "terminal" ? "terminal sessions" : cap}`,
      }
    }
    if (op === "driver" && saved.holder === "human")
      return { ok: false, code: "busy", message: `the human has control of ${row.name} right now` }
    if (op === "terminal_send" && saved.holder === "human")
      return { ok: false, code: "busy", message: "the owner has control of this terminal" }
    let parsed: unknown
    try {
      parsed = Schema.decodeUnknownSync(Calls[op].args)(args)
    } catch {
      return { ok: false, code: "failed", message: `bad ${op} arguments` }
    }
    const user = options.user
    const claims = user !== undefined && claimsDesk(op, parsed)
    const taken = claims && user ? this.claimDesk(pcId, user, deadlineMs) : null
    if (taken)
      return {
        ok: false,
        code: "busy",
        message: `${taken.name} is using the screen of ${row.name} for about ${Math.ceil((taken.until - Date.now()) / 1000)}s more. Shell and files still work; try the screen again after that.`,
      }
    const id = crypto.randomUUID()
    const frame = { t: "call", id, op, args: parsed, deadlineMs } as const satisfies Extract<ToDaemon, { t: "call" }>
    const busy = BUSY_OPS.has(op)
    if (busy) this.track(pcId, true)
    const outcome = new Promise<CallOutcome>((resolve) => {
      const done = (out: CallOutcome) => {
        if (busy) this.track(pcId, false)
        if (taken === null && claims && user) this.claimDesk(pcId, user, 0)
        resolve(out)
      }
      const timer = setTimeout(() => {
        this.sendTo(pcId, { t: "cancel", id })
        this.settle(id, { ok: false, code: "timeout", message: `${op} timed out after ${deadlineMs}ms` })
      }, deadlineMs)
      const signal = options.signal
      const abort = () => {
        this.sendTo(pcId, { t: "cancel", id })
        this.settle(id, { ok: false, code: "cancelled", message: `${op} was cancelled` })
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.pending.set(id, {
        pcId,
        frame,
        resolve: done,
        timer,
        detach: () => signal?.removeEventListener("abort", abort),
      })
    })
    this.send(ws, frame)
    return outcome
  }

  private clipboard(pcId: string, text: string): void {
    const message = JSON.stringify({ t: "clipboard", text })
    for (const live of this.d.ctx.getWebSockets(`live:${pcId}`)) {
      try {
        live.send(message)
      } catch {}
    }
  }

  private relayFrame(pcId: string, bytes: Uint8Array): void {
    if (!decodeFrame(bytes)) return
    for (const live of this.d.ctx.getWebSockets(`live:${pcId}`)) {
      if (liveOf(live)?.want !== true) continue
      try {
        live.send(bytes)
      } catch {}
    }
  }

  private relayWatchers(pcId: string, except?: WebSocket): number {
    return this.d.ctx
      .getWebSockets(`live:${pcId}`)
      .filter((socket) => socket !== except && liveOf(socket)?.want === true).length
  }

  live(pcId: string): Response {
    if (!this.row(pcId)) return new Response("there is no such computer", { status: 404 })
    const pair = new WebSocketPair()
    this.d.ctx.acceptWebSocket(pair[1], [`live:${pcId}`])
    pair[1].serializeAttachment({ kind: "live", pcId, want: false } satisfies LiveAttachment)
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  liveMessage(ws: WebSocket, raw: string | ArrayBuffer): boolean {
    const live = liveOf(ws)
    if (!live) return false
    if (typeof raw !== "string") return true
    let message: LiveMessage
    try {
      message = JSON.parse(raw) as LiveMessage
    } catch {
      return true
    }
    if (message.t === "ack" && typeof message.seq === "number") this.ack(live.pcId, message.seq)
    else if (message.t === "screen" && typeof message.id === "string" && message.id.length > 0)
      this.sendTo(live.pcId, { t: "screen", id: message.id })
    else if (message.t === "live") {
      const profile = profileOf(message)
      this.profiles.set(live.pcId, { ...RELAY, ...profile })
      ws.serializeAttachment({ ...live, want: message.on !== false } satisfies LiveAttachment)
      this.syncRelay(live.pcId, true)
    }
    return true
  }

  liveClosed(ws: WebSocket): boolean {
    const live = liveOf(ws)
    if (!live) return false
    this.syncRelay(live.pcId, true, ws)
    return true
  }

  syncRelay(pcId: string, force = false, except?: WebSocket): void {
    const ws = this.socket(pcId)
    if (!ws) return
    const on = this.relayWatchers(pcId, except) > 0
    if (!force && on === this.relaying.has(pcId)) return
    if (on) this.relaying.add(pcId)
    else this.relaying.delete(pcId)
    this.send(ws, on ? { t: "live", on: true, ...RELAY, ...this.profiles.get(pcId) } : { t: "live", on: false })
  }

  async watchRtc(pcId: string, tab: WebSocket): Promise<void> {
    const ws = this.socket(pcId)
    if (!ws) return
    const iceServers = await this.iceServers()
    try {
      tab.send(JSON.stringify({ t: "pc.rtc", pcId, signal: { type: "ice" }, iceServers }))
    } catch {}
    this.session(tab)
  }

  leave(tab: WebSocket): void {
    this.dropTabTerminals(tab)
    this.dropHuman(tab)
  }

  private dropHuman(tab: WebSocket): void {
    const session = this.sessionOf(tab)
    if (!session) return
    for (const row of this.rows()) {
      const hold = this.hold(row.id)
      if (hold.holder !== "human" || hold.heldBy !== session) continue
      this.d.released(this.release(row.id))
    }
  }

  session(tab: WebSocket): string {
    const known = this.sessionOf(tab)
    if (known) return known
    const id = crypto.randomUUID()
    const saved = (tab.deserializeAttachment() ?? {}) as TabAttachment & Record<string, unknown>
    tab.serializeAttachment({
      ...saved,
      pcSession: id,
      ...(saved.user ? { user: { ...saved.user, pcSession: id } } : {}),
    })
    return id
  }

  async rtcFromTab(tab: WebSocket, pcId: string, signal: RtcSignal): Promise<void> {
    const ws = this.socket(pcId)
    if (!ws) return
    this.send(ws, { t: "rtc", session: this.session(tab), signal, iceServers: await this.iceServers() })
  }

  private daemonRtc(pcId: string, session: string, signal: RtcSignal): void {
    for (const tab of this.d.ctx.getWebSockets("tab")) {
      if (this.sessionOf(tab) !== session) continue
      try {
        socketView(tab).send(JSON.stringify({ t: "pc.rtc", pcId, signal }))
      } catch {}
      return
    }
  }

  async iceServers(): Promise<IceServer[]> {
    if (this.turn && Date.now() - this.turn.at < TURN_CACHE_MS) return this.turn.servers
    this.turning ??= this.mintIceServers().finally(() => {
      this.turning = undefined
    })
    return this.turning
  }

  private async mintIceServers(): Promise<IceServer[]> {
    const servers: IceServer[] = [STUN]
    const keyId = this.d.env.CF_TURN_KEY_ID
    const token = this.d.env.CF_TURN_KEY_TOKEN
    if (!keyId || !token) return servers
    try {
      const response = await (this.d.fetch ?? fetch)(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ ttl: TURN_TTL_S }),
          signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
        },
      )
      if (!response.ok) return servers
      const body = (await response.json()) as { iceServers?: IceServer | IceServer[] }
      const minted = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : []
      const out = [...servers, ...minted]
      this.turn = { at: Date.now(), servers: out }
      return out
    } catch {
      return servers
    }
  }

  input(pcId: string, session: string, events: readonly InputEvent[]): boolean {
    if (!this.owns(pcId, session)) return false
    const ws = this.socket(pcId)
    if (!ws) return false
    this.send(ws, { t: "input", events })
    return true
  }

  ack(pcId: string, seq: number): void {
    const ws = this.socket(pcId)
    if (ws) this.send(ws, { t: "ack", seq })
  }

  attachTerminal(
    tab: WebSocket,
    requestId: RequestId,
    pcId: string,
    terminalId: string,
    cols: number,
    rows: number,
  ): TerminalAttachOutcome {
    const row = this.d.store.get(pcId)
    if (!row) return { ok: false, code: "unsupported", message: "there is no such computer" }
    const target = this.target(pcId)
    if (!target) return { ok: false, code: "failed", message: this.offlineMessage(row) }
    if (!target.hello.caps.terminal)
      return { ok: false, code: "unsupported", message: `${row.name} does not allow terminal sessions` }
    const id = crypto.randomUUID()
    const stream = terminalStream(id)
    this.dropTerminal(tab, terminalId)
    this.attaches.set(id, { pcId, terminal: terminalId, tab, requestId, stream })
    this.send(target.ws, {
      t: "terminal",
      on: true,
      id,
      terminal: terminalId,
      cols: clamp(cols, 20, 500),
      rows: clamp(rows, 5, 200),
    })
    return { ok: true, value: stream }
  }

  private terminalEvent(frame: Extract<FromDaemon, { t: "terminal" }>): void {
    const attach = this.attaches.get(frame.id)
    if (!attach) return
    this.sendTerminal(attach, frame.event)
  }

  private sendTerminal(attach: TerminalAttach, event: TerminalEvent): void {
    try {
      attach.tab.send(terminalText(attach.requestId, event))
    } catch {}
  }

  private dropTerminal(tab: WebSocket, terminalId: string): void {
    for (const [id, attach] of this.attaches) {
      if (attach.tab !== tab || attach.terminal !== terminalId) continue
      this.attaches.delete(id)
      this.sendTo(attach.pcId, { t: "terminal", on: false, id })
    }
  }

  private terminalAttachOf(tab: WebSocket, pcId: string, terminalId: string): [string, TerminalAttach] | null {
    for (const [id, attach] of this.attaches)
      if (attach.tab === tab && attach.pcId === pcId && attach.terminal === terminalId) return [id, attach]
    return null
  }

  private owns(pcId: string, session: string | undefined): boolean {
    const hold = this.hold(pcId)
    return hold.holder === "human" && session !== undefined && hold.heldBy === session
  }

  private controls(tab: WebSocket, pcId: string): CallOutcome | null {
    if (this.hold(pcId).holder !== "human")
      return { ok: false, code: "busy", message: "take over this computer before using its terminal" }
    if (!this.owns(pcId, this.sessionOf(tab)))
      return { ok: false, code: "busy", message: "another viewer has control of this computer" }
    return null
  }

  terminalInput(tab: WebSocket, pcId: string, terminalId: string, data: string): CallOutcome {
    const held = this.terminalAttachOf(tab, pcId, terminalId)
    if (!held) return { ok: false, code: "failed", message: "open the terminal before typing into it" }
    const refused = this.controls(tab, pcId)
    if (refused) return refused
    this.sendTo(pcId, { t: "terminalInput", id: held[0], data })
    return { ok: true, value: undefined }
  }

  terminalResize(tab: WebSocket, pcId: string, terminalId: string, cols: number, rows: number): CallOutcome {
    const held = this.terminalAttachOf(tab, pcId, terminalId)
    if (!held) return { ok: false, code: "failed", message: "open the terminal before resizing it" }
    const refused = this.controls(tab, pcId)
    if (refused) return refused
    this.sendTo(pcId, { t: "terminalResize", id: held[0], cols: clamp(cols, 20, 500), rows: clamp(rows, 5, 200) })
    return { ok: true, value: undefined }
  }

  terminalAck(tab: WebSocket, pcId: string, terminalId: string, bytes: number): void {
    const held = this.terminalAttachOf(tab, pcId, terminalId)
    if (held) this.sendTo(pcId, { t: "terminalAck", id: held[0], bytes })
  }

  endTerminal(stream: string): void {
    for (const [id, attach] of this.attaches) {
      if (attach.stream !== stream) continue
      this.attaches.delete(id)
      this.sendTo(attach.pcId, { t: "terminal", on: false, id })
    }
  }

  private dropTerminalsFor(pcId: string, message: string): void {
    for (const [id, attach] of this.attaches) {
      if (attach.pcId !== pcId) continue
      this.attaches.delete(id)
      this.sendTerminal(attach, { type: "error", message })
    }
  }

  private dropTabTerminals(tab: WebSocket): void {
    for (const [id, attach] of this.attaches) {
      if (attach.tab !== tab) continue
      this.attaches.delete(id)
      this.sendTo(attach.pcId, { t: "terminal", on: false, id })
    }
  }

  private send(ws: WebSocket, frame: ToDaemon): void {
    try {
      ws.send(JSON.stringify(frame))
    } catch {}
  }

  private sendTo(pcId: string, frame: ToDaemon): void {
    const ws = this.socket(pcId)
    if (ws) this.send(ws, frame)
  }

  private claimDesk(
    pcId: string,
    user: { key: string; name: string },
    runningMs: number,
  ): { name: string; until: number } | null {
    const now = Date.now()
    const current = this.desk.get(pcId)
    if (current && current.user !== user.key && current.until > now) return current
    this.desk.set(pcId, { user: user.key, name: user.name, until: now + runningMs + DESK_MS })
    return null
  }

  private tellHolder(pcId: string, holder: Holder): void {
    const ws = this.socket(pcId)
    if (!ws) return
    const hold = this.hold(pcId)
    this.send(ws, {
      t: "control",
      holder,
      ...(hold.heldEpoch === undefined ? {} : { epoch: hold.heldEpoch }),
      ...(holder === "human" && hold.heldBy ? { session: hold.heldBy } : {}),
    })
  }

  private held(pcId: string, frame: Extract<FromDaemon, { t: "held" }>): void {
    const waiting = this.takes.get(pcId)
    if (!waiting) return
    if (frame.epoch !== undefined && frame.epoch !== waiting.epoch) return
    waiting.settle(frame.holder === "human")
  }

  private awaitHeld(pcId: string, epoch: number): Promise<boolean> {
    const previous = this.takes.get(pcId)
    if (previous) previous.settle(true)
    return new Promise((resolve) => {
      const settle = (ok: boolean) => {
        const current = this.takes.get(pcId)
        if (current?.epoch !== epoch) return
        this.takes.delete(pcId)
        resolve(ok)
      }
      this.takes.set(pcId, { epoch, settle })
      void this.pause(HOLD_ACK_MS).then(() => settle(true))
    })
  }

  private enterHuman(pcId: string): void {
    const hold = this.hold(pcId)
    if (hold.holder === "human") return
    this.save(pcId, { ...hold, holder: "human", heldSince: Date.now() })
    this.tellHolder(pcId, "human")
    this.arm()
  }

  async take(pcId: string, tab: WebSocket): Promise<boolean> {
    if (!this.socket(pcId)) return false
    const before = this.hold(pcId)
    const epoch = (before.heldEpoch ?? 0) + 1
    this.save(pcId, {
      ...before,
      holder: "human",
      heldBy: this.session(tab),
      heldEpoch: epoch,
      heldSince: Date.now(),
    })
    this.tellHolder(pcId, "human")
    this.push()
    this.arm()
    if (before.holder !== "human" && before.waiters?.length)
      this.d.taken({ pcId, name: this.name(pcId), waiters: before.waiters, epoch })
    return this.awaitHeld(pcId, epoch)
  }

  link(pcId: string, agent: PcAgent): "human" | "agent" | "missing" {
    if (!this.d.store.get(pcId)) return "missing"
    const hold = this.hold(pcId)
    const others = (hold.waiters ?? []).filter((w) => w.slug !== agent.slug || w.roomId !== agent.roomId)
    this.save(pcId, { ...hold, agent, waiters: [...others, agent].slice(-MAX_WAITERS) })
    this.push()
    return hold.holder
  }

  releaseBy(pcId: string, session: string): "ok" | "other" {
    const hold = this.hold(pcId)
    if (hold.holder === "human" && hold.heldBy !== undefined && hold.heldBy !== session) return "other"
    this.d.released(this.release(pcId))
    return "ok"
  }

  release(pcId: string, except?: string): PcReleased {
    const waiters = (this.hold(pcId).waiters ?? []).filter((w) => w.slug !== except)
    this.takes.get(pcId)?.settle(true)
    this.desk.delete(pcId)
    this.save(pcId, { holder: "agent" })
    this.tellHolder(pcId, "agent")
    this.push()
    this.arm()
    return { pcId, name: this.name(pcId), waiters, expired: false }
  }

  nextHold(): number | undefined {
    const now = Date.now()
    let next: number | undefined
    for (const row of this.rows()) {
      const hold = this.hold(row.id)
      if (hold.holder !== "human") continue
      const due = Math.max((hold.heldSince ?? 0) + HOLD_MS, now)
      next = next === undefined ? due : Math.min(next, due)
    }
    return next
  }

  reap(at = Date.now()): PcReleased[] {
    const released: PcReleased[] = []
    for (const row of this.rows()) {
      const hold = this.hold(row.id)
      if (hold.holder !== "human" || (hold.heldSince ?? 0) + HOLD_MS > at) continue
      const out = { ...this.release(row.id), expired: true }
      released.push(out)
      this.d.released(out)
    }
    return released
  }

  async close(ws: WebSocket, code?: number, reason?: string): Promise<void> {
    const saved = attachmentOf(ws)
    if (!saved) return
    const replaced = this.sockets(saved.id).some((other) => other !== ws && other.readyState === WebSocket.OPEN)
    if (!replaced) {
      this.relaying.delete(saved.id)
      this.dropTerminalsFor(saved.id, `${this.name(saved.id)} disconnected`)
      this.memory.set(saved.id, { ...saved, hello: saved.hello ?? this.memory.get(saved.id)?.hello })
      this.marks.set(saved.id, {
        ...this.marks.get(saved.id),
        seenAt: Date.now(),
        reason: closeText(code, reason),
      })
    }
    this.push()
  }

  remove(id: string): void {
    this.d.store.remove(id)
    this.forget(id)
    this.push()
  }

  private forget(id: string): void {
    const ws = this.socket(id)
    if (ws)
      try {
        ws.close(CLOSE.replaced, "removed")
      } catch {}
    this.dropCalls(id)
    this.takes.get(id)?.settle(false)
    this.relaying.delete(id)
    this.profiles.delete(id)
    this.dropTerminalsFor(id, "this computer was removed")
    this.desk.delete(id)
    this.memory.delete(id)
    this.desktop.delete(id)
    this.marks.delete(id)
  }

  ageHold(id: string, ms: number): boolean {
    const hold = this.hold(id)
    if (hold.holder !== "human") return false
    this.save(id, { ...hold, heldSince: Math.max(0, (hold.heldSince ?? Date.now()) - ms) })
    this.arm()
    return true
  }

  rename(id: string, name: string): RenameOutcome {
    const owner = this.nameOwner(name, id)
    if (owner) return { ok: false, reason: "taken", error: this.nameTaken(name, owner) }
    if (!this.d.store.rename(id, name)) return { ok: false, reason: "missing", error: "there is no such computer" }
    const ws = this.socket(id)
    if (ws) this.send(ws, { t: "welcome", id, name })
    this.push()
    return { ok: true }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}
