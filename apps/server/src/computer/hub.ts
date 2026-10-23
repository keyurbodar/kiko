import { Schema } from "effect"
import {
  Calls,
  type FailCode,
  type FromDaemon,
  FromDaemon as FromDaemonSchema,
  type Hello,
  type Holder,
  type IceServer,
  type InputEvent,
  type Op,
  PROTOCOL,
  type RtcSignal,
  type ToDaemon,
} from "@kiko/computer/wire"
import { CONNECT_HEADERS, CONNECT_SKEW_MS, connectMessage, verify } from "@kiko/computer/sign"
import { decodeFrame } from "@kiko/computer/frame"
import type { AgentSlug, ComputerSummary, RoomId } from "@kiko/protocol"
import type { Env } from "../index"
import type { ComputerRow, ComputerStore, NewComputer } from "./store"

const HOLD_MS = 30 * 60_000
const PRESENCE_MS = 45_000
const DEFAULT_DEADLINE_MS = 60_000
const BUSY_PUSH_MS = 500
export const MAX_DEADLINE_MS = 10 * 60_000
export const COMPUTER_WAKEUP = "computer_hold"

const BUSY_OPS: ReadonlySet<Op> = new Set<Op>(["shell", "look", "act"])

const STUN: IceServer = { urls: "stun:stun.cloudflare.com:3478" }
const TURN_TTL_S = 3600
const TURN_CACHE_MS = 30 * 60_000
const RELAY = { fps: 8, maxWidth: 1280, quality: 60 } as const
const CLOSE = { replaced: 4000, notReady: 1008, protocol: 4001 } as const

const decodeDaemon = Schema.decodeUnknownSync(FromDaemonSchema)

export type PcAgent = { slug: AgentSlug; roomId: RoomId; reason?: string }

type PcHold = {
  holder: Holder
  heldBy?: string
  heldSince?: number
  agent?: PcAgent
  hello?: Hello
}

export type PcAttachment = {
  kind: "pc"
  id: string
  hello: Hello | null
  holder: Holder
  heldBy?: string
  heldSince?: number
  agent?: PcAgent
  at: number
}

export type CallOutcome = { ok: true; value: unknown } | { ok: false; code: FailCode; message: string }

export type PcReleased = { pcId: string; name: string; waiters: PcAgent[]; expired: boolean }

type TabAttachment = { pcSession?: string; user?: { pcSession?: string } }

type Pending = {
  pcId: string
  resolve: (outcome: CallOutcome) => void
  timer: ReturnType<typeof setTimeout>
  detach: () => void
}

export type HubDeps = {
  ctx: DurableObjectState
  env: Env
  store: ComputerStore
  ownerId: string
  released: (out: PcReleased) => void
  wakeup: { set(at: number): Promise<void>; clear(): Promise<void> }
  fetch?: typeof fetch
}

function attachmentOf(ws: WebSocket): PcAttachment | null {
  const saved = ws.deserializeAttachment() as PcAttachment | null
  return saved?.kind === "pc" && typeof saved.id === "string" ? saved : null
}

export function pcSocketId(ws: WebSocket): string | null {
  return attachmentOf(ws)?.id ?? null
}

export class ComputerHub {
  private readonly pending = new Map<string, Pending>()
  private readonly waiters = new Map<string, PcAgent[]>()
  private readonly watching = new Map<string, Set<WebSocket>>()
  private readonly memory = new Map<string, PcHold>()
  private readonly running = new Map<string, number>()
  private readonly busyPushAt = new Map<string, number>()
  private readonly busyTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly sentTo = new WeakMap<WebSocket, string>()
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
      ...(saved.heldSince ? { heldSince: saved.heldSince } : {}),
      ...(saved.agent ? { agent: saved.agent } : {}),
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

  holder(id: string): Holder {
    return this.hold(id).holder
  }

