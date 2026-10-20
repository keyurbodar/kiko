import type { Provider } from "@earendil-works/pi-ai"
import { isAgentSlug } from "@kiko/protocol"
import { KIKO, newRoomId, pairRoomId, sameAgentChat, type ThinkingLevel } from "@kiko/protocol"
import { HomeWiring } from "./home-wiring"
import { RoutineWiring } from "./routines-wiring"
import type { Actor, Agent, AgentModel, AgentSlug, Chat, ChatOp, FileOp, ClientToUser as UserFrame, ComposioResult, InstallRecipe, KikoError, ProviderInfo, RecipeList, RoomId, RunErrorKind, UserChange, UserEvent, UserToClient } from "@kiko/protocol"
import { RecipeLibrary } from "./recipe-library"
import { matchRecipes, type RecipeHint } from "../recipes/match"
import { capitalized, soulFromDescription } from "../room/chief"
import { makeAgentChat } from "../room/new-agent"
import { RecipeService } from "./recipe-service"
import { recipeCard } from "../recipes/card"
import { ClientToUser, INITIATIVE_LEVELS, type UserSettings, type UserSettingsPatch } from "@kiko/protocol/schema"
import type { OwnerServices, ServiceOptions } from "../owner/services"
import { loadUserDev } from "../lib/dev-guard"
import { signToken } from "../auth/auth"
import { BACKEND } from "../lib/version"
import { Schema } from "effect"
import type { Env } from "../index"
import { ComposioConnection, composioErrorText } from "../integrations/composio/connect"
import { STORAGE_ERROR } from "../lib/storage-error"
import { composioFailure } from "./user-errors"
import { connectLinkFor, MANAGE_CONNECTIONS } from "../integrations/composio/connect-tool"
import { ComposioStore } from "../integrations/composio/store"
import type { ComposioCallResult, ComposioTool } from "../integrations/composio/client"
import type { Lease } from "../agent/browser/lease"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import { runDue } from "../owner/clock"
import { waitForHello } from "../owner/socket"
import { enforceHello, HELLO_WAKEUP, helloBy } from "@kiko/durable/hello-deadline"
import { kikoChatOps, kikoChatRoom, markKikoChat, movesKikoChat } from "./kiko-chat"
import { keyringFromEnv } from "@kiko/durable/crypto"
import { checkApiKey, CredentialVault } from "./credentials"
import { keyRefused } from "./credentials-check"
import { problemOfRun } from "./provider-health"
import { ProviderCheck } from "./provider-check"
import { userModels } from "../agent/factory"
import { agentNamed, createAgent, listAgents } from "./agents"
import { agentModel, allAgentModels, saveAgentModel } from "./agent-models"
import { firstSoul, type Soul, Souls, type SoulWrite } from "./souls"
import { type CommitResult, type FileBody, FileIndex, type IndexChange, type FsChange, type FsEntry, type FsFail, HOME_TABLES, type NewFile, type PutResult } from "../files/file-index"
import { actorKey } from "../room/log"
import { RoomDirectory, type ChatChange } from "../room/directory"
import { Life } from "@kiko/memory/life"
import { itemLine, spanOf } from "@kiko/memory/optmem"
import type { NoteAnswer } from "@kiko/memory/tools"
import { ProviderLogins, signInMethod } from "./provider-login"
import { ModelCatalog } from "../models/service"
import { restoreOverlay } from "../models/sync"
import { type CatalogOverlay, findProvider } from "../models/catalog"
import { type NewRoutine, Reminders, type RoutineRun, type RunDelivery } from "./reminders"
import { deleteSetting, getSetting, setSetting } from "../lib/settings"
import { roomOverview } from "../room/overview"
import { routineRun, type SignalBatch } from "../room/routine-events"
import { createAgentRoutine, roomRoutine, type RoutineResult } from "./routines"
import { DEFAULT_TIMEZONE, resolveTurnContext, type TurnContext } from "./turn-context"
import { getTheme, setTheme } from "./theme"
import { composioUserId, } from "../lib/names"
import { INITIATIVE_RUN, InitiativeEngine, type Level } from "../initiative/engine"
import { REAP_WAKEUP } from "../integrations/kernel/lease"
import type { DevBrowserOp } from "./dev"
import { type BrowserCheck, KernelWiring, type LiveLinkResult } from "./kernel-wiring"
import { MemoryCapture } from "./memory-capture"
import { type Attachment, send, trySend } from "./socket-frames"
import { AWAY_MS, LAST_SEEN } from "./keys"
import { UpdateWiring } from "./update-wiring"

const REPLAY_LIMIT = 500

const decodeFrame = Schema.decodeUnknownSync(ClientToUser)

const AWAY_NOTICE = "away_notice"
const PUBLIC_ORIGIN = "public_origin"
const DEVICE_ID = "device_id"
const OLD_CHECK_IN = "check_in"
const OLD_CHECK_IN_SEEN = "check_in_seen"

const LAST_CHAT = "last_chat"


type NewAgentOutcome = { ok: true; agent: Agent; roomId: RoomId } | { ok: false; error: string }

export class User {
  private readonly sql: SqlStorage
  private alarms!: Alarms
  private models!: ModelCatalog
  private life!: Life
  private souls!: Souls
  private home!: FileIndex<UserEvent>
  private holding: UserEvent[] | null = null
  private lastSeen = 0
  private readonly directory:RoomDirectory

  private readonly ctx:DurableObjectState
 private readonly env:Env
 private readonly services:OwnerServices
 private readonly ownerId:string
 private readonly publishFrame:(frame:unknown)=>void
 private readonly egress: typeof fetch = async (input, init) => {
   const request = new Request(input, init)
   return this.services.egress({ url: request.url, method: request.method, headers: [...request.headers], body: request.body ? await request.arrayBuffer() : null })
 }
 constructor(options:ServiceOptions) {
  const {ctx,env,services,sql,broadcast}=options
  this.ctx=ctx
  this.ownerId=options.identity.ownerId
  this.env=env
  this.services=services
  this.sql=sql
  this.publishFrame=broadcast


    this.directory=new RoomDirectory(this.sql,this.services)
    {
      this.alarms = options.clock
      restoreOverlay(this.sql)
      this.models = new ModelCatalog({ sql: this.sql, now: Date.now, fetch: (url, init) => this.services.egress({ url, method: init.method ?? "GET", headers: [...new Headers(init.headers)], body: null }), signInMethod, changed: () => this.changed("models") })


      this.life = new Life(this.sql, (fn) => ctx.storage.transactionSync(fn), { get: (key) => this.setting(key), set: (key, value) => this.putSetting(key, value) })
      this.souls = new Souls(this.sql)
      this.home = new FileIndex<UserEvent>(ctx.storage, HOME_TABLES, (_, body) => {
        const event = this.commit(body)
        if (!event) throw new Error("file change produced no event")
        return event
      }, actorKey)
      this.reminders = new Reminders(this.sql, { sync: (routines) => this.services.syncRoutines(routines) }, Date.now, {
        deliverRun: async ({ deliveryId, routine, body }) => {
          return this.services.room(routine.roomId).deliverRoutine(deliveryId, { target: routine.target, body })
        },
        notice: (roomId, id, text) => this.services.room(roomId).systemNotice(id, text, "routine"),
        gate: {
          away: () => {
            const last = Math.max(this.lastSeen, Number(this.setting(LAST_SEEN) ?? 0))
            const connected = this.ctx.getWebSockets().some((ws) => (ws.deserializeAttachment() as Attachment | null)?.ready)
            const away = !connected && last > 0 && Date.now() - last > AWAY_MS
            if (away) this.ctx.waitUntil(this.awayNotice(Date.now()).catch(() => {}))
            return away
          },
        },
      }, () => this.changed("routines"))
    }
  }

