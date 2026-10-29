import { diffRows, type RowChange, rowLists } from "./rows"
import type { Provider } from "@earendil-works/pi-ai"
import { isAgentSlug } from "@kiko/protocol"
import {
  type CustomApi,
  KIKO,
  ROW_KINDS,
  newRoomId,
  pairRoomId,
  sameAgentChat,
  type ThinkingLevel,
} from "@kiko/protocol"
import { HomeWiring } from "./home-wiring"
import { RoutineWiring } from "./routines-wiring"
import type {
  Actor,
  Agent,
  AgentModel,
  AgentSlug,
  Chat,
  ChatOp,
  FileOp,
  AgentOp,
  MemoryOp,
  ComposioResult,
  InstallRecipe,
  NoticeError,
  ProviderInfo,
  RecipeList,
  RoomId,
  RowKind,
  UserRows,
  RunErrorKind,
  UserChange,
  UserEvent,
  UserToClient,
} from "@kiko/protocol"
import { RecipeLibrary } from "./recipe-library"
import { matchRecipes, type RecipeHint } from "../recipes/match"
import { capitalized, soulFromDescription } from "../room/chief"
import { makeAgentChat } from "../room/new-agent"
import { RecipeService } from "./recipe-service"
import { recipeCard } from "../recipes/card"
import {
  ConflictError,
  DuplicateChatError,
  FileConflictError,
  INITIATIVE_LEVELS,
  mergeHits,
  NotFoundError,
  ProtocolError,
  RefusedError,
  StorageError,
  type UserSettings,
  type UserSettingsPatch,
} from "@kiko/protocol"
import type { OwnerServices, ServiceOptions } from "../owner/services"
import { loadUserDev } from "../lib/dev-guard"
import { signToken } from "../auth/auth"
import { BACKEND } from "../lib/version"
import * as Effect from "effect/Effect"
import { validZone } from "@kiko/sandbox/recurrence"
import { sha256Hex } from "@kiko/durable/hash"
import { cleanPath, deleteFiles, fileKey, MAX_SINGLE_PUT_BYTES, mime } from "../files/paths"
import { SLUG } from "../skills/frontmatter"
import type { Env } from "../index"
import { ComposioConnection } from "../integrations/composio/connect"
import { composioFailure, composioIntegrationError } from "./user-errors"
import { connectLinkFor, MANAGE_CONNECTIONS } from "../integrations/composio/connect-tool"
import { ComposioStore } from "../integrations/composio/store"
import { Apps } from "../apps/service"
import { builderFrom } from "../apps/builder-client"
import type { ComposioCallResult, ComposioTool } from "../integrations/composio/client"
import type { Lease } from "../agent/browser/lease"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import { runDue } from "../owner/clock"
import { kikoChatOps, kikoChatRoom, markKikoChat, movesKikoChat } from "./kiko-chat"
import { keyringFromEnv } from "@kiko/durable/crypto"
import { checkApiKey, CredentialVault, isProviderId } from "./credentials"
import { keyRefused, keyRefusedText } from "./credentials-check"
import { problemOfRun } from "./provider-health"
import { ProviderCheck } from "./provider-check"
import { userModels } from "../agent/factory"
import { agentNamed, createAgent, listAgents } from "./agents"
import { agentModel, allAgentModels, saveAgentModel } from "./agent-models"
import { firstSoul, type Soul, Souls, type SoulWrite } from "./souls"
import {
  type CommitResult,
  type FileBody,
  FileIndex,
  type IndexChange,
  type FsChange,
  type FsEntry,
  type FsFail,
  listOwnerFiles,
  type NewFile,
  type PutResult,
  ROOM_TABLES,
} from "../files/file-index"
import { actorKey } from "../room/actor-key"
import { RoomDirectory, type ChatChange } from "../room/directory"
import { Life } from "@kiko/memory/life"
import { itemLine, spanOf } from "@kiko/memory/optmem"
import type { NoteAnswer } from "@kiko/memory/tools"
import { ProviderLogins, signInMethod } from "./provider-login"
import { ModelCatalog } from "../models/service"
import { isCustomId } from "../models/custom"
import { addCustom, refreshCustom, removeCustom } from "./custom-providers"
import { type CatalogOverlay, findProvider } from "../models/catalog"
import { type NewRoutine, Reminders, type RoutineRun, type RunDelivery } from "./reminders"
import { deleteSetting, getSetting, setSetting } from "../lib/settings"
import { roomOverview } from "../room/overview"
import { routineRun, type SignalBatch } from "../room/routine-events"
import { createAgentRoutine, roomRoutine, type RoutineResult } from "./routines"
import { DEFAULT_TIMEZONE, resolveTurnContext, type TurnContext } from "./turn-context"
import { getTheme, setTheme } from "./theme"
import { composioUserId } from "../lib/names"
import { INITIATIVE_RUN, InitiativeEngine, type Level } from "../initiative/engine"
import { REAP_WAKEUP } from "../integrations/kernel/lease"
import type { DevBrowserOp } from "./dev"
import { type BrowserCheck, KernelWiring, type LiveLinkResult } from "./kernel-wiring"
import { ComputerWiring } from "./computer-wiring"
import { COMPUTER_WAKEUP } from "../computer/hub"
import type { ComputerHub } from "../computer/hub"
import type { ComputerSummary } from "@kiko/protocol"
import type { Op } from "@kiko/computer/wire"
import type { ComputerLinkResult, PcCallOutcome, PcReleased } from "../computer/types"
import { MemoryCapture } from "./memory-capture"
import { type Attachment, send } from "./socket-frames"
import { AWAY_MS, LAST_SEEN } from "./keys"
import { SelfUpdate } from "./update-wiring"

const REPLAY_LIMIT = 500

const DELETED_HANDLE = "This agent handle was deleted and cannot be reused. Choose a new handle."
const MAX_QUERY = 200
const MAX_SEARCH_ROOMS = 30
const SEARCH_LIMIT = 20
const AGENT_ID = /^[0-9a-f-]{36}$/
const MAX_AGENT_NAME = 60
const MAX_AGENT_DESCRIPTION = 500
const MAX_RECIPE_SLUG = 64
const EXPECT_SHA = /^(none|[0-9a-f]{64})$/
const EXPECT_ERROR = "say what you saw at the path: the sha256 of its bytes, or none for a new file"

const routineOutcome = (out: RoutineResult) =>
  out.ok
    ? Effect.void
    : Effect.fail(
        out.error === "no such routine"
          ? new NotFoundError({ resource: "routine", message: out.error })
          : new ProtocolError({ message: out.error }),
      )

const AWAY_NOTICE = "away_notice"
const PUBLIC_ORIGIN = "public_origin"
const DEVICE_ID = "device_id"
const OLD_CHECK_IN = "check_in"
const OLD_CHECK_IN_SEEN = "check_in_seen"

const LAST_CHAT = "last_chat"

type NewAgentOutcome = { ok: true; agent: Agent; roomId: RoomId } | { ok: false; error: string }

const BUILDER_REPAIR = "builder_repair"

export class User {
  private readonly sql: SqlStorage
  private alarms!: Alarms
  private models!: ModelCatalog
  private life!: Life
  private souls!: Souls
  private home!: FileIndex<UserEvent>
  private holding: UserEvent[] | null = null
  private lastSeen = 0
  private readonly directory: RoomDirectory