  online(id: string): boolean {
    for (const ws of this.sockets(id)) {
      if (ws.readyState !== WebSocket.OPEN) continue
      const seen = this.d.ctx.getWebSocketAutoResponseTimestamp(ws)
      if (seen && Date.now() - seen.getTime() < PRESENCE_MS) return true
      const at = attachmentOf(ws)?.at ?? 0
      if (Date.now() - at < PRESENCE_MS) return true
    }
    return false
  }

  private sessionOf(tab: WebSocket): string | undefined {
    const saved = tab.deserializeAttachment() as TabAttachment | null
    return saved?.pcSession ?? saved?.user?.pcSession
  }

  summaries(tab?: WebSocket): ComputerSummary[] {
    const mine = tab && this.sessionOf(tab)
    return this.rows().map((row) => {
      const hold = this.hold(row.id)
      const heldBy = tab && hold.heldBy ? (mine === hold.heldBy ? "you" : "other") : undefined
      return {
        id: row.id,
        name: row.name,
        os: row.os,
        online: this.online(row.id),
        caps: this.helloOf(row.id)?.caps ?? this.d.store.caps(row),
        holder: hold.holder,
        busy: this.busy(row.id),
        ...(heldBy ? { heldBy } : {}),
        ...(hold.agent ? { agent: hold.agent } : {}),
        displays: this.helloOf(row.id)?.displays ?? [],
      }
    })
  }

  sendState(tab: WebSocket): void {
    const text = JSON.stringify({ t: "pcState", computers: this.summaries(tab) })
    if (this.sentTo.get(tab) === text) return
    this.sentTo.set(tab, text)
    try {
      tab.send(text)
    } catch {}
  }

