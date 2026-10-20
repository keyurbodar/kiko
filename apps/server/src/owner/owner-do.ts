import { DurableObject } from "cloudflare:workers"
import { AsyncLocalStorage } from "node:async_hooks"
import { type RunBudget, Runs } from "./runs"
import { isRoomId, MAX_FRAME } from "@kiko/protocol"
import { Agent } from "../agent/agent-do"
import { Room } from "../room/room-do"
import { User } from "../user/user-do"
import type { Env } from "../index"
import { BlobStore } from "../files/blob-store"
import { fileStore, localBucket } from "../files/store"
import { instrument } from "../lib/dev-guard"
import { HANDLE_HEADER } from "../lib/names"
import type { OwnerServices, ServiceOptions } from "./services"
import { serviceContext, metadata } from "./context"
import { Clock, createServiceClock, RECOVERY_DELAY_MS } from "./clock"
import { AfterRun } from "./after-run"
import { initializeSchema } from "./schema"
import { ownerAttachment, socketView } from "./socket"

type Method<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T]
type Args<T> = T extends (...args: infer A) => unknown ? A : never
type Result<T> = T extends (...args: never[]) => infer R ? Awaited<R> : never
type Run = { agent: string; room_id: string; slug: string; request_id: string }
type QueuedRun = Run & { version: number }

const RUN_GAP_MS = 250

const DEADLINES = `SELECT m.scope, min(j.value) AS at FROM owner_meta m, json_each(m.value) j WHERE m.key = 'clock:application' GROUP BY m.scope`

export class OwnerDO extends DurableObject<Env> {
  private readonly runs: Runs
  private readonly incoming = new AsyncLocalStorage<Map<string, string>>()
  async storageUsage() {
    return { objectBytes: this.ctx.storage.sql.databaseSize, archiveEnabled: Boolean(this.env.ARCHIVE) }
  }
  protected readonly services: OwnerServices
  private readonly rooms = new Map<string, Room>()
  private readonly agents = new Map<string, Agent>()
  private readonly blobs: BlobStore
  private readonly ownerId: string
  private settings?: User
  private readonly clock: Clock
  private readonly afterRunHook = new AfterRun({ services: () => this.services })
  private alarmRunning = false
  private nextRunAt = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    instrument(ctx, "owner")
    const name = ctx.id.name ?? "owner"
    this.ownerId = name === "owner" ? "owner" : name.replace(/^owner:/, "")
    initializeSchema(ctx.storage)
    this.clock = new Clock(ctx.storage, async () => {
      const queued = ctx.storage.sql.exec<{ at: number | null }>(
        "SELECT min(ready_at) AS at FROM owner_runs WHERE request_id != 'socket-recovery' OR ? = 0", this.connected() ? 1 : 0,
      ).one().at
      return {
        loaded: [],
        unloaded: ctx.storage.sql.exec<{ at: number }>(
          `SELECT at FROM (${DEADLINES}) d WHERE NOT EXISTS (SELECT 1 FROM owner_runs r WHERE d.scope = 'agent:' || r.agent)`,
        ).toArray().map((row) => row.at),
        queued: queued === null ? undefined : Math.max(queued, this.nextRunAt),
        burst: this.connected() ? undefined : (await this.pendingRooms()).reduce<number | undefined>((next, room) => {
          const at = this.room(room).humanInputDeadline()
          return at === undefined ? next : Math.min(next ?? at, at)
        }, undefined),
      }
    })
    this.runs = new Runs({
      schedule: (agent, requestId) => this.enqueueRun(agent, requestId),
    })
    this.blobs = new BlobStore(this.ctx)

    this.services = {
      user: () => this.user(),
      room: (roomId) => this.room(roomId),
      agent: (roomId, slug) => this.agent(roomId, slug),
      files: () => env.FILES ? fileStore(env) : localBucket(this.blobs),
      egress: async (request) => {
        if (new URL(request.url).protocol !== "https:") throw new Error("egress is https only")
        this.runs.countActive()
        return fetch(request.url, { redirect: "manual", method: request.method, headers: request.headers, ...(request.body ? { body: request.body } : {}) })
      },
      countOutgoing: () => this.runs.countActive(),
      trimAgents: () => this.trimAgents(),
      dispatchRun: (roomId, slug) => this.dispatchRun(roomId, slug),
      cancelRun: (roomId, slug) => this.cancelRun(roomId, slug),
      afterRun: (roomId, slug) => this.afterRun(roomId, slug),
      syncRoutines: (routines) => this.user().syncRoutines(routines),
      fireRoutine: (delivery) => this.user().fireRoutine(delivery),
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
  }

