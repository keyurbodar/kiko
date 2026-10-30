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
import type { AgentSlug, ComputerFrame, ComputerSummary, RoomId } from "@kiko/protocol"
import type { Env } from "../index"
import { encodeBase64 } from "../lib/base64"
import { BACKEND } from "../lib/version"
import { dropStreams, socketView } from "../owner/socket"
import { frameChunk, frameSubs, frameText } from "./frames"
import type { ComputerRow, ComputerStore, NewComputer } from "./store"

const HOLD_MS = 30 * 60_000
const PRESENCE_MS = 45_000
const DEFAULT_DEADLINE_MS = 60_000
const BUSY_PUSH_MS = 500
export const MAX_DEADLINE_MS = 10 * 60_000
export const COMPUTER_WAKEUP = "computer_hold"

const BUSY_OPS: ReadonlySet<Op> = new Set<Op>(["shell", "look", "act"])
const DESK_MS = 60_000
const MAX_WAITERS = 8

const STUN: IceServer = { urls: "stun:stun.cloudflare.com:3478" }
const TURN_TTL_S = 3600
const TURN_CACHE_MS = 30 * 60_000
const TURN_TIMEOUT_MS = 5_000
const RELAY = { fps: 8, maxWidth: 1280, quality: 60 } as const
const CLOSE = { replaced: 4000, notReady: 1008, protocol: 4001 } as const

const decodeDaemon = Schema.decodeUnknownSync(FromDaemonSchema)

export type PcAgent = { slug: AgentSlug; roomId: RoomId; reason?: string }

type PcHold = {
  holder: Holder
  heldBy?: string
  heldSince?: number
  agent?: PcAgent
  waiters?: PcAgent[]
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
  waiters?: PcAgent[]
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
  private readonly desk = new Map<string, { user: string; name: string; until: number }>()
  private readonly relaying = new Set<string>()
  private readonly memory = new Map<string, PcHold>()
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

  private sessionOf(tab: WebSocket): string | undefined {
    const saved = tab.deserializeAttachment() as TabAttachment | null
    return saved?.pcSession ?? saved?.user?.pcSession
  }

  summaries(tab?: WebSocket): ComputerSummary[] {
    const mine = tab && this.sessionOf(tab)
    return this.rows().map((row) => {
      const hold = this.hold(row.id)
      const hello = this.helloOf(row.id)
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
        ...(hello?.note ? { note: hello.note } : {}),
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
      this.sendState(socketView(ws))
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

  pair(
    input: Omit<NewComputer, "os" | "arch" | "host" | "caps" | "at"> & { hello: Hello; replaces?: string },
  ): boolean {
    const { hello, replaces, ...rest } = input
    const inserted = this.d.store.insert(
      { ...rest, os: hello.os, arch: hello.arch, host: hello.host, caps: hello.caps, at: Date.now() },
      replaces,
    )
    if (!inserted) return false
    if (replaces) this.forget(replaces)
    this.push()
    return true
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
    this.dropCalls(id)
    this.relaying.delete(id)
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
    this.send(ws, { t: "welcome", id: saved.id, name: this.name(saved.id), version: BACKEND.version })
    this.tellHolder(saved.id, saved.holder)
    this.syncRelay(saved.id)
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
    options: { deadlineMs?: number; signal?: AbortSignal; user?: { key: string; name: string } } = {},
  ): Promise<CallOutcome> {
    const row = this.d.store.get(pcId)
    if (!row) return { ok: false, code: "unsupported", message: "there is no such computer" }
    if (!this.online(pcId)) return { ok: false, code: "unsupported", message: `${row.name} is not connected` }
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
    const taken = op === "act" && options.user ? this.claimDesk(pcId, options.user, deadlineMs) : null
    if (taken)
      return {
        ok: false,
        code: "busy",
        message: `${taken.name} is using the screen of ${row.name} for about ${Math.ceil((taken.until - Date.now()) / 1000)}s more. Shell and files still work; try the screen again after that.`,
      }
    const id = crypto.randomUUID()
    const busy = BUSY_OPS.has(op)
    if (busy) this.track(pcId, true)
    const outcome = new Promise<CallOutcome>((resolve) => {
      const done = (out: CallOutcome) => {
        if (busy) this.track(pcId, false)
        if (taken === null && op === "act" && options.user) this.claimDesk(pcId, options.user, 0)
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

  private relayFrame(pcId: string, bytes: Uint8Array): void {
    const decoded = decodeFrame(bytes)
    if (!decoded) return
    const { header, image } = decoded
    const frame: ComputerFrame = {
      seq: header.seq,
      mime: header.kind === "webp" ? "image/webp" : "image/jpeg",
      width: header.width,
      height: header.height,
      cursor: header.cursor,
      data: encodeBase64(image),
    }
    const values = frameChunk(frame)
    for (const tab of this.d.ctx.getWebSockets("tab"))
      for (const sub of frameSubs(tab.deserializeAttachment(), pcId))
        try {
          tab.send(frameText(sub.requestId, values))
        } catch {}
  }

  private relayWatchers(pcId: string): number {
    let count = 0
    for (const tab of this.d.ctx.getWebSockets("tab")) count += frameSubs(tab.deserializeAttachment(), pcId).length
    return count
  }

  private watchingTab(tab: WebSocket): readonly string[] {
    const saved = tab.deserializeAttachment() as { rpc?: readonly { stream: string }[] } | null
    return [...new Set((saved?.rpc ?? []).map((sub) => sub.stream).filter((stream) => stream.startsWith("pc:")))]
  }

  syncRelay(pcId: string, force = false): void {
    const ws = this.socket(pcId)
    if (!ws) return
    const on = this.relayWatchers(pcId) > 0
    if (!force && on === this.relaying.has(pcId)) return
    if (on) this.relaying.add(pcId)
    else this.relaying.delete(pcId)
    this.send(ws, on ? { t: "live", on: true, ...RELAY } : { t: "live", on: false })
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
    for (const pcId of this.watchingTab(tab)) this.syncRelay(pcId)
  }

  leave(tab: WebSocket): void {
    for (const pcId of this.watchingTab(tab)) {
      dropStreams(tab, `pc:${pcId}`)
      this.syncRelay(pcId)
    }
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
    const others = (hold.waiters ?? []).filter((w) => w.slug !== agent.slug || w.roomId !== agent.roomId)
    this.save(pcId, { ...hold, agent, waiters: [...others, agent].slice(-MAX_WAITERS) })
    this.push()
    return hold.holder
  }

  release(pcId: string, except?: string): PcReleased {
    const waiters = (this.hold(pcId).waiters ?? []).filter((w) => w.slug !== except)
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

  async close(ws: WebSocket): Promise<void> {
    const saved = attachmentOf(ws)
    this.unwatch(ws)
    if (!saved) return
    const replaced = this.sockets(saved.id).some((other) => other !== ws && other.readyState === WebSocket.OPEN)
    if (!replaced) {
      this.relaying.delete(saved.id)
      for (const [callId, call] of this.pending)
        if (call.pcId === saved.id)
          this.settle(callId, { ok: false, code: "cancelled", message: "the computer disconnected" })
      this.memory.set(saved.id, { ...saved, hello: saved.hello ?? this.memory.get(saved.id)?.hello })
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
    this.relaying.delete(id)
    this.desk.delete(id)
    this.memory.delete(id)
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