  push(): void {
    for (const ws of this.d.ctx.getWebSockets("tab")) {
      if (!(ws.deserializeAttachment() as { user?: { ready?: boolean } } | null)?.user?.ready) continue
      this.sendState(ws)
    }
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

  pair(input: Omit<NewComputer, "os" | "arch" | "host" | "caps" | "at"> & { hello: Hello }): boolean {
    const { hello, ...rest } = input
    const inserted = this.d.store.insert({
      ...rest,
      os: hello.os,
      arch: hello.arch,
      host: hello.host,
      caps: hello.caps,
      at: Date.now(),
    })
    if (inserted) this.push()
    return inserted
  }

  async connect(request: Request): Promise<Response> {
    const id = request.headers.get(CONNECT_HEADERS.id) ?? ""
    const user = request.headers.get(CONNECT_HEADERS.user) ?? ""
    const ts = Number(request.headers.get(CONNECT_HEADERS.ts) ?? "")
    const sig = request.headers.get(CONNECT_HEADERS.sig) ?? ""
    const protocol = Number(request.headers.get(CONNECT_HEADERS.protocol) ?? "")
    if (!id || user !== this.d.ownerId || !sig) return new Response("bad connect", { status: 401 })
    if (protocol !== PROTOCOL)
      return new Response("protocol mismatch", {
        status: 426,
        headers: { [CONNECT_HEADERS.protocol]: String(PROTOCOL) },
      })
    if (!Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > CONNECT_SKEW_MS)
      return new Response("stale connect", { status: 401 })
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("expected a websocket upgrade", { status: 426 })
    const row = this.d.store.get(id)
    if (!row) return new Response("unknown computer", { status: 401 })
    if (!(await verify(row.public_key, sig, connectMessage(user, id, ts, protocol))))
      return new Response("bad signature", { status: 401 })

    for (const older of this.sockets(id)) {
      if (older.readyState !== WebSocket.OPEN) continue
      try {
        older.close(CLOSE.replaced, "replaced")
      } catch {}
    }
    this.dropCalls(id)
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.d.ctx.acceptWebSocket(server, ["pc", `pc:${id}`])
    const hold = this.memory.get(id) ?? { holder: "agent" as const }
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
    if (typeof raw !== "string") {
      this.relayFrame(saved.id, new Uint8Array(raw))
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
    if (frame.t === "rtc") return this.daemonRtc(saved.id, frame.session, frame.signal)
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
    if (hello.protocol !== PROTOCOL) {
      ws.close(CLOSE.protocol, "protocol mismatch")
      return
    }
    ws.serializeAttachment({ ...saved, hello } satisfies PcAttachment)
    this.memory.set(saved.id, { ...saved, hello })
    this.send(ws, { t: "welcome", id: saved.id, name: this.name(saved.id) })
    void this.iceServers().catch(() => {})
    this.push()
  }

  private result(frame: Extract<FromDaemon, { t: "result" }>): void {
    this.settle(
      frame.id,
      frame.ok ? { ok: true, value: frame.value } : { ok: false, code: frame.error.code, message: frame.error.message },
    )
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

  async call(
    pcId: string,
    op: Op,
    args: unknown,
    options: { deadlineMs?: number; signal?: AbortSignal } = {},
  ): Promise<CallOutcome> {
    const row = this.d.store.get(pcId)
    if (!row) return { ok: false, code: "unsupported", message: "there is no such computer" }
    const ws = this.socket(pcId)
    if (!ws) return { ok: false, code: "unsupported", message: `${row.name} is not connected` }
    const saved = attachmentOf(ws)
    const hello = saved?.hello
    if (!saved || !hello) return { ok: false, code: "unsupported", message: `${row.name} is not ready yet` }
    const cap = op === "shell" ? "shell" : op === "read" || op === "write" ? "files" : "desktop"
    if (!hello.caps[cap]) return { ok: false, code: "unsupported", message: `${row.name} does not allow ${cap}` }
    if (op === "act" && !hello.caps.input)
      return { ok: false, code: "unsupported", message: `${row.name} has input off` }
    if ((op === "look" || op === "act") && saved.holder === "human")
      return { ok: false, code: "busy", message: `the human has control of ${row.name} right now` }
    let parsed: unknown
    try {
      parsed = Schema.decodeUnknownSync(Calls[op].args)(args)
    } catch {
      return { ok: false, code: "failed", message: `bad ${op} arguments` }
    }
    const deadlineMs = Math.min(Math.max(1_000, Number(options.deadlineMs ?? DEFAULT_DEADLINE_MS)), MAX_DEADLINE_MS)
    const id = crypto.randomUUID()
    const busy = BUSY_OPS.has(op)
    if (busy) this.track(pcId, true)
    const outcome = new Promise<CallOutcome>((resolve) => {
      const done = (out: CallOutcome) => {
        if (busy) this.track(pcId, false)
        resolve(out)
      }
      const timer = setTimeout(() => {
        this.send(ws, { t: "cancel", id })
        this.settle(id, { ok: false, code: "timeout", message: `${op} timed out after ${deadlineMs}ms` })
      }, deadlineMs)
      const signal = options.signal
      const abort = () => {
        this.send(ws, { t: "cancel", id })
        this.settle(id, { ok: false, code: "cancelled", message: `${op} was cancelled` })
      }
      signal?.addEventListener("abort", abort, { once: true })
      this.pending.set(id, { pcId, resolve: done, timer, detach: () => signal?.removeEventListener("abort", abort) })
    })
    this.send(ws, { t: "call", id, op, args: parsed, deadlineMs })
    return outcome
  }

  private relayFrame(pcId: string, frame: Uint8Array): void {
    const watchers = this.watching.get(pcId)
    if (!watchers?.size || !decodeFrame(frame)) return
    const id = new TextEncoder().encode(pcId)
    const out = new Uint8Array(1 + id.byteLength + frame.byteLength)
    out[0] = id.byteLength
    out.set(id, 1)
    out.set(frame, 1 + id.byteLength)
    for (const tab of watchers)
      try {
        tab.send(out)
      } catch {}
  }

  watch(pcId: string, tab: WebSocket, on: boolean, mode: "rtc" | "relay"): void {
    if (mode !== "relay") return
    const watchers = this.watching.get(pcId) ?? new Set<WebSocket>()
    const had = watchers.has(tab)
    if (on) watchers.add(tab)
    else watchers.delete(tab)
    if (watchers.size) this.watching.set(pcId, watchers)
    else this.watching.delete(pcId)
    if (had === on) return
    const ws = this.socket(pcId)
    if (!ws) return
    this.send(ws, watchers.size > 0 ? { t: "live", on: true, ...RELAY } : { t: "live", on: false })
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

  unwatch(tab: WebSocket): void {
    for (const [pcId, watchers] of this.watching) {
      if (!watchers.delete(tab) || watchers.size) continue
      this.watching.delete(pcId)
      const ws = this.socket(pcId)
      if (ws) this.send(ws, { t: "live", on: false })
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
        tab.send(JSON.stringify({ t: "pc.rtc", pcId, signal }))
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

  input(pcId: string, events: readonly InputEvent[]): void {
    const ws = this.socket(pcId)
    if (ws) this.send(ws, { t: "input", events })
  }

  ack(pcId: string, seq: number): void {
    const ws = this.socket(pcId)
    if (ws) this.send(ws, { t: "ack", seq })
  }

  private send(ws: WebSocket, frame: ToDaemon): void {
    try {
      ws.send(JSON.stringify(frame))
    } catch {}
  }

  private tellHolder(pcId: string, holder: Holder): void {
    const ws = this.socket(pcId)
    if (ws) this.send(ws, { t: "control", holder })
  }

  private enterHuman(pcId: string): void {
    const hold = this.hold(pcId)
    if (hold.holder === "human") return
    this.save(pcId, { ...hold, holder: "human", heldSince: Date.now() })
    this.tellHolder(pcId, "human")
    this.arm()
  }

  take(pcId: string, tab: WebSocket): boolean {
    if (!this.socket(pcId)) return false
    this.save(pcId, { ...this.hold(pcId), holder: "human", heldBy: this.session(tab), heldSince: Date.now() })
    this.tellHolder(pcId, "human")
    this.push()
    this.arm()
    return true
  }

  link(pcId: string, agent: PcAgent): "human" | "agent" | "missing" {
    if (!this.d.store.get(pcId)) return "missing"
    const hold = this.hold(pcId)
    this.save(pcId, { ...hold, agent })
    const list = this.waiters.get(pcId) ?? []
    if (!list.some((w) => w.slug === agent.slug && w.roomId === agent.roomId)) list.push(agent)
    this.waiters.set(pcId, list)
    this.push()
    return hold.holder
  }

  release(pcId: string, except?: string): PcReleased {
    const waiters = (this.waiters.get(pcId) ?? []).filter((w) => w.slug !== except)
    this.waiters.delete(pcId)
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

  async close(ws: WebSocket): Promise<void> {
    const saved = attachmentOf(ws)
    this.unwatch(ws)
    if (!saved) return
    const replaced = this.sockets(saved.id).some((other) => other !== ws && other.readyState === WebSocket.OPEN)
    if (!replaced) {
      for (const [callId, call] of this.pending)
        if (call.pcId === saved.id)
          this.settle(callId, { ok: false, code: "cancelled", message: "the computer disconnected" })
      this.memory.set(saved.id, { ...saved, hello: saved.hello ?? this.memory.get(saved.id)?.hello })
    }
    this.push()
  }

  remove(id: string): void {
    const ws = this.socket(id)
    if (ws)
      try {
        ws.close(CLOSE.replaced, "removed")
      } catch {}
    this.d.store.remove(id)
    this.dropCalls(id)
    this.watching.delete(id)
    this.waiters.delete(id)
    this.memory.delete(id)
    this.push()
  }

  ageHold(id: string, ms: number): boolean {
    const hold = this.hold(id)
    if (hold.holder !== "human") return false
    this.save(id, { ...hold, heldSince: Math.max(0, (hold.heldSince ?? Date.now()) - ms) })
    this.arm()
    return true
  }

  rename(id: string, name: string): boolean {
    const changed = this.d.store.rename(id, name)
    if (!changed) return false
    const ws = this.socket(id)
    if (ws) this.send(ws, { t: "welcome", id, name })
    this.push()
    return true
  }
}