  private context(roomId?: string): DurableObjectState {
    return serviceContext(this.ctx, () => this.ctx.getWebSockets()
      .filter((ws) => roomId === undefined || ownerAttachment(ws).rooms[roomId] !== undefined)
      .map((ws) => socketView(ws, roomId)))
  }

  private async publishDeadline(persist: () => void): Promise<void> {
    this.ctx.storage.transactionSync(persist)
    await this.refreshClock()
  }

  private options(scope: string, roomId?: string): ServiceOptions {
    const ctx = this.context(roomId)
    const meta = metadata(this.ctx.storage, scope)
    return {
      identity: { ownerId: this.ownerId, ...(roomId ? { roomId } : {}) },
      metadata: meta,
      clock: createServiceClock({ metadata: meta,
        derived: () => roomId && scope.startsWith("room:") ? { burst: this.rooms.get(roomId)?.humanInputDeadline() } : {},
        publish: (_at, persist) => this.publishDeadline(persist) }),
      ctx, sql: this.ctx.storage.sql, env: this.env, services: this.services,
      broadcast: (frame) => {
        const raw = JSON.stringify(frame)
        for (const socket of ctx.getWebSockets()) {
          const attachment = socket.deserializeAttachment() as { ready?: boolean } | null
          if (!attachment?.ready) continue
          try { socket.send(raw) } catch {}
        }
      },
    }
  }

