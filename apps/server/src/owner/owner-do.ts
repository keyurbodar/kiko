import { DurableObject } from "cloudflare:workers"
import { Runs } from "./runs"
import { isAgentSlug, isRoomId, MAX_FRAME, type UpdateState } from "@kiko/protocol"
import { Agent } from "../agent/agent-do"
import { Room } from "../room/room-do"
import { liveUploadIds, PENDING_TTL_MS } from "../room/pending"
import { User } from "../user/user-do"
import { restoreCustom } from "../user/custom-providers"
import { restoreOverlay } from "../models/sync"
import type { Env } from "../index"
import { BlobStore } from "../files/blob-store"
import { fileStore, localBucket } from "../files/store"
import { instrument } from "../lib/dev-guard"
import { HANDLE_HEADER } from "../lib/names"
import type { OwnerServices, ServiceOptions } from "./services"
import { AgentKeyError, EgressError } from "./errors"
import { serviceContext, metadata } from "./context"
import { Clock, createServiceClock, RECOVERY_DELAY_MS } from "./clock"
import { AfterRun } from "./after-run"
import { initializeSchema } from "./schema"
import { openAttachment, ownerAttachment, socketView } from "./socket"
import { CONNECT_HEADERS } from "@kiko/computer/sign"
import { ComputerHub, pcSocketId } from "../computer/hub"
import { ComputerStore } from "../computer/store"
import { dispatch } from "../rpc/dispatcher"
import { HANDLERS, type RpcHost } from "../rpc/handlers"
import { makeStreams } from "../rpc/subscriptions"
import { RPC_PING, RPC_PONG } from "../rpc/wire"

type Method<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T]
type Args<T> = T extends (...args: infer A) => unknown ? A : never
type Result<T> = T extends (...args: never[]) => infer R ? Awaited<R> : never
type Run = { agent: string; room_id: string; slug: string; request_id: string }
type QueuedRun = Run & { version: number; continues: number }

const RUN_GAP_MS = 250
const LEGACY_PING = "ping"
const LEGACY_PONG = "pong"

const DEADLINES = `SELECT m.scope, min(j.value) AS at FROM owner_meta m, json_each(m.value) j WHERE m.key = 'clock:application' GROUP BY m.scope`

export class OwnerDO extends DurableObject<Env> {
  private readonly runs: Runs
  protected readonly services: OwnerServices
  private readonly rooms = new Map<string, Room>()
  private readonly agents = new Map<string, Agent>()
  private readonly blobs: BlobStore
  private readonly computers: ComputerHub
  private readonly ownerId: string
  private settings?: User
  private readonly clock: Clock
  private readonly afterRunHook = new AfterRun({ services: () => this.services })
  private alarmRunning = false
  private readonly rpcHost: RpcHost = {
    streams: makeStreams({ user: () => this.user(), room: (roomId) => this.room(roomId) }),
    user: () => this.user(),
    room: (roomId) => this.room(roomId).commands,
    streamEnded: (stream) => this.user().pc.ended(stream),
  }
  private nextRunAt = 0

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    instrument(ctx, "owner")
    const name = ctx.id.name ?? "owner"
    this.ownerId = name === "owner" ? "owner" : name.replace(/^owner:/, "")
    initializeSchema(ctx.storage)
    restoreOverlay(ctx.storage.sql)
    restoreCustom(ctx.storage.sql)
    this.clock = new Clock(ctx.storage, async () => {
      const queued = ctx.storage.sql.exec<{ at: number | null }>("SELECT min(ready_at) AS at FROM owner_runs").one().at
      return {
        loaded: [],
        unloaded: ctx.storage.sql
          .exec<{ at: number }>(
            `SELECT at FROM (${DEADLINES}) d WHERE NOT EXISTS (SELECT 1 FROM owner_runs r WHERE d.scope = 'agent:' || r.agent)`,
          )
          .toArray()
          .map((row) => row.at),
        queued: queued === null ? undefined : Math.max(queued, this.nextRunAt),
        burst: this.connected()
          ? undefined
          : (await this.pendingRooms()).reduce<number | undefined>((next, room) => {
              const at = this.room(room).humanInputDeadline()
              return at === undefined ? next : Math.min(next ?? at, at)
            }, undefined),
      }
    })
    this.runs = new Runs({
      schedule: (agent, requestId, behind) => this.enqueueRun(agent, requestId, behind),
      halt: (agent) => this.haltRun(agent),
    })
    this.blobs = new BlobStore(this.ctx)
    const computers = new ComputerStore(ctx.storage.sql)
    if (env.OWNER_ID) computers.followOwner(env.OWNER_ID)
    this.computers = new ComputerHub({
      ctx,
      env,
      store: computers,
      ownerId: this.ownerId,
      released: (out) => this.user().computerReleased(out),
      wakeup: {
        set: (at) => this.user().setComputerWakeup(at),
        clear: () => this.user().clearComputerWakeup(),
      },
    })