  private readonly ctx: DurableObjectState
  private readonly env: Env
  private readonly computers: ComputerHub
  private readonly services: OwnerServices
  private readonly ownerId: string
  private readonly publishFrame: (frame: unknown) => void
  private readonly egress: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    return this.services.egress({
      url: request.url,
      method: request.method,
      headers: [...request.headers],
      body: request.body ? await request.arrayBuffer() : null,
    })
  }
  constructor(options: ServiceOptions) {
    const { ctx, env, services, sql, broadcast, computers } = options
    this.ctx = ctx
    this.computers = computers
    this.ownerId = options.identity.ownerId
    this.env = env
    this.services = services
    this.sql = sql
    this.publishFrame = broadcast

    this.directory = new RoomDirectory(this.sql, this.services)
    {
      this.alarms = options.clock
      this.models = new ModelCatalog({
        sql: this.sql,
        now: Date.now,
        fetch: (url, init) =>
          this.services.egress({
            url,
            method: init.method ?? "GET",
            headers: [...new Headers(init.headers)],
            body: null,
          }),
        signInMethod,
        changed: () => this.changed("models"),
      })

      this.life = new Life(this.sql, (fn) => ctx.storage.transactionSync(fn), {
        get: (key) => this.setting(key),
        set: (key, value) => this.putSetting(key, value),
      })
      this.souls = new Souls(this.sql)
      this.home = new FileIndex<UserEvent>(
        ctx.storage,
        ROOM_TABLES,
        (_, body) => {
          const event = this.commit(body)
          if (!event) throw new Error("file change produced no event")
          return event
        },
        actorKey,
      )
      this.reminders = new Reminders(
        this.sql,
        { sync: (routines) => this.services.syncRoutines(routines) },
        Date.now,
        {
          deliverRun: async ({ deliveryId, routine, body }) => {
            return this.services.room(routine.roomId).deliverRoutine(deliveryId, { target: routine.target, body })
          },
          notice: (roomId, id, text) => this.services.room(roomId).systemNotice(id, text, "routine"),
          gate: {
            away: () => {
              const last = Math.max(this.lastSeen, Number(this.setting(LAST_SEEN) ?? 0))
              const connected = this.ctx
                .getWebSockets("tab")
                .some((ws) => (ws.deserializeAttachment() as Attachment | null)?.ready)
              const away = !connected && last > 0 && Date.now() - last > AWAY_MS
              if (away) this.ctx.waitUntil(this.awayNotice(Date.now()).catch(() => {}))
              return away
            },
          },
        },
        () => this.project("routine"),
      )
    }
  }

  private reminders!: Reminders
  async listRoutines() {
    return this.reminders.list()
  }
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
  async updateRoutine(id: string, patch: Parameters<Reminders["updateRoutine"]>[1]): Promise<RoutineResult> {
    return this.#routines.updateRoutine(id, patch)
  }

  async recipeList(): Promise<RecipeList> {
    const { cards, custom, installs, broken } = await this.#recipes.list()
    const connected = await this.#composio.connectedToolkits().catch(() => null)
    return { cards: cards.map((r) => recipeCard(r, custom.has(r.slug), connected)), installs, broken }
  }

  async recipeHints(description: string): Promise<RecipeHint[]> {
    return matchRecipes(description, (await this.#recipes.list()).cards)
  }

  async createAgentChat(input: {
    id: string
    roomId: RoomId
    name: string
    handle: string
    description: string
  }): Promise<NewAgentOutcome> {
    const owner = this.ownerId
    const out = await makeAgentChat(
      {
        agents: async () => listAgents(this.sql),
        make: (spec) =>
          this.makeAgent({
            id: spec.id,
            name: spec.name,
            slug: spec.handle,
            description: spec.description,
            soul: spec.soul,
            model: "",
          }),
        openChat: (title, agentIds, roomId) => this.openChat(title, agentIds, roomId),
        recipes: (description) => this.recipeHints(description),
        introduce: (roomId, agent, text) => this.services.room(roomId).introduce(owner, agent.slug, text),
      },
      {
        name: input.name,
        handle: input.handle,
        description: input.description,
        soul: soulFromDescription(capitalized(input.name.trim()), input.description),
      },
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
      changed: () => this.changed("recipes"),
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
        return roomId
          ? this.services
              .room(roomId)
              .modelOf("kiko")
              .catch(() => "")
          : ""
      },
      composio: {
        connected: async () =>
          this.#composio.status().connected
            ? await this.#composio.connectedToolkits(Date.now(), true).catch(() => null)
            : "off",
        link: async (app) => {
          const manage = (await this.#composio.tools().catch(() => null))?.find((t) => t.name === MANAGE_CONNECTIONS)
          const out =
            manage &&
            (await connectLinkFor(
              manage,
              (name, args) => this.#composio.call(name, args),
              app,
              (named) => this.#composio.resolveToolkit(named),
            ))
          return out && out.kind === "link" ? out.link : null
        },
      },
      announce: (roomId, input) =>
        this.services.room(roomId).addRecipe(owner(), { ...input, agent: input.agent as AgentSlug }),
    })
    return this.#recipeService
  }

  async overview(): Promise<string> {
    const tz = this.setting("timezone") ?? DEFAULT_TIMEZONE
    return roomOverview(this.directory, this.services, {
      reminders: this.reminders.list(),
      runs: this.reminders.runs(),
      tz,
      now: Date.now(),
    })
  }

  private devCache?: Promise<typeof import("./dev")>
  private dev(): Promise<typeof import("./dev")> {
    this.devCache ??= loadUserDev()
    return this.devCache
  }

  async devSeen(ago: number): Promise<void> {
    this.lastSeen = Date.now() - ago
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
    for (const s of batch.signals)
      if (s.kind === "routine_result" && s.routineId !== INITIATIVE_RUN)
        await this.reminders.finishRun(s.routineId, s.occurrence, s.outcome, s.seq)
    if (!batch.signals.some((s) => s.kind === "burst")) return
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
    const chat = this.directory.get(this.existingFor(op) ?? roomId)
    if (!chat) throw new Error(`chat ${roomId} is missing right after create`)
    return chat
  }

  async renameChat(roomId: RoomId, title: string): Promise<Chat | null> {
    this.apply({ op: "rename", roomId, title })
    return this.directory.get(roomId)
  }

  async pinChat(roomId: RoomId, pinned: boolean): Promise<Chat | null> {
    this.apply({ op: "pin", roomId, pinned })
    return this.directory.get(roomId)
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
    if (!isAgentSlug(slug) || slug === KIKO)
      return { ok: false as const, error: "kiko cannot be deleted; use a valid agent handle" }
    this.sql.exec("INSERT OR IGNORE INTO deleted_agent_handles (slug) VALUES (?)", slug)
    const agent = this.sql.exec<{ id: string }>("SELECT id FROM agents WHERE slug = ?", slug).toArray()[0]
    this.sql.exec("INSERT OR IGNORE INTO deletion_agents (slug) VALUES (?)", slug)
    if (agent) this.commit({ t: "agent_removed", id: agent.id, slug })
    await this.alarms.setWakeup("deletion_agents", Date.now() + 30_000)
    const result = await this.deleteAgentNow(slug)
    if (result.ok) this.sql.exec("DELETE FROM deletion_agents WHERE slug = ?", slug)
    return result
  }

  private async cleanDeletedAgents(): Promise<void> {
    for (const { slug } of this.sql.exec<{ slug: AgentSlug }>("SELECT slug FROM deletion_agents").toArray()) {
      const result = await this.deleteAgentNow(slug)
      if (!result.ok) throw new RefusedError({ reason: "agent", message: result.error })
      this.sql.exec("DELETE FROM deletion_agents WHERE slug = ?", slug)
    }
    await this.alarms.clearWakeup("deletion_agents")
  }

  private async deleteAgentNow(slug: AgentSlug) {
    const agent = this.sql.exec<{ id: string }>("SELECT id FROM agents WHERE slug = ?", slug).toArray()[0]
    if (!agent) return { ok: true as const, text: "agent already deleted" }
    for (const row of this.directory
      .list(true)
      .filter((c) => c.agents?.includes(agent.id))
      .map((c) => ({ room_id: c.roomId }))) {
      const chat = this.directory.get(row.room_id)
      if (!chat) continue
      if (chat.pair || (chat.agents?.length ?? 0) <= 1) await this.deleteChat(chat.roomId)
      else {
        const room = this.services.room(chat.roomId)
        const reason = await room.memberOp({ op: "remove", slug })
        if (reason && reason !== "unknown") return { ok: false as const, error: reason }
        await this.services.agent(chat.roomId, slug).erase()
        await this.chatMembers(
          chat.roomId,
          (await room.memberSlugs()).filter((s) => s !== slug),
        )
      }
    }
    for (const { room_id } of this.sql.exec<{ room_id: RoomId }>("SELECT room_id FROM room_directory").toArray())
      await this.services.room(room_id).eraseFormerAgent(slug)
    await this.#recipes.agentGone(slug)
    await this.reminders.cancelAgent(slug)
    for (const { pos } of this.sql
      .exec<{ pos: number }>("SELECT pos FROM life WHERE source = ? AND redacted = 0", `@${slug}`)
      .toArray())
      this.life.redact(pos)
    this.changed("memory")
    this.sql.exec("DELETE FROM souls WHERE slug = ?", slug)
    this.project("soul")
    deleteSetting(this.sql, `agentModel:${slug}`)
    this.sql.exec("DELETE FROM agents WHERE id = ?", agent.id)
    return { ok: true as const, text: `@${slug} deleted` }
  }

  roomChanged(roomId: RoomId): void {
    const chat = this.directory.get(roomId)
    if (chat && !chat.pair)
      this.broadcast({
        t: "events",
        events: [
          { t: "chat", chat: markKikoChat(this.sql, chat), seq: this.currentSeq(), at: Date.now(), projection: true },
        ],
      })
  }

  readonly #typing = new Map<RoomId, readonly string[]>()

  async chatTyping(roomId: RoomId, names: readonly string[]): Promise<void> {
    if (!this.directory.get(roomId)) return
    if (names.length) this.#typing.set(roomId, names)
    else this.#typing.delete(roomId)
    this.broadcast({ t: "typing", roomId, names })
  }

  private loadRows<K extends RowKind>(kind: K): UserRows[K][] {
    const rows: { [L in RowKind]: () => UserRows[L][] } = {
      routine: () =>
        this.reminders.list().flatMap((r) =>
          r.trigger && (r.status === "active" || r.status === "paused")
            ? [
                {
                  id: r.id,
                  name: r.name || "Routine",
                  roomId: r.roomId,
                  status: r.status,
                  trigger: r.trigger,
                  tz: r.tz,
                },
              ]
            : [],
        ),
      soul: () => this.souls.all().map(({ slug, ...soul }) => ({ id: slug as AgentSlug, ...soul })),
      provider: () => this.#credentials.listProviders().map((p) => ({ id: p.provider, ...this.#mem.describe(p) })),
    }
    return rows[kind]() as UserRows[K][]
  }

  private project(kind: RowKind): void {
    this.ctx.storage.transactionSync(() => {
      for (const change of diffRows(this.sql, kind, this.loadRows(kind))) this.commit(change)
    })
  }

  private changed(what: UserChange): void {
    if (what === "memory") this.putSetting("memory:revision", String(this.lifeRevision() + 1))
    this.broadcast({ t: "changed", what })
  }

  async searchChats(query: string): Promise<Chat[]> {
    return this.directory.search(query)
  }

  async listChats(): Promise<Chat[]> {
    return this.directory.list()
  }

  async chatMembers(roomId: RoomId, slugs: readonly string[]): Promise<void> {
    const ids = new Map(listAgents(this.sql).map((a) => [a.slug as string, a.id]))
    const before = new Set(this.directory.get(roomId)?.agents ?? [])
    for (const [slug, id] of ids)
      if (before.has(id) && !slugs.includes(slug)) {
        await this.#recipes.agentGone(slug, roomId)
        await this.reminders.cancelAgent(slug, roomId)
      }
    this.commit(
      this.directory.agents(
        roomId,
        slugs.flatMap((s) => (s === KIKO ? [KIKO] : ids.has(s) ? [ids.get(s)!] : [])),
        (agents) => this.groupTitle(agents),
      ),
    )
  }

  private groupTitle(ids: readonly string[]): string {
    const names = new Map(
      this.sql
        .exec<{ id: string; name: string }>("SELECT id, name FROM agents")
        .toArray()
        .map((a) => [a.id, a.name]),
    )
    return ids.map((id) => (id === KIKO ? "Kiko" : (names.get(id) ?? id))).join(", ")
  }

  async getChat(roomId: RoomId): Promise<Chat | null> {
    const chat = this.directory.get(roomId)
    return chat && markKikoChat(this.sql, chat)
  }

  async createAgent(agent: Agent): Promise<Agent | null> {
    return this.saveAgent(agent)
  }

  async listAgents(): Promise<Agent[]> {
    return listAgents(this.sql)
  }

  async soul(slug: string): Promise<Soul> {
    const soul = await this.souls.get(slug)
    this.project("soul")
    return soul
  }

  async setSoul(slug: string, body: string, expectSha: string): Promise<SoulWrite> {
    const result = await this.souls.set(slug, body, expectSha)
    if (result.ok) this.project("soul")
    return result
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

  async makeAgent(input: {
    id?: string
    name: string
    slug: string
    description: string
    soul: string
    model: string
  }): Promise<Agent | null> {
    if (this.handleDeleted(input.slug.trim().toLowerCase().replace(/^@/, "")))
      throw new RefusedError({ reason: "agent", message: DELETED_HANDLE })
    const agent = this.saveAgent({
      id: input.id ?? crypto.randomUUID(),
      name: input.name,
      slug: input.slug as AgentSlug,
      prompt: input.description,
      model: input.model,
    })
    if (!agent) return null
    await this.souls.seed(agent.slug, input.soul)
    this.project("soul")
    return agent
  }

  async openChat(
    title: string,
    agents: readonly string[],
    roomId: RoomId = newRoomId(),
  ): Promise<{ roomId: RoomId; created: boolean }> {
    const op: ChatOp = { op: "create", roomId, title, agents }
    const existing = this.existingFor(op)
    if (existing) return { roomId: existing, created: false }
    this.apply(op)
    return { roomId: op.roomId, created: true }
  }

  async openPair(a: string, b: string): Promise<{ ok: true; roomId: RoomId } | { ok: false; error: string }> {
    const mine = listAgents(this.sql)
    const idOf = (slug: string) => (slug === KIKO ? KIKO : mine.find((x) => x.slug === slug)?.id)
    const ids = [idOf(a), idOf(b)]
    if (ids[0] === undefined || ids[1] === undefined) {
      const known = [KIKO, ...mine.map((x) => x.slug)].filter((s) => s !== a)
      return {
        ok: false,
        error: `not sent: no agent @${ids[1] === undefined ? b : a}. the human has: ${known.map((s) => `@${s}`).join(", ")}.`,
      }
    }
    const roomId = pairRoomId(a, b)
    if (!this.directory.get(roomId))
      this.commit(
        this.directory.apply(
          {
            op: "create",
            roomId,
            title: [a, b]
              .sort()
              .map((s) => `@${s}`)
              .join(" and "),
            agents: ids as string[],
          },
          Date.now(),
          true,
        ),
      )
    return { ok: true, roomId }
  }

  async seedSoul(slug: string, name: string, role: string): Promise<Soul> {
    const soul = await this.souls.seed(slug, firstSoul(name, role))
    this.project("soul")
    return soul
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
    return {
      ok: true,
      pos: out.pos,
      ...(out.duplicate ? { duplicate: true as const } : {}),
      ...(replaces === undefined ? {} : { replaced }),
    }
  }

  async lifeRecall(query: string): Promise<string[]> {
    return this.life
      .recall(query, 10, { skipCard: true })
      .map((l) =>
        itemLine({ pos: l.pos, at: l.at, text: `${l.source ? `${l.source}: ` : ""}${l.text}` }, 400, true, "life"),
      )
  }

  async captureNow(): Promise<void> {
    await this.#mem.captureNow()
    await this.#mem.napLife()
  }

  async initiativePass(): Promise<void> {
    await this.#initiative.pass()
  }

  private routineSync: Promise<void> = Promise.resolve()

  syncRoutines(routines: readonly import("../owner/schedules").ScheduledRoutine[]): Promise<void> {
    const work = this.routineSync.then(() => this.applyRoutineInventory(routines))
    this.routineSync = work.catch(() => {})
    return work
  }

  private async applyRoutineInventory(
    routines: readonly import("../owner/schedules").ScheduledRoutine[],
  ): Promise<void> {
    const byAgent = new Map<string, import("../owner/schedules").ScheduledRoutine[]>()
    for (const routine of routines) {
      const key = `${routine.roomId}:${routine.target}`
      const list = byAgent.get(key)
      if (list) list.push(routine)
      else byAgent.set(key, [routine])
    }
    const previous = JSON.parse(this.setting("routine_agents") ?? "[]") as string[]
    for (const key of previous)
      if (!byAgent.has(key)) {
        const [roomId, target] = key.split(":")
        if (roomId && target) await this.syncAgentRoutines(roomId, target, [])
      }
    for (const list of byAgent.values()) {
      const { roomId, target } = list[0]!
      await this.syncAgentRoutines(roomId, target, list)
    }
    this.putSetting("routine_agents", JSON.stringify([...byAgent.keys()]))
  }

  private async syncAgentRoutines(
    roomId: string,
    target: string,
    routines: readonly import("../owner/schedules").ScheduledRoutine[],
  ): Promise<void> {
    try {
      await this.services.agent(roomId, target).syncRoutines(routines)
    } catch (e) {
      console.error(`routine sync for ${roomId}:${target} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async fireRoutine(delivery: import("../owner/schedules").RoutineDelivery): Promise<void> {
    await this.reminders.fireScheduled(delivery)
    this.project("routine")
  }

  async captureHuman(roomId: RoomId, items: { messageId: string; text: string; at: number }[]): Promise<void> {
    await this.#mem.captureHuman(roomId, items)
  }

  async forgetMessages(
    roomId: RoomId,
    messageIds: string[],
    requeue: { messageId: string; text: string; at: number }[],
    turns: number[],
  ): Promise<void> {
    const ids = [...new Set([...messageIds, ...requeue.map((r) => r.messageId)])]
    const gone = this.life.redactRefs(ids.map((id) => `room:${roomId}:msg:${id}`))
    this.sql.exec(
      "DELETE FROM capture_queue WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))",
      roomId,
      JSON.stringify(ids),
    )
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
    return { ...this.#mem.usage(), capture_queue: this.#mem.pending() }
  }

  async compress(prompt: string): Promise<{ text: string } | { retryAt: number } | { error: string }> {
    return this.#mem.compress(prompt)
  }

  async providerKeyRefused(provider: string, apiKey: string): Promise<string | null> {
    const key = checkApiKey(apiKey)
    const { models, settings } = userModels(
      async () => ({ auth: { apiKey: key } }),
      `check-${this.ctx.id.toString()}`,
      this.egress,
      () => this.services.countOutgoing(),
    )
    return keyRefused(models, provider, settings.stream?.headers, `check-${this.ctx.id.toString()}`)
  }

  async connectProvider(provider: string, apiKey: string): Promise<ProviderInfo> {
    const info = await this.#credentials.connect(provider, apiKey)
    return this.#mem.describe(info)
  }

  async disconnectProvider(provider: string): Promise<boolean> {
    const removed = await this.#credentials.disconnect(provider)
    if (isCustomId(provider) && removeCustom(this.sql, provider)) this.changed("models")
    return removed
  }

  private refreshCustomModels(): void {
    const key = async (id: string) => {
      const credential = await this.#credentials.read(id)
      return credential?.type === "api_key" ? credential.key : undefined
    }
    void refreshCustom(this.sql, key, this.egress, Date.now()).then((changed) => changed && this.changed("models"))
  }

  async devModelOverlay(overlay: CatalogOverlay): Promise<void> {
    await (await this.dev()).devModelOverlay(this.sql, overlay)
    this.changed("models")
  }

  async recordProviderProblem(provider: string, kind: RunErrorKind): Promise<void> {
    const problem = problemOfRun(kind)
    if (problem) this.#credentials.setProblem(provider, problem)
  }

  async providerRecovered(provider: string): Promise<void> {
    this.#credentials.setProblem(provider, null)
  }

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
    if (roomId)
      await this.services
        .room(roomId)
        .systemNotice(
          `away:${now}`,
          "i paused your routines and follow-ups while you were away. they start again when you open kiko.",
          "limit",
        )
  }

  async agentModel(slug: string): Promise<AgentModel | null> {
    return agentModel(this.sql, slug)
  }

  async setAgentModels(slugs: readonly AgentSlug[], ref: string, roomId: RoomId): Promise<void> {
    for (const slug of slugs) this.setAgentModel(slug, ref, undefined, roomId)
  }

  async agentTurn(slug: string): Promise<TurnContext & { model: string | null; thinking: ThinkingLevel }> {
    const picked = agentModel(this.sql, slug)
    if (!picked) return { ...(await this.turnContext("", slug)), model: null, thinking: "off" }
    return {
      ...(await this.turnContext(picked.model.slice(0, picked.model.indexOf("/")), slug)),
      model: picked.model,
      thinking: picked.thinking,
    }
  }

  async turnContext(provider: string, slug?: string): Promise<TurnContext> {
    const setting = (key: string) => getSetting(this.sql, key)
    const agent = slug ? { soul: await this.soul(slug) } : undefined
    return resolveTurnContext(
      this.#credentials,
      provider,
      { timezone: setting("timezone"), captures: this.#mem.captures() },
      agent,
      await this.lookupProvider(provider),
    )
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
    this.#vault ??= new CredentialVault(
      this.sql,
      () => keyringFromEnv(this.env),
      this.ownerId,
      () => this.project("provider"),
    )
    return this.#vault
  }

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
    this.#homeWiringCache ??= new HomeWiring({
      files: this.services.files(),
      ctx: this.ctx,
      env: this.env,
      home: this.home,
      holding: {
        set: (held) => {
          this.holding = held
        },
      },
      broadcast: (frame) => this.broadcast(frame),
    })
    return this.#homeWiringCache
  }

  #routinesWiring?: RoutineWiring
  get #routines(): RoutineWiring {
    this.#routinesWiring ??= new RoutineWiring({
      reminders: this.reminders,
      setRoutines: (roomId, routines) => this.services.room(roomId).setRoutines(routines),
      routineCreated: (roomId, slug, id, name, byAgent) =>
        this.services.room(roomId).routineCreated(slug, id, name, byAgent),
    })
    return this.#routinesWiring
  }

  #memory?: MemoryCapture
  get #mem(): MemoryCapture {
    this.#memory ??= new MemoryCapture({
      chat: (roomId) => this.directory.get(roomId),
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
      boards: () => {
        const rows = this.sql
          .exec<{
            room_id: string
            id: string
            title: string
            status: string
            owner: string | null
            updated_at: number
          }>(
            "SELECT room_id, id, title, status, owner, updated_at FROM ws_tasks WHERE NOT status IN ('done', 'cancelled') AND NOT id IS NULL ORDER BY updated_at",
          )
          .toArray()
        const boards = new Map<
          string,
          { roomId: string; oldest: { id: string; title: string; status: string; owner?: string; updatedAt: number }[] }
        >()
        for (const row of rows) {
          const board = boards.get(row.room_id) ?? { roomId: row.room_id, oldest: [] }
          if (board.oldest.length < 3)
            board.oldest.push({
              id: row.id,
              title: row.title,
              status: row.status,
              ...(row.owner ? { owner: row.owner } : {}),
              updatedAt: row.updated_at,
            })
          boards.set(row.room_id, board)
        }
        return [...boards.values()]
      },
      sql: this.sql,
      tz: () => getSetting(this.sql, "timezone") ?? DEFAULT_TIMEZONE,
      level: () => this.initiativeLevel(),
      title: (roomId) => {
        const chat = this.directory.get(roomId)
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

  async composioTools(): Promise<ComposioTool[] | null> {
    try {
      return await this.#composio.tools()
    } catch (e) {
      return this.fail(composioFailure(e), e)
    }
  }

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

  async composioToolkit(app: string): Promise<string | null> {
    try {
      return await this.#composio.resolveToolkit(app)
    } catch {
      return null
    }
  }

  async notifyError(error: NoticeError, roomId: RoomId): Promise<void> {
    this.broadcast({ t: "error", error, roomId })
  }

  private fail(error: NoticeError | null, cause: unknown): never {
    if (error) this.broadcast({ t: "error", error })
    throw cause
  }

  #apps?: Apps | null
  appsService(): Apps | null {
    if (this.#apps === undefined) {
      const build = builderFrom(this.env)
      if (!build) this.installMissingBuilder()
      this.#apps = build ? new Apps(this.sql, keyringFromEnv(this.env), this.ownerId, build, this.egress) : null
    }
    return this.#apps
  }

  private installMissingBuilder(): void {
    if (!this.env.CF_GRANT || getSetting(this.sql, BUILDER_REPAIR) === BACKEND.version) return
    this.ctx.waitUntil(
      this.selfUpdate.start(BACKEND.version).then((state) => {
        if (state.stage === "restarting") setSetting(this.sql, BUILDER_REPAIR, BACKEND.version)
      }),
    )
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

  #kernelWiring?: KernelWiring
  get #kr(): KernelWiring {
    this.#kernelWiring ??= new KernelWiring({
      fetch: this.egress,
      services: this.services,
      ctx: this.ctx,
      sql: this.sql,
      env: this.env,
      alarms: this.alarms,
      userId: () => this.ownerId,
      notify: (error) => this.broadcast({ t: "error", error }),
    })
    return this.#kernelWiring
  }

  #computerWiring?: ComputerWiring
  get #pc(): ComputerWiring {
    this.#computerWiring ??= new ComputerWiring({
      hub: this.computers,
      ctx: this.ctx,
      env: this.env,
      services: this.services,
      userId: () => this.ownerId,
      publicOrigin: () => this.publicOrigin(),
    })
    return this.#computerWiring
  }

  computerList(): ComputerSummary[] {
    return this.#pc.list()
  }

  async computerCall(
    agentId: string,
    roomId: string,
    pcId: string,
    op: Op,
    args: unknown,
    deadlineMs?: number,
  ): Promise<PcCallOutcome> {
    return this.#pc.call(agentId, roomId, pcId, op, args, deadlineMs)
  }

  async computerLink(
    agentId: string,
    roomId: string,
    pcId: string,
    mode: "watch" | "control",
    reason?: string,
  ): Promise<ComputerLinkResult> {
    return this.#pc.link(agentId, roomId, pcId, mode, reason)
  }

  computerHolder(pcId: string): "agent" | "human" {
    return this.#pc.holder(pcId)
  }

  async computerPair(input: {
    publicKey: string
    name: string
    hello: import("@kiko/computer/wire").Hello
    pairNonce: string
    replaces?: string
  }): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
    return this.#pc.pair(input)
  }

  computerReleased(out: PcReleased): void {
    this.#pc.released(out)
  }

  setComputerWakeup(at: number): Promise<void> {
    return this.alarms.setWakeup(COMPUTER_WAKEUP, at)
  }

  clearComputerWakeup(): Promise<void> {
    return this.alarms.clearWakeup(COMPUTER_WAKEUP)
  }

  devComputerAge(pcId: string, ms: number): boolean {
    return this.#pc.hub.ageHold(pcId, ms)
  }

  async browserLease(agentId: string): Promise<Lease> {
    return this.#kr.lease(agentId)
  }

  async browserTouch(agentId: string, tabs?: Record<string, string>): Promise<boolean> {
    return this.#kr.touch(agentId, tabs)
  }

  async browserTakeover(agentId: string, roomId: string): Promise<boolean> {
    return this.#kr.paused(agentId, roomId)
  }

  async browserLive(
    agentId: string,
    roomId: string,
    mode: "watch" | "control",
    reason?: string,
  ): Promise<LiveLinkResult> {
    return this.#kr.liveLink(agentId, roomId, mode, reason)
  }

  async browserHandBack(agentId: string): Promise<boolean> {
    return this.#kr.handBack(agentId)
  }

  async browserDead(agentId: string, sessionId: string): Promise<boolean> {
    return this.#kr.dead(agentId, sessionId)
  }

  async browserCheck(agentId?: string): Promise<BrowserCheck> {
    return this.#kr.check(agentId)
  }

  async devBrowser(op: DevBrowserOp): Promise<Record<string, unknown>> {
    return (await this.dev()).devBrowser(() => this.#kr, this.ownerId, op)
  }

  async openSocket(server: WebSocket, request: Request): Promise<void> {
    this.models.syncIfStale()
    this.refreshCustomModels()
    server.serializeAttachment({ ready: false, workerOrigin: new URL(request.url).origin } satisfies Attachment)
    const origin = request.headers.get("origin") ?? new URL(request.url).origin
    if (this.setting(PUBLIC_ORIGIN) !== origin) this.putSetting(PUBLIC_ORIGIN, origin)
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

  #homeReady = false
  #selfUpdate?: SelfUpdate
  get selfUpdate(): SelfUpdate {
    this.#selfUpdate ??= new SelfUpdate({
      env: this.env,
      sql: this.sql,
      userId: () => this.ownerId,
      waitUntil: (work) => this.ctx.waitUntil(work),
    })
    return this.#selfUpdate
  }

  async devUpdateConfig(config: Record<string, unknown>): Promise<void> {
    return (await this.dev()).devUpdateConfig(this.sql, config)
  }

  get kernel(): KernelWiring {
    return this.#kr
  }

  get pc(): ComputerWiring {
    return this.#pc
  }

  readonly subscribe = Effect.fn("User.subscribe")({ self: this }, function* (ws: WebSocket, afterSequence: number) {
    if (!this.#homeReady) {
      yield* Effect.promise(() => this.ensureHome())
      this.#homeReady = true
    }
    this.seen()
    const fileToken = yield* Effect.promise(() => signToken(this.env.SESSION_SECRET, this.ownerId, "files"))
    for (const kind of ROW_KINDS) this.project(kind)
    send(ws, { ...this.resume(afterSequence), ...BACKEND, fileToken })
    const browser = this.#kr.browserState()
    if (browser) send(ws, { t: "browserState", state: browser })
    this.#pc.onTabHello(ws)
    for (const [roomId, names] of this.#typing) send(ws, { t: "typing", roomId, names })
    const before = ws.deserializeAttachment() as Attachment | null
    ws.serializeAttachment({ ...before, ready: true } satisfies Attachment)
  })

  readonly chatCommand = Effect.fn("User.chatCommand")({ self: this }, function* (op: ChatOp) {
    const existing = this.existingFor(op)
    if (existing)
      return yield* new DuplicateChatError({
        roomId: op.roomId,
        existing,
        message: "A chat with these agents already exists.",
      })
    const owner = op.op === "delete" ? this.soleAgentOf(op.roomId) : undefined
    if (!owner) return void this.apply(op)
    yield* Effect.promise(() => this.deleteAgent(owner))
  })

  private soleAgentOf(roomId: RoomId): AgentSlug | undefined {
    const chat = this.directory.get(roomId)
    const only = chat && !chat.kiko && !chat.pair && chat.agents?.length === 1 ? chat.agents[0] : undefined
    return listAgents(this.sql).find((agent) => agent.id === only)?.slug
  }

  readonly chatOpened = Effect.fn("User.chatOpened")({ self: this }, function* (roomId: RoomId) {
    if (!this.directory.get(roomId))
      return yield* new NotFoundError({ resource: "room", message: "That chat does not exist." })
    if (this.setting(LAST_CHAT) !== roomId) this.putSetting(LAST_CHAT, roomId)
  })

  readonly chatSearch = Effect.fn("User.chatSearch")({ self: this }, function (query: string) {
    return Effect.sync(() => this.directory.search(query.slice(0, MAX_QUERY)))
  })

  readonly searchMessages = Effect.fn("User.searchMessages")(
    { self: this },
    function* (query: string, before?: number) {
      const q = query.slice(0, MAX_QUERY)
      if (!q.trim()) return { results: [], next: null, partial: false }
      const chats = [...this.directory.list()].sort((a, b) => b.updatedAt - a.updatedAt)
      const searched = chats.slice(0, MAX_SEARCH_ROOMS)
      const pages = yield* Effect.promise(() =>
        Promise.all(searched.map((chat) => this.searchRoom(chat.roomId, q, before))),
      )
      return { ...mergeHits(pages, SEARCH_LIMIT), partial: chats.length > searched.length }
    },
  )

  private async searchRoom(roomId: RoomId, query: string, before?: number) {
    try {
      const page = await this.services.room(roomId).search(query, { beforeAt: before, limit: SEARCH_LIMIT })
      return { results: page.results.map((hit) => ({ ...hit, roomId })), more: page.next !== null }
    } catch (error) {
      console.error(`search failed in a room: ${error instanceof Error ? error.message : String(error)}`)
      return { results: [], more: false }
    }
  }

  readonly newAgent = Effect.fn("User.newAgent")(
    { self: this },
    function* (input: {
      readonly id: string
      readonly roomId: RoomId
      readonly name: string
      readonly handle: string
      readonly description: string
    }) {
      const name = input.name.trim()
      const handle = input.handle.trim().toLowerCase()
      const description = input.description.trim()
      if (!AGENT_ID.test(input.id))
        return yield* new RefusedError({ reason: "agent", message: "need an id and a roomId" })
      if (!name || name.length > MAX_AGENT_NAME)
        return yield* new RefusedError({ reason: "agent", message: `the name is 1 to ${MAX_AGENT_NAME} characters` })
      if (!isAgentSlug(handle))
        return yield* new RefusedError({
          reason: "agent",
          message: `"${handle}" is not a usable handle: lowercase letters, digits, and dashes`,
        })
      if (!description || description.length > MAX_AGENT_DESCRIPTION)
        return yield* new RefusedError({
          reason: "agent",
          message: `the description is 1 to ${MAX_AGENT_DESCRIPTION} characters`,
        })
      const out = yield* Effect.promise(() =>
        this.createAgentChat({ id: input.id, roomId: input.roomId, name, handle, description }),
      )
      if (!out.ok) return yield* new RefusedError({ reason: "agent", message: out.error })
    },
  )

  readonly agentCommand = Effect.fn("User.agentCommand")({ self: this }, function* (op: AgentOp) {
    if (op.op === "delete") {
      const out = yield* Effect.promise(() => this.deleteAgent(op.slug))
      if (!out.ok) return yield* new RefusedError({ reason: "agent", message: out.error })
      return
    }
    if (this.handleDeleted(op.agent.slug)) return yield* new RefusedError({ reason: "agent", message: DELETED_HANDLE })
    this.saveAgent(op.agent)
  })

  readonly agentSetModel = Effect.fn("User.agentSetModel")(
    { self: this },
    function* (input: {
      readonly slug: AgentSlug
      readonly ref?: string
      readonly thinking?: ThinkingLevel
      readonly roomId?: RoomId
    }) {
      if (this.setAgentModel(input.slug, input.ref, input.thinking, input.roomId)) return
      return yield* new RefusedError({
        reason: "model",
        message: input.ref
          ? `The model did not change. Kiko does not know ${input.ref}. Pick another one.`
          : "The model did not change. Pick a model first.",
      })
    },
  )

  readonly soulGet = Effect.fn("User.soulGet")({ self: this }, function* (slug: AgentSlug) {
    const soul = yield* Effect.promise(() => this.soul(slug))
    return { id: slug, ...soul }
  })

  readonly soulUpdate = Effect.fn("User.soulUpdate")(
    { self: this },
    function* (slug: AgentSlug, body: string, expectSha: string) {
      const out = yield* Effect.promise(() => this.setSoul(slug, body, expectSha))
      if (out.ok) return { id: slug, ...out.soul }
      if (out.code === "conflict") return yield* new ConflictError({ message: "changed since you opened it" })
      return yield* new ProtocolError({ message: out.message })
    },
  )

  readonly memoryRun = Effect.fn("User.memoryRun")({ self: this }, function* (op: MemoryOp) {
    const result = yield* Effect.promise(() => this.#mem.call(op))
    if (result.ok && (op.op === "note" || op.op === "redact" || op.op === "pin")) this.changed("memory")
    return result
  })

  readonly themeSet = Effect.fn("User.themeSet")({ self: this }, function (theme: string | null) {
    return Effect.sync(() => {
      this.saveTheme(theme)
    })
  })

  readonly settingsGet = Effect.fn("User.settingsGet")({ self: this }, function () {
    return Effect.promise(() => this.userSettings())
  })

  readonly settingsUpdate = Effect.fn("User.settingsUpdate")({ self: this }, function* (patch: UserSettingsPatch) {
    if (patch.timezone !== undefined && !validZone(patch.timezone))
      return yield* new ProtocolError({ message: "timezone must be an IANA time zone, such as Europe/Berlin" })
    return yield* Effect.promise(() => this.setUserSettings(patch))
  })

  readonly storageUsage = Effect.fn("User.storageUsage")({ self: this }, function () {
    return Effect.sync(() => ({
      objectBytes: this.ctx.storage.sql.databaseSize,
      archiveEnabled: Boolean(this.env.ARCHIVE),
    }))
  })

  readonly catalog = Effect.fn("User.catalog")({ self: this }, function () {
    return Effect.sync(() => this.models.current())
  })

  readonly version = Effect.fn("User.version")({ self: this }, function () {
    return Effect.succeed({ ...BACKEND, storage: this.env.FILES ? ("r2" as const) : ("built-in" as const) })
  })

  readonly ownerFiles = Effect.fn("User.ownerFiles")({ self: this }, function () {
    return Effect.sync(() => listOwnerFiles(this.ctx.storage))
  })

  readonly fileToken = Effect.fn("User.fileToken")({ self: this }, function* () {
    return { fileToken: yield* Effect.promise(() => signToken(this.env.SESSION_SECRET, this.ownerId, "files")) }
  })

  readonly writeText = Effect.fn("User.writeText")(
    { self: this },
    function* (input: {
      readonly roomId: RoomId
      readonly path: string
      readonly type: string
      readonly text: string
      readonly expectSha: string
    }) {
      const path = cleanPath(input.path)
      if (!path) return yield* new ProtocolError({ message: "bad path" })
      if (!EXPECT_SHA.test(input.expectSha)) return yield* new ProtocolError({ message: EXPECT_ERROR })
      if (!this.directory.get(input.roomId))
        return yield* new NotFoundError({ resource: "room", message: "That chat does not exist." })
      const bytes = new TextEncoder().encode(input.text)
      if (bytes.byteLength > MAX_SINGLE_PUT_BYTES)
        return yield* new ProtocolError({ message: "too large for one request, use a multipart upload" })
      const id = crypto.randomUUID()
      const r2Key = fileKey(this.ownerId, input.roomId, id)
      const type = mime(input.type)
      const files = this.services.files()
      yield* Effect.promise(() =>
        files.put(r2Key, bytes, { httpMetadata: { contentType: type }, customMetadata: { path } }),
      )
      const sha256 = yield* Effect.promise(() => sha256Hex(bytes))
      const out = yield* Effect.promise(() =>
        this.services.room(input.roomId).putFile({
          id,
          path,
          r2Key,
          size: bytes.byteLength,
          type,
          sha256,
          author: { kind: "human" },
          expectSha256: input.expectSha,
        }),
      )
      if (out.drop) yield* Effect.promise(() => deleteFiles(files, out.drop ?? []))
      if (out.refused) return yield* new ProtocolError({ message: out.refused.message })
      if (out.conflict || !out.file) return yield* new FileConflictError({ theirs: out.file, message: "conflict" })
      return out.file
    },
  )

  readonly homeFiles = Effect.fn("User.homeFiles")({ self: this }, function* (op: FileOp) {
    const why = this.homeOp(op)
    if (why) return yield* new RefusedError({ reason: "home", message: why })
  })

  readonly credentialsList = Effect.fn("User.credentialsList")({ self: this }, function () {
    return Effect.promise(() => this.listProviders())
  })

  readonly credentialsConnect = Effect.fn("User.credentialsConnect")(
    { self: this },
    function* (provider: string, apiKey: string) {
      if (!isProviderId(provider)) return yield* new ProtocolError({ message: "bad provider id" })
      const key = yield* Effect.try({
        try: () => checkApiKey(apiKey),
        catch: (e) =>
          new RefusedError({ reason: "credentials", message: e instanceof Error ? e.message : "bad request" }),
      })
      const why = yield* Effect.promise(() => this.providerKeyRefused(provider, key))
      if (why !== null) return yield* new RefusedError({ reason: "credentials", message: keyRefusedText(why) })
      return yield* Effect.promise(() => this.connectProvider(provider, key))
    },
  )

  readonly credentialsAddCustom = Effect.fn("User.credentialsAddCustom")(
    { self: this },
    function* (name: string, api: CustomApi, baseUrl: string, apiKey: string) {
      const key = yield* Effect.try({
        try: () => checkApiKey(apiKey),
        catch: (e) =>
          new RefusedError({ reason: "credentials", message: e instanceof Error ? e.message : "bad request" }),
      })
      const added = yield* Effect.promise(() => addCustom(this.sql, { name, api, baseUrl, apiKey: key }, this.egress))
      if (!added.ok) return yield* new RefusedError({ reason: "credentials", message: added.message })
      const info = yield* Effect.promise(() => this.connectProvider(added.spec.id, key))
      this.changed("models")
      return info
    },
  )

  readonly credentialsDisconnect = Effect.fn("User.credentialsDisconnect")(
    { self: this },
    function* (provider: string) {
      if (!isProviderId(provider)) return yield* new ProtocolError({ message: "bad provider id" })
      yield* Effect.promise(() => this.disconnectProvider(provider))
    },
  )

  readonly credentialsCheck = Effect.fn("User.credentialsCheck")({ self: this }, function* (provider: string) {
    if (!isProviderId(provider)) return yield* new ProtocolError({ message: "bad provider id" })
    const info = yield* Effect.promise(() => this.checkProvider(provider))
    if (!info) return yield* new NotFoundError({ resource: "provider", message: "that provider is not connected" })
    return info
  })

  readonly loginStart = Effect.fn("User.loginStart")(
    { self: this },
    function (socket: WebSocket, loginId: string, provider: string) {
      return Effect.sync(() => {
        this.ctx.waitUntil(this.#loginState.start(socket, loginId, provider).catch(() => {}))
      })
    },
  )

  readonly loginAnswer = Effect.fn("User.loginAnswer")(
    { self: this },
    function (socket: WebSocket, loginId: string, promptId: string, value: string) {
      return Effect.sync(() => this.#loginState.answer(socket, loginId, promptId, value))
    },
  )

  readonly loginCancel = Effect.fn("User.loginCancel")({ self: this }, function (socket: WebSocket, loginId: string) {
    return Effect.sync(() => this.#loginState.cancel(socket, loginId))
  })

  readonly composioConnect = Effect.fn("User.composioConnect")({ self: this }, function* (apiKey: string) {
    const connected = yield* Effect.tryPromise({
      try: () => this.#composio.connect(apiKey),
      catch: composioIntegrationError,
    })
    return this.announceComposio({ ok: true, ...connected })
  })

  readonly composioDisconnect = Effect.fn("User.composioDisconnect")({ self: this }, function* () {
    yield* Effect.try({ try: () => this.#composio.disconnect(), catch: composioIntegrationError })
    return this.announceComposio({ ok: true, status: this.#composio.status() })
  })

  readonly composioStatus = Effect.fn("User.composioStatus")({ self: this }, function* (tools?: boolean) {
    const list = tools
      ? yield* Effect.tryPromise({ try: () => this.#composio.tools(), catch: composioIntegrationError })
      : null
    const result: ComposioResult = {
      ok: true,
      status: this.#composio.status(),
      ...(list ? { tools: list.map((t) => t.name), readOnly: list.flatMap((t) => (t.readOnly ? [t.name] : [])) } : {}),
    }
    return result
  })

  private announceComposio(result: ComposioResult): ComposioResult {
    this.broadcast({ t: "composio", result })
    return result
  }

  readonly recipesList = Effect.fn("User.recipesList")({ self: this }, function () {
    return Effect.promise(() => this.recipeList())
  })

  readonly recipesInstall = Effect.fn("User.recipesInstall")({ self: this }, function* (input: InstallRecipe) {
    const out = yield* Effect.promise(() => this.installRecipe(this.ownerId, input))
    if (out.ok) return { install: out.install }
    if ("needsConnect" in out) return out.needsConnect
    return yield* new RefusedError({ reason: "recipe", message: out.error })
  })

  readonly recipesUninstall = Effect.fn("User.recipesUninstall")({ self: this }, function* (installId: string) {
    yield* Effect.promise(() => this.uninstallRecipe(installId))
  })

  readonly recipesEdit = Effect.fn("User.recipesEdit")({ self: this }, function* (slug: string) {
    if (!SLUG.test(slug) || slug.length > MAX_RECIPE_SLUG)
      return yield* new ProtocolError({ message: "name must be lowercase words joined by dashes" })
    const path = yield* Effect.promise(() => this.editRecipe(slug))
    if (!path) return yield* new NotFoundError({ resource: "recipe", message: `no built-in recipe named ${slug}` })
    return { path }
  })

  readonly routineStatus = Effect.fn("User.routineStatus")(
    { self: this },
    function* (id: string, status: "active" | "paused") {
      yield* routineOutcome(yield* Effect.promise(() => this.updateRoutine(id, { status })))
    },
  )

  readonly routineCancel = Effect.fn("User.routineCancel")({ self: this }, function* (id: string) {
    yield* routineOutcome(yield* Effect.promise(() => this.cancelRoutine(id)))
  })

  async webSocketError(ws: WebSocket): Promise<void> {
    this.#logins?.dropOwner(ws)
    void this.#pc.close(ws)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.#logins?.dropOwner(ws)
    await this.#pc.close(ws)
    const now = Date.now()
    if (
      (ws.deserializeAttachment() as Attachment | null)?.ready &&
      now - Number(this.setting(LAST_SEEN) ?? 0) >= 3_600_000
    )
      this.putSetting(LAST_SEEN, String(now))
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {}
  }

  async alarm(): Promise<void> {
    const due = await this.alarms.dueWakeups(Date.now())
    await runDue(this.alarms, due, {
      deletion_agents: () => this.cleanDeletedAgents(),
      deletion: () => this.cleanDeletedChats(),
      [REAP_WAKEUP]: () => this.#kr.reap(),
      [COMPUTER_WAKEUP]: () => this.#pc.hub.reap(),
    })
  }

  async devPass(): Promise<unknown> {
    return (await this.dev()).devPass(() => this.#initiative)
  }

  private apply(op: ChatOp): UserEvent | null {
    if (movesKikoChat(this.sql, op) || this.existingFor(op)) return null
    const event = this.commit(this.directory.apply(op, Date.now()))
    if (event && op.op === "delete") {
      this.sql.exec("DELETE FROM capture_queue WHERE room_id = ?", op.roomId)
      this.life.redactRefs(this.life.refsLike(`room:${op.roomId}:`))
      this.changed("memory")
      this.sql.exec("INSERT OR IGNORE INTO deletion_rooms (room_id) VALUES (?)", op.roomId)
      this.ctx.waitUntil(this.alarms.setWakeup("deletion", Date.now()))
    }
    if (event && op.op === "private") {
      const room = this.services.room(op.roomId)
      this.ctx.waitUntil(
        Promise.resolve(room.setPrivate(op.private)).catch((e: unknown) =>
          console.error(`private flag not sent: ${e instanceof Error ? e.message : String(e)}`),
        ),
      )
    }
    return event
  }

  private existingFor(op: ChatOp): RoomId | null {
    if (op.op !== "create") return null
    return (
      sameAgentChat(
        this.directory.list().map((c) => markKikoChat(this.sql, c)),
        op.agents ?? [],
        op.roomId,
      )?.roomId ?? null
    )
  }

  private lastChat(): RoomId | undefined {
    const stored = this.setting(LAST_CHAT)
    const chat = stored ? this.directory.get(stored) : null
    return chat?.roomId ?? kikoChatRoom(this.sql) ?? undefined
  }

  private async ensureHome(): Promise<void> {
    this.ctx.waitUntil(
      this.#recipes
        .retireSeeded()
        .catch((e: unknown) => console.error(`recipe cleanup failed: ${e instanceof Error ? e.message : String(e)}`)),
    )
    for (const op of kikoChatOps(this.sql, this.directory.list())) this.apply(op)
    const home = kikoChatRoom(this.sql)
    if (home) this.commit(this.directory.agents(home, [KIKO], (agents) => this.groupTitle(agents)))
    const old = this.setting(OLD_CHECK_IN)
    if (old !== null) {
      await this.reminders.cancel(old)
      deleteSetting(this.sql, OLD_CHECK_IN)
      deleteSetting(this.sql, OLD_CHECK_IN_SEEN)
    }
  }

  private handleDeleted(slug: string): boolean {
    return this.sql.exec("SELECT 1 FROM deleted_agent_handles WHERE slug = ?", slug).toArray().length > 0
  }

  private saveAgent(agent: Agent): Agent | null {
    if (this.handleDeleted(agent.slug)) {
      this.broadcast({ t: "error", error: new StorageError({ message: DELETED_HANDLE }) })
      return null
    }
    const stored = createAgent(this.sql, agent, Date.now())
    if (!stored) return null
    this.commit({ t: "agent", agent: stored })
    const model = stored.model || agentModel(this.sql, KIKO)?.model
    if (model) this.setAgentModel(stored.slug, model, undefined, undefined, true)
    return stored
  }

  setAgentModel(
    slug: AgentSlug,
    ref?: string,
    thinking?: ThinkingLevel,
    roomId?: RoomId,
    announce = false,
  ): AgentModel | null {
    const before = agentModel(this.sql, slug)
    const saved = saveAgentModel(this.sql, slug, ref, thinking)
    if (!saved) return null
    if (!announce && JSON.stringify(saved) === JSON.stringify(before)) return saved
    this.commit({ t: "agent_model", slug, ...saved })
    if (roomId && saved.model !== before?.model) {
      this.ctx.waitUntil(
        Promise.resolve(this.services.room(roomId).modelChanged(slug, saved.model, before?.model)).catch(() => {}),
      )
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

  private commit(
    change:
      | ChatChange
      | { t: "agent"; agent: Agent }
      | { t: "agent_removed"; id: string; slug: AgentSlug }
      | ({ t: "agent_model"; slug: AgentSlug } & AgentModel)
      | { t: "theme"; theme: string | null }
      | FileBody
      | RowChange
      | null,
  ): UserEvent | null {
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

  private resume(afterSequence: number): Extract<UserToClient, { t: "events" | "reset" }> {
    const seq = this.currentSeq()
    if (afterSequence > 0 && afterSequence <= seq && seq - afterSequence < REPLAY_LIMIT) {
      const events = this.sql
        .exec<{ body: string }>("SELECT body FROM user_events WHERE seq > ? ORDER BY seq", afterSequence)
        .toArray()
        .map((r) => JSON.parse(r.body) as UserEvent)
      const at = Date.now()
      const chats = this.directory
        .list()
        .filter((chat) => !chat.pair)
        .map((chat): UserEvent => ({ t: "chat", chat: markKikoChat(this.sql, chat), seq, at, projection: true }))
      return { t: "events", events: [...events, ...chats] }
    }
    const lastChat = this.lastChat()
    return {
      t: "reset",
      snapshot: {
        seq,
        chats: this.directory.list().map((c) => markKikoChat(this.sql, c)),
        agents: listAgents(this.sql),
        agentModels: allAgentModels(this.sql),
        theme: getTheme(this.sql),
        home: { files: this.home.all(), folders: this.home.folders() },
        rows: rowLists(this.sql),
        ...(lastChat ? { lastChat } : {}),
      },
    }
  }

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
    if (patch.timezone) this.putSetting("timezone", patch.timezone)
    if (patch.initiative) this.putSetting("initiative", patch.initiative)
    if (patch.capture) this.#mem.setCapture(patch.capture)
    if (patch.onboarded) this.putSetting("onboarded", "1")
    return this.userSettings()
  }
}