  private async enqueueRun(agent: string, requestId: string): Promise<void> {
    const [roomId, slug, ...extra] = agent.split(":")
    if (!isRoomId(roomId) || !slug || extra.length) throw new Error("bad agent key")
    const incoming = this.incoming.getStore()
    if (incoming) {
      incoming.set(agent, requestId)
      if (this.connected()) return
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO owner_runs (agent, room_id, slug, request_id, ready_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET ready_at = min(owner_runs.ready_at, excluded.ready_at), version = owner_runs.version + 1`,
      agent, roomId, slug, requestId, Date.now() + (this.runs.has(agent) ? RECOVERY_DELAY_MS : 0),
    )
    await this.refreshClock()
  }

  private async humanInput<T>(admit: () => Promise<T>): Promise<T> {
    const requested = new Map<string, string>()
    const result = await this.incoming.run(requested, admit)
    const budget = this.runs.budget()
    const outcomes = await Promise.allSettled([...requested].map(async ([key, requestId]) => {
      const [roomId, slug] = key.split(":")
      if (!roomId || !slug) throw new Error("bad agent key")
      const ticket = this.ctx.storage.sql.exec<QueuedRun>(
        "SELECT agent, room_id, slug, request_id, version FROM owner_runs WHERE agent = ?", key,
      ).toArray()[0]
      await this.executeRun(ticket ?? { agent: key, room_id: roomId, slug, request_id: requestId }, budget)
    }))
    await this.refreshClock()
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason
    return result
  }

  private async executeRun(queued: Run | QueuedRun, budget?: RunBudget): Promise<void> {
    if (this.runs.has(queued.agent)) return
    try {
      await this.runs.run(queued.agent, queued.request_id, async (budget) => {
        const agent = this.agent(queued.room_id, queued.slug)
        return agent.runInvocation(() => budget.due())
      }, budget)
    } finally {
      if ("version" in queued) this.ctx.storage.sql.exec("DELETE FROM owner_runs WHERE agent = ? AND version = ?", queued.agent, queued.version)
      else this.ctx.storage.sql.exec("DELETE FROM owner_runs WHERE agent = ? AND request_id = ?", queued.agent, "socket-recovery")
    }
  }

  private async cancelRun(roomId: string, slug: string): Promise<void> {
    const agent = `${roomId}:${slug}`
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM owner_runs WHERE agent = ?", agent)
      this.ctx.storage.sql.exec("DELETE FROM owner_meta WHERE scope = ? AND key = 'clock:application'", `agent:${agent}`)
    })
    await this.refreshClock()
  }

  async dispatchRun(roomId: string, slug: string): Promise<void> {
    await this.runs.start(`${roomId}:${slug}`, "pending")
  }

  private async afterRun(roomId: string, slug: string): Promise<void> {
    await this.afterRunHook.run(roomId, slug)
  }

  protected user(): User {
    return this.settings ??= new User(this.options("user"))
  }

  protected room(roomId: string): Room {
    if (!isRoomId(roomId)) throw new Error("bad room id")
    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Room(this.options(`room:${roomId}`, roomId))
      this.rooms.set(roomId, room)
    }
    return room
  }

  protected agent(roomId: string, slug: string): Agent {
    const key = `${roomId}:${slug}`
    let agent = this.agents.get(key)
    if (!agent) {
      agent = new Agent({ ...this.options(`agent:${key}`, roomId),
        identity: { ownerId: this.ownerId, roomId, slug },
        requestRun: (requestId) => this.runs.start(key, requestId),
        countOutgoing: () => this.runs.count(key),
      })
    }
    this.agents.delete(key)
    this.agents.set(key, agent)
    return agent
  }

  private trimming?: Promise<void>
  private trimAgents(): Promise<void> {
    return this.trimming ??= this.evictAgents().finally(() => { this.trimming = undefined })
  }

  private async evictAgents(): Promise<void> {
    let loaded = [...this.agents.values()].filter((agent) => agent.loaded()).length
    for (const agent of this.agents.values()) {
      if (loaded <= 8) break
      if (!agent.loaded() || await agent.busy()) continue
      await agent.unload()
      loaded--
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected a websocket upgrade", { status: 426 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ user: { ready: false }, rooms: {}, handle: request.headers.get(HANDLE_HEADER) ?? undefined })
    await this.user().openSocket(socketView(server), request)
    this.ctx.waitUntil(this.resumeSocket())
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_FRAME) { ws.close(1008, "bad frame"); return }
    let frame: unknown
    try { frame = JSON.parse(raw) } catch { ws.close(1008, "bad frame"); return }
    if (!frame || typeof frame !== "object" || !("t" in frame)) { ws.close(1008, "bad frame"); return }
    if (frame.t === "subscribe" || frame.t === "unsubscribe" || frame.t === "room") {
      if (!("roomId" in frame) || typeof frame.roomId !== "string" || !isRoomId(frame.roomId)) { ws.close(1008, "bad room id"); return }
      const saved = ownerAttachment(ws)
      if (!saved.user.ready) { ws.close(1008, "hello required"); return }
      const roomId = frame.roomId
      if (frame.t === "unsubscribe") {
        delete saved.rooms[roomId]
        ws.serializeAttachment(saved)
        return
      }
      if (frame.t === "subscribe") {
        if (!("lastSeq" in frame) || !Number.isSafeInteger(frame.lastSeq) || Number(frame.lastSeq) < 0 || Object.keys(saved.rooms).length >= 32 && !saved.rooms[roomId]) { ws.close(1008, "bad subscription"); return }
        saved.rooms[roomId] = { ready: false }
        ws.serializeAttachment(saved)
        await this.room(roomId).subscribe(socketView(ws, roomId), Number(frame.lastSeq), saved.handle)
        return
      }
      if (!saved.rooms[roomId] || !("frame" in frame)) { ws.close(1008, "room not subscribed"); return }
      await this.humanInput(() => this.room(roomId).webSocketMessage(socketView(ws, roomId), JSON.stringify(frame.frame)))
      return
    }
    await this.humanInput(() => this.user().webSocketMessage(socketView(ws), raw))
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.user().webSocketClose(socketView(ws), code)
    await this.recoverDisconnected()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.user().webSocketError(socketView(ws))
    await this.recoverDisconnected()
  }

  async alarm(): Promise<void> {
    if (this.alarmRunning) return
    this.alarmRunning = true
    try {
      const due = this.ctx.storage.sql.exec<{ scope: string; at: number }>(`SELECT scope, at FROM (${DEADLINES}) WHERE at <= ? ORDER BY at, scope`, Date.now()).toArray()
      for (const { scope, at } of due) {
        if (scope.startsWith("agent:")) {
          const key = scope.slice("agent:".length)
          const [roomId, slug, ...extra] = key.split(":")
          if (!isRoomId(roomId) || !slug || extra.length) throw new Error("bad agent deadline")
          this.ctx.storage.sql.exec(
            "INSERT OR IGNORE INTO owner_runs (agent, room_id, slug, request_id, ready_at) VALUES (?, ?, ?, ?, ?)",
            key, roomId, slug, "recovery", at,
          )
          continue
        }
        if (scope === "user") await this.user().alarm()
        else if (scope.startsWith("room:")) await this.room(scope.slice("room:".length)).alarm()
      }
      if (!this.connected()) for (const roomId of await this.pendingRooms()) {
        const at = this.rooms.get(roomId)?.humanInputDeadline()
        if (at !== undefined && at <= Date.now()) await this.room(roomId).alarm()
      }
      if (Date.now() >= this.nextRunAt) {
        const queued = this.ctx.storage.sql.exec<QueuedRun>(
          "SELECT agent, room_id, slug, request_id, version FROM owner_runs WHERE ready_at <= ? ORDER BY ready_at, agent LIMIT 1", Date.now(),
        ).toArray()[0]
        if (queued) {
          try {
            if (this.runs.has(queued.agent)) {
              this.ctx.storage.sql.exec("UPDATE owner_runs SET ready_at = ? WHERE agent = ?", Date.now() + RECOVERY_DELAY_MS, queued.agent)
            } else await this.executeRun(queued)
          } finally {
            this.nextRunAt = Date.now() + RUN_GAP_MS
          }
        }
      }
      await this.trimAgents()
    } finally {
      this.alarmRunning = false
    }
    await this.refreshClock()
  }

  private connected(): boolean {
    return this.ctx.getWebSockets().some((socket) => socket.readyState === WebSocket.OPEN)
  }

  private async pendingRooms(): Promise<string[]> {
    const result: string[] = []
    const rooms = this.ctx.storage.sql.exec<{ room_id: string }>("SELECT room_id FROM room_directory").toArray()
    for (const { room_id } of rooms) {
      const room = this.room(room_id)
      await room.restoreHumanInput()
      if (room.humanInputPending()) result.push(room_id)
    }
    return result
  }

  private async unfinishedRuns(): Promise<Run[]> {
    const result: Run[] = []
    const keys = this.ctx.storage.sql.exec<{ agent: string }>("SELECT DISTINCT agent FROM journal").toArray()
    for (const { agent: key } of keys) {
      const [roomId, slug] = key.split(":")
      if (!roomId || !slug || !await this.agent(roomId, slug).unfinished()) continue
      result.push({ agent: key, room_id: roomId, slug, request_id: "recovery" })
    }
    return result
  }

  private async resumeSocket(): Promise<void> {
    await this.humanInput(async () => {
      for (const roomId of await this.pendingRooms()) await this.room(roomId).settleHumanInput()
      for (const run of await this.unfinishedRuns()) this.incoming.getStore()?.set(run.agent, run.request_id)
    })
  }

  private async recoverDisconnected(): Promise<void> {
    if (this.connected()) return
    for (const run of await this.unfinishedRuns()) {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO owner_runs (agent, room_id, slug, request_id, ready_at) VALUES (?, ?, ?, ?, ?)",
        run.agent, run.room_id, run.slug, "socket-recovery", Date.now() + RECOVERY_DELAY_MS,
      )
    }
    await this.refreshClock()
  }

  private async refreshClock(): Promise<void> {
    if (this.alarmRunning) return
    await this.clock.refresh()
  }

  async userCall<M extends Method<User>>(method: M, args: Args<User[M]>): Promise<Result<User[M]>> {
    const user = this.user()
    const call = user[method] as (...args: Args<User[M]>) => Result<User[M]>
    return call.apply(user, args)
  }

  async roomCall<M extends Method<Room>>(roomId: string, method: M, args: Args<Room[M]>): Promise<Result<Room[M]>> {
    const room = this.room(roomId)
    const call = room[method] as (...args: Args<Room[M]>) => Result<Room[M]>
    if (method === "humanSend" || method === "answerAsk" || method === "skipAsk" || method === "retryRun") {
      return this.humanInput(async () => {
        const result = await call.apply(room, args)
        await room.settleHumanInput()
        return result
      })
    }
    return call.apply(room, args)
  }

  async agentCall<M extends Method<Agent>>(roomId: string, slug: string, method: M, args: Args<Agent[M]>): Promise<Result<Agent[M]>> {
    const agent = this.agent(roomId, slug)
    const call = agent[method] as (...args: Args<Agent[M]>) => Result<Agent[M]>
    return call.apply(agent, args)
  }

  blobPut(...args: Parameters<BlobStore["put"]>) { return this.blobs.put(...args) }
  async blobGet(...args: Parameters<BlobStore["get"]>) { return this.blobs.get(...args) }
  async blobHead(...args: Parameters<BlobStore["head"]>) { return this.blobs.head(...args) }
  async blobRemove(...args: Parameters<BlobStore["remove"]>) { return this.blobs.remove(...args) }
  async blobStartUpload(...args: Parameters<BlobStore["startUpload"]>) { return this.blobs.startUpload(...args) }
  blobPutPart(...args: Parameters<BlobStore["putPart"]>) { return this.blobs.putPart(...args) }
  async blobFinish(...args: Parameters<BlobStore["finish"]>) { return this.blobs.finish(...args) }
  async blobAbort(...args: Parameters<BlobStore["abort"]>) { return this.blobs.abort(...args) }

}