    this.services = {
      user: () => this.user(),
      room: (roomId) => this.room(roomId),
      agent: (roomId, slug) => this.agent(roomId, slug),
      files: () => (env.FILES ? fileStore(env) : localBucket(this.blobs)),
      sweepUploads: (before) => this.sweepUploads(before),
      egress: async (request) => {
        if (new URL(request.url).protocol !== "https:")
          throw new EgressError({ url: request.url, message: "egress is https only" })
        if (!request.spare) this.runs.countActive()
        else if (!this.runs.spareActive())
          throw new EgressError({
            url: request.url,
            message:
              "this step used its share of the run's network calls. Finish this step; the run then continues with a fresh budget, and the rest of the fetches can go in your next command",
          })
        return fetch(request.url, {
          redirect: "manual",
          method: request.method,
          headers: request.headers,
          ...(request.body ? { body: request.body } : {}),
        })
      },
      countOutgoing: () => this.runs.countActive(),
      runShared: (roomId, slug) => this.runs.shared(`${roomId}:${slug}`),
      trimAgents: () => this.trimAgents(),
      dispatchRun: (roomId, slug) => this.dispatchRun(roomId, slug),
      cancelRun: (roomId, slug) => this.cancelRun(roomId, slug),
      afterRun: (roomId, _slug, human) => this.afterRun(roomId, human),
      syncRoutines: (routines) => this.user().syncRoutines(routines),
      fireRoutine: (delivery) => this.user().fireRoutine(delivery),
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(RPC_PING, RPC_PONG))
  }

  private context(roomId?: string): DurableObjectState {
    return serviceContext(this.ctx, () =>
      this.ctx
        .getWebSockets("tab")
        .filter((ws) => roomId === undefined || ownerAttachment(ws).rooms[roomId] !== undefined)
        .map((ws) => socketView(ws, roomId)),
    )
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
      clock: createServiceClock({
        metadata: meta,
        derived: () =>
          roomId && scope.startsWith("room:") ? { burst: this.rooms.get(roomId)?.humanInputDeadline() } : {},
        publish: (_at, persist) => this.publishDeadline(persist),
      }),
      ctx,
      sql: this.ctx.storage.sql,
      env: this.env,
      services: this.services,
      computers: this.computers,
      broadcast: (frame) => {
        const raw = JSON.stringify(frame)
        for (const socket of ctx.getWebSockets("tab")) {
          const attachment = socket.deserializeAttachment() as { ready?: boolean } | null
          if (!attachment?.ready) continue
          try {
            socket.send(raw)
          } catch {}
        }
      },
    }
  }

  private async enqueueRun(agent: string, requestId: string, behind = false): Promise<void> {
    const [roomId, slug, ...extra] = agent.split(":")
    if (!isRoomId(roomId) || !slug || extra.length)
      throw new AgentKeyError({ kind: "agent_key", key: agent, message: "bad agent key" })
    this.ctx.storage.sql.exec(
      `INSERT INTO owner_runs (agent, room_id, slug, request_id, ready_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET ready_at = ${behind ? "excluded.ready_at" : "min(owner_runs.ready_at, excluded.ready_at)"}, version = owner_runs.version + 1${behind ? ", continues = owner_runs.continues + 1" : ", continues = 0"}`,
      agent,
      roomId,
      slug,
      requestId,
      Date.now(),
    )
    this.runs.waiting(agent)
    const running = this.runs.running()
    if (running && running !== agent && isAgentSlug(slug)) this.room(roomId).waitingTurn(slug, this.nameOf(running))
    await this.refreshClock()
  }

  private async executeRun(queued: QueuedRun): Promise<void> {
    try {
      await this.runs.run(
        queued.agent,
        queued.request_id,
        async (budget) => {
          if (this.othersWaiting(queued.agent)) budget.share()
          if (isAgentSlug(queued.slug)) this.room(queued.room_id).turnStarted(queued.slug)
          this.showWaiting(queued)
          const agent = this.agent(queued.room_id, queued.slug)
          return agent.runInvocation(() => budget.due(() => this.othersWaiting(queued.agent)))
        },
        queued.continues,
      )
    } finally {
      this.ctx.storage.sql.exec("DELETE FROM owner_runs WHERE agent = ? AND version = ?", queued.agent, queued.version)
    }
  }

  private async haltRun(agent: string): Promise<void> {
    const [roomId = "", slug = ""] = agent.split(":")
    if (!isAgentSlug(slug)) {
      await this.agent(roomId, slug).stop()
      return
    }
    const room = this.room(roomId)
    await room.halted(slug, "stopped: this request ran long, so it was paused. say continue to keep going.")
    await this.agent(roomId, slug).stop()
    await room.setStatus(slug, "idle")
  }

  private nameOf(agent: string): string {
    const [roomId = "", slug = ""] = agent.split(":")
    return (isAgentSlug(slug) && this.room(roomId).memberName(slug)) || slug
  }

  private showWaiting(running: QueuedRun): void {
    const name = this.nameOf(running.agent)
    const waiting = this.ctx.storage.sql
      .exec<{ room_id: string; slug: string }>("SELECT room_id, slug FROM owner_runs WHERE agent != ?", running.agent)
      .toArray()
    for (const row of waiting) if (isAgentSlug(row.slug)) this.room(row.room_id).waitingTurn(row.slug, name)
  }

  private othersWaiting(agent: string): boolean {
    return (
      this.ctx.storage.sql
        .exec("SELECT 1 FROM owner_runs WHERE agent != ? AND ready_at <= ? LIMIT 1", agent, Date.now())
        .toArray().length > 0
    )
  }

  private async cancelRun(roomId: string, slug: string): Promise<void> {
    const agent = `${roomId}:${slug}`
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM owner_runs WHERE agent = ?", agent)
      this.ctx.storage.sql.exec(
        "DELETE FROM owner_meta WHERE scope = ? AND key = 'clock:application'",
        `agent:${agent}`,
      )
    })
    await this.refreshClock()
  }

  async dispatchRun(roomId: string, slug: string): Promise<void> {
    await this.runs.start(`${roomId}:${slug}`, "pending")
  }

  private async afterRun(roomId: string, human: boolean): Promise<void> {
    await this.afterRunHook.run(roomId, human)
  }

  protected user(): User {
    if (this.settings) return this.settings
    const user = new User({ ...this.options("user"), computers: this.computers })
    this.settings = user
    return user
  }

  async pcPair(input: {
    publicKey: string
    name: string
    hello: import("@kiko/computer/wire").Hello
    pairNonce: string
    replaces?: string
  }) {
    return this.user().computerPair(input)
  }

  async updateStart(version: string): Promise<UpdateState> {
    return this.user().selfUpdate.start(version)
  }

  async updateState(): Promise<UpdateState> {
    return this.user().selfUpdate.state()
  }

  protected room(roomId: string): Room {
    if (!isRoomId(roomId)) throw new AgentKeyError({ kind: "room", key: roomId, message: "bad room id" })
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
      agent = new Agent({
        ...this.options(`agent:${key}`, roomId),
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
    return (this.trimming ??= this.evictAgents().finally(() => {
      this.trimming = undefined
    }))
  }

  private async evictAgents(): Promise<void> {
    let loaded = [...this.agents.values()].filter((agent) => agent.loaded()).length
    for (const agent of this.agents.values()) {
      if (loaded <= 8) break
      if (!agent.loaded() || (await agent.busy())) continue
      await agent.unload()
      loaded--
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get(CONNECT_HEADERS.id) !== null) return this.computers.connect(request)
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("expected a websocket upgrade", { status: 426 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server, ["tab"])
    server.serializeAttachment(openAttachment(request.headers.get(HANDLE_HEADER) ?? undefined))
    await this.user().openSocket(socketView(server), request)
    this.ctx.waitUntil(this.resumeSocket())
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (raw === LEGACY_PING) return ws.send(LEGACY_PONG)
    if (pcSocketId(ws) !== null) return this.computers.message(ws, raw)
    if (typeof raw === "string" && raw.length > MAX_FRAME) return ws.close(1009, "rpc frame too large")
    await dispatch(HANDLERS, { host: this.rpcHost, ws, socket: socketView(ws) }, raw)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    if (pcSocketId(ws) !== null) {
      await this.computers.close(ws)
      await this.refreshClock()
      return
    }
    await this.user().webSocketClose(socketView(ws), code)
    this.computers.leave(ws)
    await this.recoverDisconnected()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    if (pcSocketId(ws) !== null) {
      await this.computers.close(ws)
      await this.refreshClock()
      return
    }
    await this.user().webSocketError(socketView(ws))
    this.computers.leave(ws)
    await this.recoverDisconnected()
  }

  async alarm(): Promise<void> {
    if (this.alarmRunning) return
    this.alarmRunning = true
    try {
      const due = this.ctx.storage.sql
        .exec<{ scope: string; at: number }>(
          `SELECT scope, at FROM (${DEADLINES}) WHERE at <= ? ORDER BY at, scope`,
          Date.now(),
        )
        .toArray()
      for (const { scope, at } of due) {
        try {
          if (scope.startsWith("agent:")) {
            const key = scope.slice("agent:".length)
            const [roomId, slug, ...extra] = key.split(":")
            if (!isRoomId(roomId) || !slug || extra.length)
              throw new AgentKeyError({ kind: "deadline", key, message: "bad agent deadline" })
            this.ctx.storage.sql.exec(
              "INSERT OR IGNORE INTO owner_runs (agent, room_id, slug, request_id, ready_at) VALUES (?, ?, ?, ?, ?)",
              key,
              roomId,
              slug,
              "recovery",
              at,
            )
            continue
          }
          if (scope === "user") await this.user().alarm()
          else if (scope.startsWith("room:")) await this.room(scope.slice("room:".length)).alarm()
        } catch (error) {
          console.error(`clock ${scope} failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (!this.connected())
        for (const roomId of await this.pendingRooms()) {
          const at = this.rooms.get(roomId)?.humanInputDeadline()
          if (at !== undefined && at <= Date.now()) await this.room(roomId).alarm()
        }
      if (Date.now() >= this.nextRunAt) {
        const queued = this.ctx.storage.sql
          .exec<QueuedRun>(
            "SELECT agent, room_id, slug, request_id, version, continues FROM owner_runs WHERE ready_at <= ? ORDER BY ready_at, agent LIMIT 1",
            Date.now(),
          )
          .toArray()[0]
        if (queued) {
          try {
            await this.executeRun(queued)
          } finally {
            this.nextRunAt = Date.now() + RUN_GAP_MS
          }
        }
      }
      await this.trimAgents()
    } finally {
      this.alarmRunning = false
      await this.refreshClock()
    }
  }

  private connected(): boolean {
    return this.ctx.getWebSockets("tab").some((socket) => socket.readyState === WebSocket.OPEN)
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
      if (!roomId || !slug || !(await this.agent(roomId, slug).unfinished())) continue
      result.push({ agent: key, room_id: roomId, slug, request_id: "recovery" })
    }
    return result
  }

  private async resumeSocket(): Promise<void> {
    for (const roomId of await this.pendingRooms()) await this.room(roomId).settleHumanInput()
    for (const run of await this.unfinishedRuns())
      if (!this.runs.has(run.agent)) await this.enqueueRun(run.agent, run.request_id)
  }

  private async recoverDisconnected(): Promise<void> {
    if (this.connected()) return
    for (const run of await this.unfinishedRuns()) {
      this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO owner_runs (agent, room_id, slug, request_id, ready_at) VALUES (?, ?, ?, ?, ?)",
        run.agent,
        run.room_id,
        run.slug,
        "socket-recovery",
        Date.now() + RECOVERY_DELAY_MS,
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
      const result = await call.apply(room, args)
      await room.settleHumanInput()
      return result
    }
    return call.apply(room, args)
  }

  async agentCall<M extends Method<Agent>>(
    roomId: string,
    slug: string,
    method: M,
    args: Args<Agent[M]>,
  ): Promise<Result<Agent[M]>> {
    const agent = this.agent(roomId, slug)
    const call = agent[method] as (...args: Args<Agent[M]>) => Result<Agent[M]>
    return call.apply(agent, args)
  }

  blobPut(...args: Parameters<BlobStore["put"]>) {
    return this.blobs.put(...args)
  }
  async blobGet(...args: Parameters<BlobStore["get"]>) {
    return this.blobs.get(...args)
  }
  async blobHead(...args: Parameters<BlobStore["head"]>) {
    return this.blobs.head(...args)
  }
  async blobRemove(...args: Parameters<BlobStore["remove"]>) {
    return this.blobs.remove(...args)
  }
  async blobStartUpload(...args: Parameters<BlobStore["startUpload"]>) {
    this.sweepUploads(Date.now() - PENDING_TTL_MS)
    return this.blobs.startUpload(...args)
  }
  blobPutPart(...args: Parameters<BlobStore["putPart"]>) {
    return this.blobs.putPart(...args)
  }
  async blobFinish(...args: Parameters<BlobStore["finish"]>) {
    return this.blobs.finish(...args)
  }
  async blobAbort(...args: Parameters<BlobStore["abort"]>) {
    return this.blobs.abort(...args)
  }

  private sweepUploads(before: number): number {
    return this.blobs.sweep(before, liveUploadIds(this.ctx.storage.sql))
  }
}