  private reminders!: Reminders
  async listRoutines() { return this.reminders.list() }
  async deleteRoutine(id: string): Promise<{ ok: true }> {
    this.#recipes.routineGone(id)
    return this.#routines.deleteRoutine(id)
  }
  async cancelRoutine(id: string): Promise<RoutineResult> {
    const out = await this.#routines.cancelRoutine(id)
    if (out.ok || this.reminders.get(id)?.status === "cancelled") this.#recipes.routineGone(id)
    return out
  }
  async createRoutine(owner: string, input: NewRoutine): Promise<RoutineResult> {
    return createAgentRoutine(input, {
      chat: (roomId) => this.getChat(roomId),
      agents: () => this.listAgents(),
      openChat: (title, agents) => this.openChat(title, agents),
      create: (routed) => this.#routines.createRoutine(owner, routed),
    })
  }
  async updateRoutine(id: string, patch: Parameters<Reminders["updateRoutine"]>[1]): Promise<RoutineResult> { return this.#routines.updateRoutine(id, patch) }

  async recipeList(): Promise<RecipeList> {
    const { cards, custom, installs, broken } = await this.#recipes.list()
    const connected = await this.#composio.connectedToolkits().catch(() => null)
    return { cards: cards.map((r) => recipeCard(r, custom.has(r.slug), connected)), installs, broken }
  }

  /** The catalog recipes that may fit a new agent's description. */
  async recipeHints(description: string): Promise<RecipeHint[]> {
    return matchRecipes(description, (await this.#recipes.list()).cards)
  }

  /** Makes an agent from the new agent form: the agent, its own chat, and its greeting. The chat id is the client's, so it is already open there. */
  async createAgentChat(input: { id: string; roomId: RoomId; name: string; handle: string; description: string }): Promise<NewAgentOutcome> {
    const owner = this.ownerId
    const out = await makeAgentChat(
      {
        agents: async () => listAgents(this.sql),
        make: (spec) => this.makeAgent({ id: spec.id, name: spec.name, slug: spec.handle, description: spec.description, soul: spec.soul, model: "" }),
        openChat: (title, agentIds, roomId) => this.openChat(title, agentIds, roomId),
        recipes: (description) => this.recipeHints(description),
        introduce: (roomId, agent, text) => this.services.room(roomId).introduce(owner, agent.slug, text),
      },
      { name: input.name, handle: input.handle, description: input.description, soul: soulFromDescription(capitalized(input.name.trim()), input.description) },
      "human",
      { id: input.id, roomId: input.roomId },
    )
    if (!out.ok) return out
    this.ctx.waitUntil(out.introduced)
    return { ok: true, agent: out.agent, roomId: out.roomId }
  }

  async editRecipe(slug: string): Promise<string | null> {
    return this.#recipes.edit(slug)
  }

  async installRecipe(owner: string, input: InstallRecipe, by?: string) {
    return this.#recipes.install(input, by)
  }

  async uninstallRecipe(installId: string): Promise<boolean> {
    return this.#recipes.uninstall(installId)
  }

  async recipeBriefs(roomId: string, agent: string) {
    return this.#recipes.briefs(roomId, agent)
  }

  async recipeSkillText(slug: string): Promise<string | null> {
    return this.#recipes.skillText(slug)
  }

  #recipeService?: RecipeService
  get #recipes(): RecipeService {
    if (this.#recipeService) return this.#recipeService
    const owner = () => this.ownerId
    const library = new RecipeLibrary({
      sql: this.sql,
      files: this.services.files(),
      userId: owner,
      list: (dir, recursive) => this.#homeWiring.list(dir, recursive),
      put: (input) => this.#homeWiring.put(input),
      remove: (paths, recursive) => this.#homeWiring.remove({ kind: "human" }, paths, recursive),
    })
    this.#recipeService = new RecipeService({
      sql: this.sql,
      library,
      createRoutine: (input) => this.#routines.createRoutine(owner(), input),
      cancelRoutine: (id) => this.cancelRoutine(id),
      routine: (id) => this.reminders.get(id),
      timezone: () => this.timezone(),
      agentNamed: (name) => agentNamed(this.sql, name),
      makeAgent: async (name, handle, description, model) => {
        for (const slug of [handle, ...[2, 3, 4, 5].map((n) => `${handle}-${n}`)]) {
          const agent = await this.makeAgent({ name, slug, description, soul: firstSoul(name, description), model })
          if (agent) return agent
        }
        return null
      },
      openChat: async (title, agentIds) => (await this.openChat(title, agentIds)).roomId,
      chiefModel: async () => {
        const roomId = kikoChatRoom(this.sql)
        return roomId ? this.services.room(roomId).modelOf("kiko").catch(() => "") : ""
      },
      composio: {
        connected: async () => (this.#composio.status().connected ? await this.#composio.connectedToolkits(Date.now(), true).catch(() => null) : "off"),
        link: async (app) => {
          const manage = (await this.#composio.tools().catch(() => null))?.find((t) => t.name === MANAGE_CONNECTIONS)
          const out = manage && (await connectLinkFor(manage, (name, args) => this.#composio.call(name, args), app, (named) => this.#composio.resolveToolkit(named)))
          return out && out.kind === "link" ? out.link : null
        },
      },
      announce: (roomId, input) => this.services.room(roomId).addRecipe(owner(), { ...input, agent: input.agent as AgentSlug }),
    })
    return this.#recipeService
  }

  async overview(): Promise<string> {
    const tz = this.setting("timezone") ?? DEFAULT_TIMEZONE
    return roomOverview(this.directory,this.services, { reminders: this.reminders.list(), runs: this.reminders.runs(), tz, now: Date.now() })
  }


  private devCache?:Promise<typeof import("./dev")>
  private dev():Promise<typeof import("./dev")>{this.devCache??=loadUserDev();return this.devCache}

  async devSeen(ago: number): Promise<void> {
    return (await this.dev()).devSeen(this.sql, ago)
  }

  async devSetting(key: "memory_policy", value: string): Promise<void> {
    return (await this.dev()).devSetting(this.sql, key, value)
  }

  async devComposioSession(): Promise<string | null> {
    return (await this.dev()).devComposioSession(() => this.#composio)
  }

  async devCaptureQueue(): Promise<number> {
    return (await this.dev()).devCaptureQueue(this.sql)
  }

  async devDue(id: string): Promise<void> {
    return (await this.dev()).devDue(this.reminders, id)
  }

  async timezone(): Promise<string | null> {
    return this.setting("timezone")
  }

  async publicOrigin(): Promise<string | null> {
    return this.setting(PUBLIC_ORIGIN)
  }

  async runRoutine(id: string): Promise<RunDelivery | null> {
    return this.reminders.runNow(id)
  }

  async routineRuns(id?: string): Promise<RoutineRun[]> {
    return this.reminders.runs(id)
  }

  async signals(batch: SignalBatch): Promise<void> {
    for (const s of batch.signals) if (s.kind === "routine_result" && s.routineId !== INITIATIVE_RUN) await this.reminders.finishRun(s.routineId, s.occurrence, s.outcome, s.seq)
    if (!batch.signals.some((s) => s.kind === "burst" || s.kind === "agent_final")) return
    for (const routine of this.reminders.roomRoutines(batch.roomId)) {
      const run = routineRun(roomRoutine(routine), batch)
      if (run) await this.reminders.fireEvent(routine.id, `event:${batch.openedAt}`, "events in this chat", run.body)
    }
  }

  async routineHook(token: string, deliveryKey: string, body: string): Promise<"ran" | "held" | "skipped" | "unknown"> {
    return this.#routines.routineHook(token, deliveryKey, body)
  }


  async createChat(roomId: RoomId, title: string, agents?: readonly string[]): Promise<Chat> {
    const op: ChatOp = { op: "create", roomId, title, ...(agents?.length ? { agents } : {}) }
    this.apply(op)
    const chat = this.directory.get( this.existingFor(op) ?? roomId)
    if (!chat) throw new Error(`chat ${roomId} is missing right after create`)
    return chat
  }

  async renameChat(roomId: RoomId, title: string): Promise<Chat | null> {
    this.apply({ op: "rename", roomId, title })
    return this.directory.get( roomId)
  }

  async pinChat(roomId: RoomId, pinned: boolean): Promise<Chat | null> {
    this.apply({ op: "pin", roomId, pinned })
    return this.directory.get( roomId)
  }

  async deleteChat(roomId: RoomId): Promise<boolean> {
    const changed = this.apply({ op: "delete", roomId }) !== null
    return changed
  }

  private async cleanDeletedChats(): Promise<void> {
    for (const { room_id } of this.sql.exec<{ room_id: RoomId }>("SELECT room_id FROM deletion_rooms").toArray()) {
      await this.reminders.cancelRoom(room_id)
      await this.#recipes.chatGone(room_id)
      await this.services.room(room_id).erase()
      this.sql.exec("DELETE FROM deletion_rooms WHERE room_id = ?", room_id)
    }
    await this.alarms.clearWakeup("deletion")
  }

  async deleteAgent(handle: string) {
    const slug = handle.trim().toLowerCase().replace(/^@/, "")
    if (!isAgentSlug(slug) || slug === KIKO) return { ok: false as const, error: "kiko cannot be deleted; use a valid agent handle" }
    this.sql.exec("INSERT OR IGNORE INTO deleted_agent_handles (slug) VALUES (?)", slug)
    this.sql.exec("INSERT OR IGNORE INTO deletion_agents (slug) VALUES (?)", slug)
    await this.alarms.setWakeup("deletion_agents", Date.now() + 30_000)
    const result = await this.deleteAgentNow(slug)
    if (result.ok) this.sql.exec("DELETE FROM deletion_agents WHERE slug = ?", slug)
    return result
  }

  private async cleanDeletedAgents(): Promise<void> {
    for (const { slug } of this.sql.exec<{ slug: AgentSlug }>("SELECT slug FROM deletion_agents").toArray()) {
      const result = await this.deleteAgentNow(slug)
      if (!result.ok) throw new Error(result.error)
      this.sql.exec("DELETE FROM deletion_agents WHERE slug = ?", slug)
    }
    await this.alarms.clearWakeup("deletion_agents")
  }

  private async deleteAgentNow(slug: AgentSlug) {
    const agent = listAgents(this.sql).find((a) => a.slug === slug)
    if (!agent) return { ok: true as const, text: "agent already deleted" }
    const owner = this.ownerId
    for (const row of this.directory.list(true).filter(c=>c.agents?.includes(agent.id)).map(c=>({room_id:c.roomId}))) {
      const chat = this.directory.get( row.room_id)
      if (!chat) continue
      if (chat.pair || (chat.agents?.length ?? 0) <= 1) await this.deleteChat(chat.roomId)
      else {
        const room = this.services.room(chat.roomId)
        const reason = await room.memberOp({ op: "remove", slug })
        if (reason && reason !== "unknown") return { ok: false as const, error: reason }
        await this.services.agent(chat.roomId, slug).erase()
        await this.chatMembers(chat.roomId, (await room.memberSlugs()).filter((s) => s !== slug))
      }
    }
    for (const { room_id } of this.sql.exec<{ room_id: RoomId }>("SELECT room_id FROM room_directory").toArray()) await this.services.room(room_id).eraseFormerAgent(slug)
    await this.#recipes.agentGone(slug)
    await this.reminders.cancelAgent(slug)
    for (const { pos } of this.sql.exec<{ pos: number }>("SELECT pos FROM life WHERE source = ? AND redacted = 0", `@${slug}`).toArray()) this.life.redact(pos)
    this.changed("memory")
    this.sql.exec("DELETE FROM souls WHERE slug = ?", slug)
    deleteSetting(this.sql, `agentModel:${slug}`)
    this.sql.exec("DELETE FROM agents WHERE id = ?", agent.id)
    this.commit({ t: "agent_removed", id: agent.id, slug })
    return { ok: true as const, text: `@${slug} deleted` }
  }

  roomChanged(roomId:RoomId):void {
    const chat=this.directory.get(roomId)
    if(chat&&!chat.pair)this.broadcast({t:"events",events:[{t:"chat",chat:markKikoChat(this.sql,chat),seq:this.currentSeq(),at:Date.now()}]})
  }


  /** Who is typing in each chat, for a socket that connects mid-run. Memory only: a clear always arrives as a frame. */
  readonly #typing = new Map<RoomId, readonly string[]>()

  async chatTyping(roomId: RoomId, names: readonly string[]): Promise<void> {
    if (!this.directory.get( roomId)) return
    if (names.length) this.#typing.set(roomId, names)
    else this.#typing.delete(roomId)
    this.broadcast({ t: "typing", roomId, names })
  }

  private changed(what: UserChange): void {
    if (what === "memory") this.putSetting("memory:revision", String(this.lifeRevision() + 1))
    this.broadcast({ t: "changed", what })
  }

  async searchChats(query: string): Promise<Chat[]> {
    return this.directory.search( query)
  }

  async listChats(): Promise<Chat[]> {
    return this.directory.list()
  }

  /** The room calls this when its members change. Slugs become agent ids; Kiko's id is its slug. */
  async chatMembers(roomId: RoomId, slugs: readonly string[]): Promise<void> {
    const ids = new Map(listAgents(this.sql).map((a) => [a.slug as string, a.id]))
    this.commit(this.directory.agents( roomId, slugs.flatMap((s) => (s === KIKO ? [KIKO] : ids.has(s) ? [ids.get(s)!] : []))))
  }

  async getChat(roomId: RoomId): Promise<Chat | null> {
    const chat = this.directory.get( roomId)
    return chat && markKikoChat(this.sql, chat)
  }

  async createAgent(agent: Agent): Promise<Agent | null> {
    return this.saveAgent(agent)
  }

  async listAgents(): Promise<Agent[]> {
    return listAgents(this.sql)
  }

  async soul(slug: string): Promise<Soul> {
    return this.souls.get(slug)
  }

  async setSoul(slug: string, body: string, expectSha: string): Promise<SoulWrite> {
    return this.souls.set(slug, body, expectSha)
  }

  async homePut(input: NewFile): Promise<Omit<PutResult, "events"> & { fresh: boolean; entry: FsEntry | null }> {
    return this.#homeWiring.put(input)
  }

  async homeStat(path: string): Promise<FsEntry | null> {
    return this.#homeWiring.stat(path)
  }

  async homeList(dir: string, recursive = false): Promise<FsEntry[] | FsFail> {
    return this.#homeWiring.list(dir, recursive)
  }

  async homeMove(by: Actor, from: string, to: string): Promise<FsChange | FsFail> {
    return this.#homeWiring.move(by, from, to)
  }

  async homeRemove(by: Actor, paths: readonly string[], recursive: boolean): Promise<FsChange | FsFail> {
    return this.#homeWiring.remove(by, paths, recursive)
  }

  async homeMkdir(by: Actor, path: string): Promise<FsChange | FsFail> {
    return this.#homeWiring.mkdir(by, path)
  }

  async homeCommit(by: Actor, changes: readonly IndexChange[]): Promise<CommitResult> {
    return this.#homeWiring.commit(by, changes)
  }

  private homeOp(op: FileOp): string | null {
    return this.#homeWiring.op(op)
  }

  async makeAgent(input: { id?: string; name: string; slug: string; description: string; soul: string; model: string }): Promise<Agent | null> {
    if (this.sql.exec("SELECT 1 FROM deleted_agent_handles WHERE slug = ?", input.slug.trim().toLowerCase().replace(/^@/, "")).toArray().length) throw new Error("This agent handle was deleted and cannot be reused. Choose a new handle.")
    const agent = this.saveAgent({ id: input.id ?? crypto.randomUUID(), name: input.name, slug: input.slug as AgentSlug, prompt: input.description, model: input.model })
    if (!agent) return null
    await this.souls.seed(agent.slug, input.soul)
    return agent
  }

  /** The chat with exactly these agents: the existing one, or a new one (`created`). */
  async openChat(title: string, agents: readonly string[], roomId: RoomId = newRoomId()): Promise<{ roomId: RoomId; created: boolean }> {
    const op: ChatOp = { op: "create", roomId, title, agents }
    const existing = this.existingFor(op)
    if (existing) return { roomId: existing, created: false }
    this.apply(op)
    return { roomId: op.roomId, created: true }
  }

  /** The hidden chat where two of the human's agents talk. It is made once, from the two slugs, and no client hears of it. */
  async openPair(a: string, b: string): Promise<{ ok: true; roomId: RoomId } | { ok: false; error: string }> {
    const mine = listAgents(this.sql)
    const idOf = (slug: string) => (slug === KIKO ? KIKO : mine.find((x) => x.slug === slug)?.id)
    const ids = [idOf(a), idOf(b)]
    if (ids[0] === undefined || ids[1] === undefined) {
      const known = [KIKO, ...mine.map((x) => x.slug)].filter((s) => s !== a)
      return { ok: false, error: `not sent: no agent @${ids[1] === undefined ? b : a}. the human has: ${known.map((s) => `@${s}`).join(", ")}.` }
    }
    const roomId = pairRoomId(a, b)
    if (!this.directory.get( roomId)) this.commit(this.directory.apply( { op: "create", roomId, title: [a, b].sort().map((s) => `@${s}`).join(" and "), agents: ids as string[] }, Date.now(), true))
    return { ok: true, roomId }
  }

  async seedSoul(slug: string, name: string, role: string): Promise<Soul> {
    return this.souls.seed(slug, firstSoul(name, role))
  }

  async getTheme(): Promise<string | null> {
    return getTheme(this.sql)
  }

  async setTheme(theme: string | null): Promise<boolean> {
    return this.saveTheme(theme)
  }

  private setting(key: string): string | null {
    return getSetting(this.sql, key)
  }

  private putSetting(key: string, value: string): void {
    setSetting(this.sql, key, value)
  }

  async lifeNote(author: string, text: string, ref = "", replaces?: string): Promise<NoteAnswer> {
    const out = this.life.append(text, `@${author}`, Date.now(), { ref })
    if (!out.ok) return out
    const old = replaces === undefined ? null : /^(?:life:)?\s*#?(\d+)$/i.exec(replaces.trim())
    const replaced = old ? this.life.supersede(Number(old[1]), out.pos) : false
    if (!out.duplicate || replaced) {
      this.changed("memory")
    }
    return { ok: true, pos: out.pos, ...(out.duplicate ? { duplicate: true as const } : {}), ...(replaces === undefined ? {} : { replaced }) }
  }

  async lifeRecall(query: string): Promise<string[]> {
    return this.life
      .recall(query, 10, { skipCard: true })
      .map((l) => itemLine({ pos: l.pos, at: l.at, text: `${l.source ? `${l.source}: ` : ""}${l.text}` }, 400, true, "life"))
  }

  /** Writes down what the capture queue holds. Called after a human run. */
  async captureNow(): Promise<void> {
    await this.#mem.captureNow()
    await this.#mem.napLife()
  }

  /** The initiative pass. Called after a human run, and by the dev route. */
  async initiativePass(): Promise<void> {
    await this.#initiative.pass()
  }

  private routineSync: Promise<void> = Promise.resolve()

  /** Points each agent's durable routine tasks at the current inventory of its exact-time routines. */
  syncRoutines(routines: readonly import("../owner/schedules").ScheduledRoutine[]): Promise<void> {
    const work = this.routineSync.then(() => this.applyRoutineInventory(routines))
    this.routineSync = work.catch(() => {})
    return work
  }

  private async applyRoutineInventory(routines: readonly import("../owner/schedules").ScheduledRoutine[]): Promise<void> {
    const byAgent = new Map<string, import("../owner/schedules").ScheduledRoutine[]>()
    for (const routine of routines) {
      const key = `${routine.roomId}:${routine.target}`
      const list = byAgent.get(key)
      if (list) list.push(routine)
      else byAgent.set(key, [routine])
    }
    const previous = JSON.parse(this.setting("routine_agents") ?? "[]") as string[]
    for (const key of previous) if (!byAgent.has(key)) {
      const [roomId, target] = key.split(":")
      if (roomId && target) await this.services.agent(roomId, target).syncRoutines([])
    }
    for (const list of byAgent.values()) {
      const { roomId, target } = list[0]!
      await this.services.agent(roomId, target).syncRoutines(list)
    }
    this.putSetting("routine_agents", JSON.stringify([...byAgent.keys()]))
  }

  /** A routine task delivered its occurrence, so record the run and schedule the next one. */
  async fireRoutine(delivery: import("../owner/schedules").RoutineDelivery): Promise<void> {
    await this.reminders.fireScheduled(delivery)
    this.changed("routines")
  }

  async captureHuman(roomId: RoomId, items: { messageId: string; text: string; at: number }[]): Promise<void> {
    await this.#mem.captureHuman(roomId, items)
  }

  async forgetMessages(roomId: RoomId, messageIds: string[], requeue: { messageId: string; text: string; at: number }[], turns: number[]): Promise<void> {
    const ids = [...new Set([...messageIds, ...requeue.map((r) => r.messageId)])]
    const gone = this.life.redactRefs(ids.map((id) => `room:${roomId}:msg:${id}`))
    this.sql.exec("DELETE FROM capture_queue WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))", roomId, JSON.stringify(ids))
    const prefix = `room:${roomId}:turns:`
    const spans = this.life.refsLike(prefix).filter((ref) => {
      const m = /^(\d+)-(\d+)$/.exec(ref.slice(prefix.length))
      return m !== null && turns.some((pos) => Number(m[1]) <= pos && pos < Number(m[2]))
    })
    if (gone.length + this.life.redactRefs(spans).length) {
      this.changed("memory")
    }
    if (turns.length) await this.captureHuman(roomId, requeue)
  }

  async lifeZoom(id: string): Promise<string | null> {
    const one = /^(\d+)$/.exec(id)
    const span = one ? { lo: Number(one[1]), hi: Number(one[1]) + 1 } : spanOf(id)
    if (!span) return null
    const lines = this.life.zoom(span, Date.now())
    return lines.length ? lines.join("\n") : null
  }

  async memoryUsage(): Promise<Record<string, number>> {
    return this.#mem.usage()
  }

  async compress(prompt: string): Promise<{ text: string } | { retryAt: number } | { error: string }> {
    return this.#mem.compress(prompt)
  }

  async providerKeyRefused(provider: string, apiKey: string): Promise<string | null> {
    const key = checkApiKey(apiKey)
    const { models, settings } = userModels(async () => ({ auth: { apiKey: key } }), `check-${this.ctx.id.toString()}`, this.egress, () => this.services.countOutgoing())
    return keyRefused(models, provider, settings.stream?.headers)
  }

  async connectProvider(provider: string, apiKey: string): Promise<ProviderInfo> {
    const info = await this.#credentials.connect(provider, apiKey)
    return this.#mem.describe(info)
  }

  async disconnectProvider(provider: string): Promise<boolean> {
    const removed = await this.#credentials.disconnect(provider)
    return removed
  }

  /** The model catalog json for the client, or null json when it already holds `have`. */
  async modelCatalog(have: string | null): Promise<{ revision: string; json: string | null }> {
    return this.models.catalog(have)
  }

  async devModelOverlay(overlay: CatalogOverlay): Promise<void> {
    await (await this.dev()).devModelOverlay(this.sql, overlay)
    this.changed("models")
  }

  /** A run or a probe heard the provider refuse the key, say the credit is gone, or refuse the sign-in. Broadcasts only a change. */
  async recordProviderProblem(provider: string, kind: RunErrorKind): Promise<void> {
    const problem = problemOfRun(kind)
    if (problem) this.#credentials.setProblem(provider, problem)
  }

  /** A run that began with a problem ended without a model error, so the provider works. */
  async providerRecovered(provider: string): Promise<void> {
    this.#credentials.setProblem(provider, null)
  }

  /** "Check again": refreshes an OAuth sign-in, sends the cheapest request, and sets or clears the problem. */
  async checkProvider(provider: string): Promise<ProviderInfo | null> {
    const info = await this.#watch.check(provider)
    return info ? this.#mem.describe(info) : null
  }

  async devProviderHealth(op: { refresh?: "fail" | "offline" | "ok"; wake?: boolean }): Promise<void> {
    const dev = await this.dev()
    if (op.refresh) dev.setFakeRefresh(op.refresh)
    if (op.wake) await this.#watch.refreshAll()
  }

  async listProviders(): Promise<ProviderInfo[]> {
    return this.#credentials.listProviders().map((p) => this.#mem.describe(p))
  }

  private seen(): void {
    this.lastSeen = Date.now()
  }

  private async awayNotice(now: number): Promise<void> {
    const notice = this.setting(AWAY_NOTICE)
    if (notice !== null && Number(notice) >= this.lastSeen) return
    this.putSetting(AWAY_NOTICE, String(now))
    const roomId = kikoChatRoom(this.sql)
    const owner = this.ownerId
    if (roomId) await this.services.room(roomId).systemNotice(`away:${now}`, "i paused your routines and follow-ups while you were away. they start again when you open kiko.", "limit")
  }

  /** What an agent runs on, for every chat. */
  async agentModel(slug: string): Promise<AgentModel | null> {
    return agentModel(this.sql, slug)
  }

  /** The room frame's setter: one model for the named agent, or for each of the room's agents. */
  async setAgentModels(slugs: readonly AgentSlug[], ref: string, roomId: RoomId): Promise<void> {
    for (const slug of slugs) this.setAgentModel(slug, ref, undefined, roomId)
  }

  /** One round trip for a run: the agent's model and level, then the credentials for that model's provider. */
  async agentTurn(slug: string): Promise<TurnContext & { model: string | null; thinking: ThinkingLevel }> {
    const picked = agentModel(this.sql, slug)
    if (!picked) return { ...(await this.turnContext("", slug)), model: null, thinking: "off" }
    return { ...(await this.turnContext(picked.model.slice(0, picked.model.indexOf("/")), slug)), model: picked.model, thinking: picked.thinking }
  }

  async turnContext(provider: string, slug?: string): Promise<TurnContext> {
    const setting = (key: string) =>
      getSetting(this.sql, key)
    const agent = slug ? { soul: await this.souls.get(slug) } : undefined
    return resolveTurnContext(this.#credentials, provider, { timezone: setting("timezone"), captures: this.#mem.captures() }, agent, await this.lookupProvider(provider))
  }

  lifeRevision(): number {
    return Number(this.setting("memory:revision") ?? 0)
  }

  lifeRevisions(): { revision: number; forgotten: number } {
    return { revision: this.lifeRevision(), forgotten: this.life.forgetRevision() }
  }

  async lifeState(): Promise<{ revision: number; forgotten: number; text: string }> {
    return { ...this.lifeRevisions(), text: this.life.view(Date.now()) }
  }

  async lifeView(): Promise<string> {
    return this.life.view(Date.now())
  }

  #vault?: CredentialVault
  get #credentials(): CredentialVault {
    this.#vault ??= new CredentialVault(this.sql, keyringFromEnv(this.env), this.ownerId, () => this.changed("providers"))
    return this.#vault
  }

  /** A provider pi-ai knows, or in a development build the sign-in test provider. */
  private async lookupProvider(id: string): Promise<Provider | undefined> {
    const found = findProvider(id)
    if (found) return found
    try {
      return (await loadUserDev()).fakeProvider(id)
    } catch {
      return undefined
    }
  }

  #providerCheck?: ProviderCheck
  get #watch(): ProviderCheck {
    this.#providerCheck ??= new ProviderCheck({
      vault: () => this.#credentials,
      lookup: (id) => this.lookupProvider(id),
      label: this.ctx.id.toString(),
      fetch: this.egress,
      countOutgoing: () => this.services.countOutgoing(),
    })
    return this.#providerCheck
  }

  #homeWiringCache?: HomeWiring
  get #homeWiring(): HomeWiring {
    this.#homeWiringCache ??= new HomeWiring({ files:this.services.files(), ctx: this.ctx, env: this.env, home: this.home, holding: { set: (held) => { this.holding = held } }, broadcast: (frame) => this.broadcast(frame) })
    return this.#homeWiringCache
  }

  #routinesWiring?: RoutineWiring
  get #routines(): RoutineWiring {
    this.#routinesWiring ??= new RoutineWiring({ reminders: this.reminders, setRoutines: (roomId, routines) => this.services.room(roomId).setRoutines(routines), routineCreated: (roomId, slug, id, name, byAgent) => this.services.room(roomId).routineCreated(slug, id, name, byAgent) })
    return this.#routinesWiring
  }

  #memory?: MemoryCapture
  get #mem(): MemoryCapture {
    this.#memory ??= new MemoryCapture({
      chat:roomId=>this.directory.get(roomId),
      sql: this.sql,
      life: this.life,
      label: this.ctx.id.toString(),
      fetch: this.egress,
      countOutgoing: () => this.services.countOutgoing(),
      credentials: () => this.#credentials,
      turn: (provider) => this.turnContext(provider),
    })
    return this.#memory
  }

  #initiativeModule?: InitiativeEngine
  get #initiative(): InitiativeEngine {
    this.#initiativeModule ??= new InitiativeEngine({
      // One scan of the open boards, not a chat view per chat: the pass must not pay for every room's activity.
      boards: () => {
        const rows = this.sql
          .exec<{ room_id: string; id: string; title: string; status: string; owner: string | null; updated_at: number }>(
            "SELECT room_id, id, title, status, owner, updated_at FROM ws_tasks WHERE NOT status IN ('done', 'cancelled') AND NOT id IS NULL ORDER BY updated_at",
          )
          .toArray()
        const boards = new Map<string, { roomId: string; oldest: { id: string; title: string; status: string; owner?: string; updatedAt: number }[] }>()
        for (const row of rows) {
          const board = boards.get(row.room_id) ?? { roomId: row.room_id, oldest: [] }
          if (board.oldest.length < 3) board.oldest.push({ id: row.id, title: row.title, status: row.status, ...(row.owner ? { owner: row.owner } : {}), updatedAt: row.updated_at })
          boards.set(row.room_id, board)
        }
        return [...boards.values()]
      },
      sql: this.sql,
      tz: () => getSetting(this.sql, "timezone") ?? DEFAULT_TIMEZONE,
      level: () => this.initiativeLevel(),
      // A chat the human keeps private never reaches initiative.
      title: (roomId) => {
        const chat = this.directory.get( roomId)
        return chat && !chat.private ? chat.title : null
      },
      wake: (roomId, input) => this.services.room(roomId).initiativeWake(input),
      count: (delta) => this.#mem.count(delta),
    })
    return this.#initiativeModule
  }

  private initiativeLevel(): Level {
    const level = this.setting("initiative")
    return (INITIATIVE_LEVELS as readonly string[]).includes(level ?? "") ? (level as Level) : "digest"
  }

  /** Null when no key is stored. A cold object serves the saved listing and refreshes it behind. */
  async composioTools(): Promise<ComposioTool[] | null> {
    try {
      return await this.#composio.tools()
    } catch (e) {
      return this.fail(composioFailure(e), e)
    }
  }

  /** What an open agent compares with the tools it opened with. Reads one row, never calls Composio. */
  composioSignature(): string | null {
    return this.#composio.signature()
  }

  async composioCall(name: string, args: Record<string, unknown>, egress?: typeof fetch): Promise<ComposioCallResult> {
    try {
      return await this.#composio.call(name, args, egress)
    } catch (e) {
      return this.fail(composioFailure(e), e)
    }
  }

  /** The real toolkit slug for an app the agent named, so a connect link is not made for a slug that does not exist. */
  async composioToolkit(app: string): Promise<string | null> {
    try {
      return await this.#composio.resolveToolkit(app)
    } catch {
      return null
    }
  }

  /** A chat's agent failed to answer. Every open client hears it; the one showing that chat has the line in its transcript and skips the toast. */
  async notifyError(error: KikoError, roomId: RoomId): Promise<void> {
    this.broadcast({ t: "error", error, roomId })
  }

  /** Tells the human what broke, then lets the caller see the error as before. */
  private fail(error: KikoError | null, cause: unknown): never {
    if (error) this.broadcast({ t: "error", error })
    throw cause
  }

  #composioConnection?: ComposioConnection
  get #composio(): ComposioConnection {
    this.#composioConnection ??= new ComposioConnection(
      new ComposioStore(this.sql, keyringFromEnv(this.env), this.ownerId),
      () => composioUserId(this.ownerId),
      this.egress,
      (work) => this.ctx.waitUntil(work),
    )
    return this.#composioConnection
  }

  private async composioFrame(ws: WebSocket, frame: Extract<UserFrame, { t: "connectComposio" | "disconnectComposio" | "composioStatus" }>) {
    const composio = this.#composio
    let result: ComposioResult
    try {
      if (frame.t === "connectComposio") result = { ok: true, ...(await composio.connect(frame.apiKey)) }
      else if (frame.t === "disconnectComposio") {
        composio.disconnect()
        result = { ok: true, status: composio.status() }
      } else {
        const tools = frame.tools ? await composio.tools() : null
        result = { ok: true, status: composio.status(), ...(tools ? { tools: tools.map((t) => t.name), readOnly: tools.flatMap((t) => (t.readOnly ? [t.name] : [])) } : {}) }
      }
    } catch (e) {
      result = { ok: false, error: composioErrorText(e) }
    }
    send(ws, { t: "composio", reqId: frame.reqId, result })
    if (result.ok && frame.t !== "composioStatus") {
      const { tools: _, ...others } = result
      const text = JSON.stringify({ t: "composio", result: others } satisfies UserToClient)
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() as Attachment | null)?.ready) trySend(other, text)
      }
    }
  }

  #kernelWiring?: KernelWiring
  get #kr(): KernelWiring {
    this.#kernelWiring ??= new KernelWiring({ fetch: this.egress, services:this.services, ctx: this.ctx, sql: this.sql, env: this.env, alarms: this.alarms, userId: () => this.ownerId, notify: (error) => this.broadcast({ t: "error", error }) })
    return this.#kernelWiring
  }

  /** The user's browser for `agentId`, always headful so it has a live view. Creates it when there is none. */
  async browserLease(agentId: string): Promise<Lease> {
    return this.#kr.lease(agentId)
  }

  /** Stamps last use. `tabs` (tab id to last URL) replaces the agent's tabs. False when the browser it knew is gone. */
  async browserTouch(agentId: string, tabs?: Record<string, string>): Promise<boolean> {
    return this.#kr.touch(agentId, tabs)
  }

  /** Whether the human holds the browser. A paused agent is woken when control comes back. */
  async browserTakeover(agentId: string, roomId: string): Promise<boolean> {
    return this.#kr.paused(agentId, roomId)
  }

  /** The live view link for the human, with a reason it is also posted to the room. */
  async browserLive(agentId: string, roomId: string, mode: "watch" | "control", reason?: string): Promise<LiveLinkResult> {
    return this.#kr.liveLink(agentId, roomId, mode, reason)
  }

  /** An agent gives control back on the human's word in the chat. False when the agents already had it. */
  async browserHandBack(agentId: string): Promise<boolean> {
    return this.#kr.handBack(agentId)
  }

  /** The agent's socket died: the next lease makes a new browser. */
  async browserDead(agentId: string, sessionId: string): Promise<boolean> {
    return this.#kr.dead(agentId, sessionId)
  }

  /** Read before each browser call. Holds no URL. */
  async browserCheck(agentId?: string): Promise<BrowserCheck> {
    return this.#kr.check(agentId)
  }

  async devBrowser(op: DevBrowserOp): Promise<Record<string, unknown>> {
    return (await this.dev()).devBrowser(() => this.#kr, this.ownerId, op)
  }

  async openSocket(server:WebSocket,request:Request):Promise<void>{
    this.models.syncIfStale()
    server.serializeAttachment({ready:false,helloBy:helloBy()} satisfies Attachment)
    const origin=request.headers.get("origin")??new URL(request.url).origin
    if(this.setting(PUBLIC_ORIGIN)!==origin)this.putSetting(PUBLIC_ORIGIN,origin)
    this.ctx.waitUntil(waitForHello(server))
  }

  private deviceId(): string {
    const existing = this.setting(DEVICE_ID)
    if (existing) return existing
    const id = crypto.randomUUID()
    this.putSetting(DEVICE_ID, id)
    return id
  }

  #logins?: ProviderLogins<WebSocket>
  get #loginState(): ProviderLogins<WebSocket> {
    this.#logins ??= new ProviderLogins<WebSocket>({
      store: this.#credentials,
      deviceId: () => this.deviceId(),
      info: (provider) => this.#credentials.listProviders().find((p) => p.provider === provider) ?? null,
      send,
      devProvider: async (id) => {
        try {
          return (await loadUserDev()).fakeProvider(id)
        } catch {
          return undefined
        }
      },
    })
    return this.#logins
  }

  #updateWiring?: UpdateWiring
  get #update(): UpdateWiring {
    this.#updateWiring ??= new UpdateWiring({
      env: this.env,
      sql: this.sql,
      userId: () => this.ownerId,
      broadcast: (frame) => this.broadcast(frame),
    })
    return this.#updateWiring
  }

  async devUpdateConfig(config: Record<string, unknown>): Promise<void> {
    return (await this.dev()).devUpdateConfig(this.sql, config)
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      await this.handleMessage(ws, message)
    } catch (e) {
      console.error(`user frame failed: ${e instanceof Error ? e.message : String(e)}`)
      send(ws, { t: "error", error: STORAGE_ERROR })
    }
  }

  private async handleMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let frame: typeof ClientToUser.Type
    try {
      frame = decodeFrame(JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)))
    } catch {
      return
    }
    if (frame.t === "hello") {
      this.seen()
      // The reply says which build answered, so the client can tell it is out of date.
      const fileToken = await signToken(this.env.SESSION_SECRET, this.ownerId, "files")
      send(ws, { ...this.resume(frame.lastSeq), ...BACKEND, ...{ fileToken } })
      // The client starts with no browser, so a hello sends a browser only when there is one.
      const browser = this.#kr.browserState()
      if (browser) send(ws, { t: "browserState", state: browser })
      for (const [roomId, names] of this.#typing) send(ws, { t: "typing", roomId, names })
      const before = ws.deserializeAttachment() as Attachment | null
      ws.serializeAttachment({ ...before, ready: true } satisfies Attachment)
      return
    }
    if (frame.t === "connectComposio" || frame.t === "disconnectComposio" || frame.t === "composioStatus") {
      await this.composioFrame(ws, frame)
      return
    }
    if (frame.t === "browserLink" || frame.t === "handBack" || frame.t === "closeBrowser") {
      await this.#kr.browserFrame(ws, frame)
      return
    }
    if (frame.t === "connectKernel" || frame.t === "disconnectKernel" || frame.t === "kernelStatus") {
      await this.#kr.kernelFrame(ws, frame)
      return
    }
    if (frame.t === "memory") {
      const result = await this.#mem.call(frame.op)
      if (result.ok && (frame.op.op === "note" || frame.op.op === "redact" || frame.op.op === "pin")) this.changed("memory")
      send(ws, { t: "memory_result", reqId: frame.reqId, result })
      return
    }
    if (frame.t === "theme") {
      this.saveTheme(frame.theme)
      return
    }
    if (frame.t === "search") {
      send(ws, { t: "search", query: frame.query, chats: this.directory.search( frame.query.slice(0, 200)) })
      return
    }
    if (frame.t === "agent") {
      if (frame.op.op === "delete") await this.deleteAgent(frame.op.slug)
      else this.saveAgent(frame.op.agent)
      return
    }
    if (frame.t === "agent_model") {
      if (!this.setAgentModel(frame.slug, frame.ref, frame.thinking, frame.roomId)) {
        send(ws, { t: "model_refused", slug: frame.slug, message: frame.ref ? `The model did not change. Kiko does not know ${frame.ref}. Pick another one.` : "The model did not change. Pick a model first." })
      }
      return
    }
    if (frame.t === "open") {
      if (this.setting(LAST_CHAT) !== frame.roomId) this.putSetting(LAST_CHAT, frame.roomId)
      return
    }
    if (frame.t === "home") {
      const refused = this.homeOp(frame.op)
      if (refused) send(ws, { t: "home_refused", op: frame.op, reason: refused })
      return
    }
    if (frame.t === "update.start") return this.#update.start(frame.version)
    if (frame.t === "login.start") {
      // A sign-in socket never sends hello, and a person takes longer than the hello deadline to approve in the browser.
      const before = ws.deserializeAttachment() as Attachment | null
      if (!before?.ready) ws.serializeAttachment({ ...before, ready: true } satisfies Attachment)
      // The person leaves to approve in another tab, often for minutes. A promise outside waitUntil does not keep
      // the object awake, so it would hibernate after 10 s and forget the sign-in. waitUntil holds it up to 15 min.
      return void this.ctx.waitUntil(this.#loginState.start(ws, frame.loginId, frame.provider).catch(() => {}))
    }
    if (frame.t === "login.answer") return this.#loginState.answer(ws, frame.loginId, frame.promptId, frame.value)
    if (frame.t === "login.cancel") return this.#loginState.cancel(ws, frame.loginId)
    const existing = this.existingFor(frame.op)
    if (existing) return send(ws, { t: "chat_refused", roomId: frame.op.roomId, existing })
    this.apply(frame.op)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.#logins?.dropOwner(ws)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.#logins?.dropOwner(ws)
    // Presence lives in memory while a socket is open; the close keeps it for away detection after an unload.
    const now = Date.now()
    if ((ws.deserializeAttachment() as Attachment | null)?.ready && now - Number(this.setting(LAST_SEEN) ?? 0) >= 3_600_000) this.putSetting(LAST_SEEN, String(now))
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {
    }
  }

  async alarm(): Promise<void> {
    const due = await this.alarms.dueWakeups(Date.now())
    await runDue(this.alarms, due, {
      deletion_agents: () => this.cleanDeletedAgents(),
      deletion: () => this.cleanDeletedChats(),
      [HELLO_WAKEUP]: () => enforceHello(this.ctx, this.alarms),
      [REAP_WAKEUP]: () => this.#kr.reap(),
    })
  }

  /** The daily initiative pass runs now. The dev route asks for it. */
  async devPass(): Promise<unknown> {
    return (await this.dev()).devPass(() => this.#initiative)
  }

  private apply(op: ChatOp): UserEvent | null {
    if (movesKikoChat(this.sql, op) || this.existingFor(op)) return null
    const event = this.commit(this.directory.apply( op, Date.now()))
    // A deleted chat keeps no reminders or routines.
    if (event && op.op === "delete") {

      this.sql.exec("DELETE FROM capture_queue WHERE room_id = ?", op.roomId)
      this.life.redactRefs(this.life.refsLike(`room:${op.roomId}:`))
      this.changed("memory")
      this.sql.exec("INSERT OR IGNORE INTO deletion_rooms (room_id) VALUES (?)", op.roomId)
      this.ctx.waitUntil(this.alarms.setWakeup("deletion", Date.now()))
    }
    if (event && op.op === "private") {
      const room = this.services.room(op.roomId)
      this.ctx.waitUntil(Promise.resolve(room.setPrivate(op.private)).catch((e: unknown) => console.error(`private flag not sent: ${e instanceof Error ? e.message : String(e)}`)))
    }
    return event
  }

  /** A create that would make a second chat with the same agents names the chat that is already there. */
  private existingFor(op: ChatOp): RoomId | null {
    if (op.op !== "create") return null
    return sameAgentChat(this.directory.list().map((c) => markKikoChat(this.sql, c)), op.agents ?? [], op.roomId)?.roomId ?? null
  }

  private lastChat(): RoomId | undefined {
    const stored = this.setting(LAST_CHAT)
    const chat = stored ? this.directory.get( stored) : null
    return chat?.roomId ?? kikoChatRoom(this.sql) ?? undefined
  }

  async ensureHome(): Promise<void> {
    this.ctx.waitUntil(this.#recipes.retireSeeded().catch((e: unknown) => console.error(`recipe cleanup failed: ${e instanceof Error ? e.message : String(e)}`)))
    for (const op of kikoChatOps(this.sql, this.directory.list())) this.apply(op)
    // The Kiko chat is Kiko alone, also for a chat record that listed an agent added before that rule.
    const home = kikoChatRoom(this.sql)
    if (home) this.commit(this.directory.agents( home, [KIKO]))
    const old = this.setting(OLD_CHECK_IN)
    if (old !== null) {
      await this.reminders.cancel(old)
      deleteSetting(this.sql, OLD_CHECK_IN)
      deleteSetting(this.sql, OLD_CHECK_IN_SEEN)
    }
  }

  private saveAgent(agent: Agent): Agent | null {
    if (this.sql.exec("SELECT 1 FROM deleted_agent_handles WHERE slug = ?", agent.slug).toArray().length) {
      this.broadcast({ t: "error", error: { code: "storage", message: "This agent handle was deleted and cannot be reused. Choose a new handle." } })
      return null
    }
    const stored = createAgent(this.sql, agent, Date.now())
    if (!stored) return null
    this.commit({ t: "agent", agent: stored })
    // A new agent starts on the model it was made with, or on Kiko's. With neither it has none, and its first run asks.
    // Always announce it: the pick can equal what it already resolves to, and the client still needs an entry for the new agent.
    const model = stored.model || agentModel(this.sql, KIKO)?.model
    if (model) this.setAgentModel(stored.slug, model, undefined, undefined, true)
    return stored
  }

  /** The one setter for an agent's model and level. Every chat, Settings, and the next run read what it saves. */
  setAgentModel(slug: AgentSlug, ref?: string, thinking?: ThinkingLevel, roomId?: RoomId, announce = false): AgentModel | null {
    const before = agentModel(this.sql, slug)
    const saved = saveAgentModel(this.sql, slug, ref, thinking)
    if (!saved) return null
    if (!announce && JSON.stringify(saved) === JSON.stringify(before)) return saved
    this.commit({ t: "agent_model", slug, ...saved })
    if (roomId && saved.model !== before?.model) {
      this.ctx.waitUntil(Promise.resolve(this.services.room(roomId).modelChanged(slug, saved.model, before?.model)).catch(() => {}))
      // The harness keeps its model until it reloads, so an idle agent drops it now and a busy one drops it when the run ends.
      this.ctx.waitUntil(Promise.resolve(this.services.agent(roomId, slug).invalidate()).catch(() => {}))
    }
    return saved
  }

  private saveTheme(theme: string | null): boolean {
    if (!setTheme(this.sql, theme)) return false
    this.commit({ t: "theme", theme })
    return true
  }

  private currentSeq(): number {
    return this.sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM user_events").one().seq ?? 0
  }

  private commit(change: ChatChange | { t: "agent"; agent: Agent } | { t: "agent_removed"; id: string; slug: AgentSlug } | ({ t: "agent_model"; slug: AgentSlug } & AgentModel) | { t: "theme"; theme: string | null } | FileBody | null): UserEvent | null {
    if (!change || (change.t === "chat" && change.chat.pair)) return null
    if (change.t === "chat") change = { ...change, chat: markKikoChat(this.sql, change.chat) }
    const at = Date.now()
    const seq = this.currentSeq() + 1
    const event = { ...change, seq, at } as UserEvent
    this.sql.exec("INSERT INTO user_events (seq, at, body) VALUES (?, ?, ?)", seq, at, JSON.stringify(event))
    this.sql.exec("DELETE FROM user_events WHERE seq <= ?", seq - REPLAY_LIMIT)
    if (this.holding) this.holding.push(event)
    else this.broadcast({ t: "events", events: [event] })
    return event
  }

  private broadcast(frame: UserToClient): void {
    this.publishFrame(frame)
  }

  private resume(lastSeq: number): UserToClient {
    const seq = this.currentSeq()
    const { oldest } = this.sql.exec<{ oldest: number | null }>("SELECT min(seq) AS oldest FROM user_events").one()
    const replayable = false // Room activity is projected from room state, so every reconnect refreshes the chat list.
    if (!replayable) {
      const lastChat = this.lastChat()
      return {
        t: "reset",
        snapshot: { seq, chats: this.directory.list().map((c) => markKikoChat(this.sql, c)), agents: listAgents(this.sql), agentModels: allAgentModels(this.sql), theme: getTheme(this.sql), home: { files: this.home.all(), folders: this.home.folders() }, ...(lastChat ? { lastChat } : {}) },
      }
    }
    const events = this.sql
      .exec<{ body: string }>("SELECT body FROM user_events WHERE seq > ? ORDER BY seq", lastSeq)
      .toArray()
      .map((r) => JSON.parse(r.body) as UserEvent)
    return { t: "events", events }
  }

  // How much the initiative engine may speak up unasked, and whether memory capture writes down what it hears.

  async userSettings(): Promise<UserSettings> {
    const timezone = this.setting("timezone")
    return {
      initiative: this.initiativeLevel(),
      capture: this.#mem.policy().capture,
      ...(timezone ? { timezone } : {}),
      ...(this.setting("onboarded") ? { onboarded: true } : {}),
    }
  }

  async setUserSettings(patch: UserSettingsPatch): Promise<UserSettings> {
    // The route checked the zone. The daily pass is at nine in it, so the pass is set again.
    if (patch.timezone) this.putSetting("timezone", patch.timezone)
    if (patch.initiative) this.putSetting("initiative", patch.initiative)
    if (patch.capture) this.#mem.setCapture(patch.capture)
    if (patch.onboarded) this.putSetting("onboarded", "1")
    return this.userSettings()
  }
}
