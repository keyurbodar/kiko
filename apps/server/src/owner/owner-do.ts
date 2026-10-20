import { DurableObject } from "cloudflare:workers"
import { Runs } from "./runs"
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
import { scopedContext } from "./context"
import { Clock } from "./clock"
import { ownerAttachment, socketView } from "./socket"

type Method<T> = { [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never }[keyof T]
type Args<T> = T extends (...args: infer A) => unknown ? A : never
type Result<T> = T extends (...args: never[]) => infer R ? Awaited<R> : never

export class OwnerDO extends DurableObject<Env> {
  private readonly runs: Runs
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    instrument(ctx, "owner")
    const name = ctx.id.name ?? "owner"
    this.ownerId = name === "owner" ? "owner" : name.replace(/^owner:/, "")
    initializeSchema(ctx.storage)
    this.clock = new Clock(ctx.storage, () => ({ loaded: [], unloaded: ctx.storage.sql.exec<{ at: number }>("SELECT at FROM owner_deadlines").toArray().map((row) => row.at) }))
    this.runs = new Runs({
      dispatch: async (agent, requestId) => { ctx.waitUntil(env.OWNER.get(ctx.id).run(agent, requestId)) },
      schedule: async (agent) => { await this.context(`agent:${this.ownerId}:${agent}`).storage.setAlarm(Date.now()) },
    })
    this.blobs = new BlobStore(this.context(`files:${this.ownerId}`))
    this.blobs.initialize()
    this.services = {
      user: () => this.user(),
      room: (roomId) => this.room(roomId),
      agent: (roomId, slug) => this.agent(roomId, slug),
      files: () => env.FILES ? fileStore(env) : localBucket(this.blobs),
      egress: async (request) => {
        if (new URL(request.url).protocol !== "https:") throw new Error("egress is https only")
        // check-rules: allow egress OwnerDO owns the agent's outgoing request.
        return fetch(request.url, { method: request.method, headers: request.headers, ...(request.body ? { body: request.body } : {}) })
      },
      trimAgents: () => this.trimAgents(),
      dispatchRun: (roomId, slug) => this.dispatchRun(roomId, slug),
      afterRun: (roomId, slug) => this.afterRun(roomId, slug),
    }
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
  }

  private context(name: string): DurableObjectState {
    return scopedContext(this.ctx, name, () => {
      const roomId = name.startsWith("room:") ? name.slice(`room:${this.ownerId}:`.length) : undefined
      return this.ctx.getWebSockets().filter((ws) => roomId === undefined || ownerAttachment(ws).rooms[roomId] !== undefined).map((ws) => socketView(ws, roomId))
    }, () => this.refreshClock())
  }

  private options(name: string): ServiceOptions {
    const ctx = this.context(name)
    return {
      ctx, sql: ctx.storage.sql, env: this.env, services: this.services,
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

  async dispatchRun(roomId: string, slug: string): Promise<void> {
    await this.runs.start(`${roomId}:${slug}`, "pending")
  }

  async run(agent: string, requestId: string): Promise<void> {
    const [roomId, slug, ...extra] = agent.split(":")
    if (!isRoomId(roomId) || !slug || extra.length) throw new Error("bad agent key")
    await this.runs.run(agent, requestId, (budget) => this.agent(roomId, slug).runInvocation(() => budget.due()))
  }

  private async afterRun(roomId: string, slug: string): Promise<void> {
    await afterRun(this.ctx.storage, roomId, slug)
    await archive(this.ctx.storage, roomId)
  }

  private user(): User {
    return this.settings ??= new User(this.options(`user:${this.ownerId}`))
  }

  private room(roomId: string): Room {
    if (!isRoomId(roomId)) throw new Error("bad room id")
    let room = this.rooms.get(roomId)
    if (!room) {
      room = new Room(this.options(`room:${this.ownerId}:${roomId}`))
      this.rooms.set(roomId, room)
    }
    return room
  }

  private agent(roomId: string, slug: string): Agent {
    const key = `${roomId}:${slug}`
    let agent = this.agents.get(key)
    if (!agent) {
      agent = new Agent({ ...this.options(`agent:${this.ownerId}:${key}`),
        requestRun: (requestId) => this.runs.start(key, requestId),
        countOutgoing: () => this.runs.count(key),
      })
      agent.initialize()
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
      await this.room(roomId).webSocketMessage(socketView(ws, roomId), JSON.stringify(frame.frame))
      return
    }
    await this.user().webSocketMessage(socketView(ws), raw)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.user().webSocketClose(socketView(ws), code)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.user().webSocketError(socketView(ws))
  }

  async alarm(): Promise<void> {
    const due = this.ctx.storage.sql.exec<{ scope: string }>("SELECT scope FROM owner_deadlines WHERE at <= ? ORDER BY at, scope", Date.now()).toArray()
    for (const { scope } of due) {
      this.ctx.storage.sql.exec("DELETE FROM owner_deadlines WHERE scope = ?", scope)
      if (scope.startsWith("user:")) await this.user().alarm()
      else if (scope.startsWith("room:")) await this.room(scope.slice(`room:${this.ownerId}:`.length)).alarm()
      else if (scope.startsWith("agent:")) {
        const [roomId, slug] = scope.slice(`agent:${this.ownerId}:`.length).split(":")
        if (roomId && slug) await this.dispatchRun(roomId, slug)
      }
    }
    await this.trimAgents()
    await this.refreshClock()
  }

  private async refreshClock(): Promise<void> {
    await this.clock.refresh()
  }

  async roomCall<M extends Method<Room>>(roomId: string, method: M, args: Args<Room[M]>): Promise<Result<Room[M]>> {
    const room = this.room(roomId)
    const call = room[method] as (...args: Args<Room[M]>) => Result<Room[M]>
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

  async listRoutines(...args: Parameters<User["listRoutines"]>): Promise<Awaited<ReturnType<User["listRoutines"]>>> { return this.user().listRoutines(...args) }
  async deleteRoutine(...args: Parameters<User["deleteRoutine"]>): Promise<Awaited<ReturnType<User["deleteRoutine"]>>> { return this.user().deleteRoutine(...args) }
  async cancelRoutine(...args: Parameters<User["cancelRoutine"]>): Promise<Awaited<ReturnType<User["cancelRoutine"]>>> { return this.user().cancelRoutine(...args) }
  async createRoutine(...args: Parameters<User["createRoutine"]>): Promise<Awaited<ReturnType<User["createRoutine"]>>> { return this.user().createRoutine(...args) }
  async updateRoutine(...args: Parameters<User["updateRoutine"]>): Promise<Awaited<ReturnType<User["updateRoutine"]>>> { return this.user().updateRoutine(...args) }
  async recipeList(...args: Parameters<User["recipeList"]>): Promise<Awaited<ReturnType<User["recipeList"]>>> { return this.user().recipeList(...args) }
  async recipeHints(...args: Parameters<User["recipeHints"]>): Promise<Awaited<ReturnType<User["recipeHints"]>>> { return this.user().recipeHints(...args) }
  async createAgentChat(...args: Parameters<User["createAgentChat"]>): Promise<Awaited<ReturnType<User["createAgentChat"]>>> { return this.user().createAgentChat(...args) }
  async editRecipe(...args: Parameters<User["editRecipe"]>): Promise<Awaited<ReturnType<User["editRecipe"]>>> { return this.user().editRecipe(...args) }
  async installRecipe(...args: Parameters<User["installRecipe"]>): Promise<Awaited<ReturnType<User["installRecipe"]>>> { return this.user().installRecipe(...args) }
  async uninstallRecipe(...args: Parameters<User["uninstallRecipe"]>): Promise<Awaited<ReturnType<User["uninstallRecipe"]>>> { return this.user().uninstallRecipe(...args) }
  async recipeBriefs(...args: Parameters<User["recipeBriefs"]>): Promise<Awaited<ReturnType<User["recipeBriefs"]>>> { return this.user().recipeBriefs(...args) }
  async recipeSkillText(...args: Parameters<User["recipeSkillText"]>): Promise<Awaited<ReturnType<User["recipeSkillText"]>>> { return this.user().recipeSkillText(...args) }
  async overview(...args: Parameters<User["overview"]>): Promise<Awaited<ReturnType<User["overview"]>>> { return this.user().overview(...args) }
  async devSeen(...args: Parameters<User["devSeen"]>): Promise<Awaited<ReturnType<User["devSeen"]>>> { return this.user().devSeen(...args) }
  async devSetting(...args: Parameters<User["devSetting"]>): Promise<Awaited<ReturnType<User["devSetting"]>>> { return this.user().devSetting(...args) }
  async devComposioSession(...args: Parameters<User["devComposioSession"]>): Promise<Awaited<ReturnType<User["devComposioSession"]>>> { return this.user().devComposioSession(...args) }
  async devCaptureQueue(...args: Parameters<User["devCaptureQueue"]>): Promise<Awaited<ReturnType<User["devCaptureQueue"]>>> { return this.user().devCaptureQueue(...args) }
  async devDue(...args: Parameters<User["devDue"]>): Promise<Awaited<ReturnType<User["devDue"]>>> { return this.user().devDue(...args) }
  async timezone(...args: Parameters<User["timezone"]>): Promise<Awaited<ReturnType<User["timezone"]>>> { return this.user().timezone(...args) }
  async publicOrigin(...args: Parameters<User["publicOrigin"]>): Promise<Awaited<ReturnType<User["publicOrigin"]>>> { return this.user().publicOrigin(...args) }
  async runRoutine(...args: Parameters<User["runRoutine"]>): Promise<Awaited<ReturnType<User["runRoutine"]>>> { return this.user().runRoutine(...args) }
  async routineRuns(...args: Parameters<User["routineRuns"]>): Promise<Awaited<ReturnType<User["routineRuns"]>>> { return this.user().routineRuns(...args) }
  async signals(...args: Parameters<User["signals"]>): Promise<Awaited<ReturnType<User["signals"]>>> { return this.user().signals(...args) }
  async routineHook(...args: Parameters<User["routineHook"]>): Promise<Awaited<ReturnType<User["routineHook"]>>> { return this.user().routineHook(...args) }
  async createChat(...args: Parameters<User["createChat"]>): Promise<Awaited<ReturnType<User["createChat"]>>> { return this.user().createChat(...args) }
  async renameChat(...args: Parameters<User["renameChat"]>): Promise<Awaited<ReturnType<User["renameChat"]>>> { return this.user().renameChat(...args) }
  async pinChat(...args: Parameters<User["pinChat"]>): Promise<Awaited<ReturnType<User["pinChat"]>>> { return this.user().pinChat(...args) }
  async deleteChat(...args: Parameters<User["deleteChat"]>): Promise<Awaited<ReturnType<User["deleteChat"]>>> { return this.user().deleteChat(...args) }
  async deleteAgent(...args: Parameters<User["deleteAgent"]>): Promise<Awaited<ReturnType<User["deleteAgent"]>>> { return this.user().deleteAgent(...args) }
  async roomChanged(...args: Parameters<User["roomChanged"]>): Promise<Awaited<ReturnType<User["roomChanged"]>>> { return this.user().roomChanged(...args) }
  async chatTyping(...args: Parameters<User["chatTyping"]>): Promise<Awaited<ReturnType<User["chatTyping"]>>> { return this.user().chatTyping(...args) }
  async searchChats(...args: Parameters<User["searchChats"]>): Promise<Awaited<ReturnType<User["searchChats"]>>> { return this.user().searchChats(...args) }
  async listChats(...args: Parameters<User["listChats"]>): Promise<Awaited<ReturnType<User["listChats"]>>> { return this.user().listChats(...args) }
  async chatMembers(...args: Parameters<User["chatMembers"]>): Promise<Awaited<ReturnType<User["chatMembers"]>>> { return this.user().chatMembers(...args) }
  async getChat(...args: Parameters<User["getChat"]>): Promise<Awaited<ReturnType<User["getChat"]>>> { return this.user().getChat(...args) }
  async createAgent(...args: Parameters<User["createAgent"]>): Promise<Awaited<ReturnType<User["createAgent"]>>> { return this.user().createAgent(...args) }
  async listAgents(...args: Parameters<User["listAgents"]>): Promise<Awaited<ReturnType<User["listAgents"]>>> { return this.user().listAgents(...args) }
  async soul(...args: Parameters<User["soul"]>): Promise<Awaited<ReturnType<User["soul"]>>> { return this.user().soul(...args) }
  async setSoul(...args: Parameters<User["setSoul"]>): Promise<Awaited<ReturnType<User["setSoul"]>>> { return this.user().setSoul(...args) }
  async homePut(...args: Parameters<User["homePut"]>): Promise<Awaited<ReturnType<User["homePut"]>>> { return this.user().homePut(...args) }
  async homeStat(...args: Parameters<User["homeStat"]>): Promise<Awaited<ReturnType<User["homeStat"]>>> { return this.user().homeStat(...args) }
  async homeList(...args: Parameters<User["homeList"]>): Promise<Awaited<ReturnType<User["homeList"]>>> { return this.user().homeList(...args) }
  async homeMove(...args: Parameters<User["homeMove"]>): Promise<Awaited<ReturnType<User["homeMove"]>>> { return this.user().homeMove(...args) }
  async homeRemove(...args: Parameters<User["homeRemove"]>): Promise<Awaited<ReturnType<User["homeRemove"]>>> { return this.user().homeRemove(...args) }
  async homeMkdir(...args: Parameters<User["homeMkdir"]>): Promise<Awaited<ReturnType<User["homeMkdir"]>>> { return this.user().homeMkdir(...args) }
  async homeCommit(...args: Parameters<User["homeCommit"]>): Promise<Awaited<ReturnType<User["homeCommit"]>>> { return this.user().homeCommit(...args) }
  async makeAgent(...args: Parameters<User["makeAgent"]>): Promise<Awaited<ReturnType<User["makeAgent"]>>> { return this.user().makeAgent(...args) }
  async openChat(...args: Parameters<User["openChat"]>): Promise<Awaited<ReturnType<User["openChat"]>>> { return this.user().openChat(...args) }
  async openPair(...args: Parameters<User["openPair"]>): Promise<Awaited<ReturnType<User["openPair"]>>> { return this.user().openPair(...args) }
  async seedSoul(...args: Parameters<User["seedSoul"]>): Promise<Awaited<ReturnType<User["seedSoul"]>>> { return this.user().seedSoul(...args) }
  async getTheme(...args: Parameters<User["getTheme"]>): Promise<Awaited<ReturnType<User["getTheme"]>>> { return this.user().getTheme(...args) }
  async setTheme(...args: Parameters<User["setTheme"]>): Promise<Awaited<ReturnType<User["setTheme"]>>> { return this.user().setTheme(...args) }
  async lifeNote(...args: Parameters<User["lifeNote"]>): Promise<Awaited<ReturnType<User["lifeNote"]>>> { return this.user().lifeNote(...args) }
  async lifeRecall(...args: Parameters<User["lifeRecall"]>): Promise<Awaited<ReturnType<User["lifeRecall"]>>> { return this.user().lifeRecall(...args) }
  async captureHuman(...args: Parameters<User["captureHuman"]>): Promise<Awaited<ReturnType<User["captureHuman"]>>> { return this.user().captureHuman(...args) }
  async forgetMessages(...args: Parameters<User["forgetMessages"]>): Promise<Awaited<ReturnType<User["forgetMessages"]>>> { return this.user().forgetMessages(...args) }
  async lifeZoom(...args: Parameters<User["lifeZoom"]>): Promise<Awaited<ReturnType<User["lifeZoom"]>>> { return this.user().lifeZoom(...args) }
  async memoryUsage(...args: Parameters<User["memoryUsage"]>): Promise<Awaited<ReturnType<User["memoryUsage"]>>> { return this.user().memoryUsage(...args) }
  async compress(...args: Parameters<User["compress"]>): Promise<Awaited<ReturnType<User["compress"]>>> { return this.user().compress(...args) }
  async providerKeyRefused(...args: Parameters<User["providerKeyRefused"]>): Promise<Awaited<ReturnType<User["providerKeyRefused"]>>> { return this.user().providerKeyRefused(...args) }
  async connectProvider(...args: Parameters<User["connectProvider"]>): Promise<Awaited<ReturnType<User["connectProvider"]>>> { return this.user().connectProvider(...args) }
  async disconnectProvider(...args: Parameters<User["disconnectProvider"]>): Promise<Awaited<ReturnType<User["disconnectProvider"]>>> { return this.user().disconnectProvider(...args) }
  async modelCatalog(...args: Parameters<User["modelCatalog"]>): Promise<Awaited<ReturnType<User["modelCatalog"]>>> { return this.user().modelCatalog(...args) }
  async devModelOverlay(...args: Parameters<User["devModelOverlay"]>): Promise<Awaited<ReturnType<User["devModelOverlay"]>>> { return this.user().devModelOverlay(...args) }
  async recordProviderProblem(...args: Parameters<User["recordProviderProblem"]>): Promise<Awaited<ReturnType<User["recordProviderProblem"]>>> { return this.user().recordProviderProblem(...args) }
  async providerRecovered(...args: Parameters<User["providerRecovered"]>): Promise<Awaited<ReturnType<User["providerRecovered"]>>> { return this.user().providerRecovered(...args) }
  async checkProvider(...args: Parameters<User["checkProvider"]>): Promise<Awaited<ReturnType<User["checkProvider"]>>> { return this.user().checkProvider(...args) }
  async devProviderHealth(...args: Parameters<User["devProviderHealth"]>): Promise<Awaited<ReturnType<User["devProviderHealth"]>>> { return this.user().devProviderHealth(...args) }
  async listProviders(...args: Parameters<User["listProviders"]>): Promise<Awaited<ReturnType<User["listProviders"]>>> { return this.user().listProviders(...args) }
  async agentModel(...args: Parameters<User["agentModel"]>): Promise<Awaited<ReturnType<User["agentModel"]>>> { return this.user().agentModel(...args) }
  async setAgentModels(...args: Parameters<User["setAgentModels"]>): Promise<Awaited<ReturnType<User["setAgentModels"]>>> { return this.user().setAgentModels(...args) }
  async agentTurn(...args: Parameters<User["agentTurn"]>): Promise<Awaited<ReturnType<User["agentTurn"]>>> { return this.user().agentTurn(...args) }
  async turnContext(...args: Parameters<User["turnContext"]>): Promise<Awaited<ReturnType<User["turnContext"]>>> { return this.user().turnContext(...args) }
  async lifeRevision(...args: Parameters<User["lifeRevision"]>): Promise<Awaited<ReturnType<User["lifeRevision"]>>> { return this.user().lifeRevision(...args) }
  async lifeRevisions(...args: Parameters<User["lifeRevisions"]>): Promise<Awaited<ReturnType<User["lifeRevisions"]>>> { return this.user().lifeRevisions(...args) }
  async lifeState(...args: Parameters<User["lifeState"]>): Promise<Awaited<ReturnType<User["lifeState"]>>> { return this.user().lifeState(...args) }
  async lifeView(...args: Parameters<User["lifeView"]>): Promise<Awaited<ReturnType<User["lifeView"]>>> { return this.user().lifeView(...args) }
  async composioTools(...args: Parameters<User["composioTools"]>): Promise<Awaited<ReturnType<User["composioTools"]>>> { return this.user().composioTools(...args) }
  async composioSignature(...args: Parameters<User["composioSignature"]>): Promise<Awaited<ReturnType<User["composioSignature"]>>> { return this.user().composioSignature(...args) }
  async composioCall(...args: Parameters<User["composioCall"]>): Promise<Awaited<ReturnType<User["composioCall"]>>> { return this.user().composioCall(...args) }
  async composioToolkit(...args: Parameters<User["composioToolkit"]>): Promise<Awaited<ReturnType<User["composioToolkit"]>>> { return this.user().composioToolkit(...args) }
  async notifyError(...args: Parameters<User["notifyError"]>): Promise<Awaited<ReturnType<User["notifyError"]>>> { return this.user().notifyError(...args) }
  async browserLease(...args: Parameters<User["browserLease"]>): Promise<Awaited<ReturnType<User["browserLease"]>>> { return this.user().browserLease(...args) }
  async browserTouch(...args: Parameters<User["browserTouch"]>): Promise<Awaited<ReturnType<User["browserTouch"]>>> { return this.user().browserTouch(...args) }
  async browserTakeover(...args: Parameters<User["browserTakeover"]>): Promise<Awaited<ReturnType<User["browserTakeover"]>>> { return this.user().browserTakeover(...args) }
  async browserLive(...args: Parameters<User["browserLive"]>): Promise<Awaited<ReturnType<User["browserLive"]>>> { return this.user().browserLive(...args) }
  async browserHandBack(...args: Parameters<User["browserHandBack"]>): Promise<Awaited<ReturnType<User["browserHandBack"]>>> { return this.user().browserHandBack(...args) }
  async browserDead(...args: Parameters<User["browserDead"]>): Promise<Awaited<ReturnType<User["browserDead"]>>> { return this.user().browserDead(...args) }
  async browserCheck(...args: Parameters<User["browserCheck"]>): Promise<Awaited<ReturnType<User["browserCheck"]>>> { return this.user().browserCheck(...args) }
  async devBrowser(...args: Parameters<User["devBrowser"]>): Promise<Awaited<ReturnType<User["devBrowser"]>>> { return this.user().devBrowser(...args) }
  async devUpdateConfig(...args: Parameters<User["devUpdateConfig"]>): Promise<Awaited<ReturnType<User["devUpdateConfig"]>>> { return this.user().devUpdateConfig(...args) }
  async devPass(...args: Parameters<User["devPass"]>): Promise<Awaited<ReturnType<User["devPass"]>>> { return this.user().devPass(...args) }
  async ensureHome(...args: Parameters<User["ensureHome"]>): Promise<Awaited<ReturnType<User["ensureHome"]>>> { return this.user().ensureHome(...args) }
  async setAgentModel(...args: Parameters<User["setAgentModel"]>): Promise<Awaited<ReturnType<User["setAgentModel"]>>> { return this.user().setAgentModel(...args) }
  async userSettings(...args: Parameters<User["userSettings"]>): Promise<Awaited<ReturnType<User["userSettings"]>>> { return this.user().userSettings(...args) }
  async setUserSettings(...args: Parameters<User["setUserSettings"]>): Promise<Awaited<ReturnType<User["setUserSettings"]>>> { return this.user().setUserSettings(...args) }
}

// PR4 replaces the body with the consolidated owner schema initializer.
export function initializeSchema(storage: DurableObjectStorage): void {
  storage.sql.exec("CREATE TABLE IF NOT EXISTS owner_deadlines (scope TEXT PRIMARY KEY, at INTEGER NOT NULL)")
}

// PR3 and PR6 replace these hooks without moving the dispatch sites.
async function afterRun(_storage: DurableObjectStorage, _roomId: string, _slug: string): Promise<void> {}
async function archive(_storage: DurableObjectStorage, _roomId: string): Promise<void> {}
