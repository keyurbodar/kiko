import { fileStore } from "../files/store"
import { KIKO, newRoomId, pairRoomId, sameAgentChat, type ThinkingLevel } from "@kiko/protocol"
import { HomeWiring } from "./home-wiring"
import { RoutineWiring } from "./routines-wiring"
import type { Actor, Agent, AgentModel, AgentSlug, Chat, ChatOp, FileOp, ClientToUser as UserFrame, ComposioResult, InstallRecipe, KikoError, RecipeList, RoomId, UserChange, UserEvent, UserToClient } from "@kiko/protocol"
import { RecipeLibrary } from "./recipe-library"
import { matchRecipes, type RecipeHint } from "../recipes/match"
import { capitalized, soulFromDescription } from "../room/chief"
import { makeAgentChat } from "../room/new-agent"
import { RecipeService } from "./recipe-service"
import { recipeCard } from "../recipes/card"
import { ClientToUser, type LoopAction, type LoopRow, type UserSettings, type UserSettingsPatch } from "@kiko/protocol/schema"
import { DurableObject } from "cloudflare:workers"
import { instrument, loadUserDev } from "../lib/dev-guard"
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
import { basenameOf, decodeBase64, encodeBase64, FILE_CAP } from "../integrations/kernel/files"
import { KernelError } from "../integrations/kernel/client"
import type { FetchRequest, FetchResult, Lease } from "../agent/browser/lease"
import { type Alarms, createAlarms, runDue } from "@kiko/durable/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "@kiko/durable/hello-deadline"
import { kikoChatOps, kikoChatRoom, markKikoChat, movesKikoChat } from "./kiko-chat"
import { keyringFromEnv } from "@kiko/durable/crypto"
import { checkApiKey, CredentialVault, type ProviderInfo, userIdFromObjectName } from "./credentials"
import { keyRefused } from "./credentials-check"
import { userModels } from "../agent/factory"
import { agentNamed, createAgent, listAgents } from "./agents"
import { agentModel, allAgentModels, saveAgentModel } from "./agent-models"
import { firstSoul, type Soul, Souls, type SoulWrite } from "./souls"
import { type CommitResult, type FileBody, FileIndex, type IndexChange, type FsChange, type FsEntry, type FsFail, HOME_TABLES, type NewFile, type PutResult } from "../files/file-index"
import { actorKey } from "../room/log"
import { applyChatOp, type ChatChange, getChat, listChats, renameLegacyAgent, searchChats, type Touch, touchChat } from "./chats"
import { Life } from "@kiko/memory/life"
import { itemLine, spanOf } from "@kiko/memory/optmem"
import type { NoteAnswer } from "@kiko/memory/tools"
import { ProviderLogins } from "./provider-login"
import { type NewRoutine, REMINDERS_WAKEUP, Reminders, type RoutineRun, type RunDelivery } from "./reminders"
import { deleteSetting, getSetting, setSetting } from "../lib/settings"
import { type ChatTasks, overview } from "./overview"
import { routineRun, type SignalBatch } from "../room/signals"
import { roomRoutine, type RoutineResult } from "./routines"
import { migrate } from "@kiko/durable/migrate"
import { USER_STEPS } from "./schema"
import { DEFAULT_TIMEZONE, resolveTurnContext, type TurnContext } from "./turn-context"
import { getTheme, setTheme } from "./theme"
import { composioUserId, roomStub } from "../lib/names"
import type { Loop, LoopKind, OpenResult } from "@kiko/memory/loops"
import { INITIATIVE_RUN, INITIATIVE_WAKEUP, REMINDER_RUN } from "../initiative/engine"
import { REAP_WAKEUP } from "../integrations/kernel/lease"
import type { DevBrowserOp } from "./dev"
import { InitiativeLoops, LOOPS_WAKEUP } from "./initiative-loops"
import { type BrowserCheck, KernelWiring, type LiveLinkResult } from "./kernel-wiring"
import { CAPTURE_WAKEUP, LIFE_WAKEUP, MemoryCapture } from "./memory-capture"
import { type Attachment, send, trySend } from "./sockets"
import { AWAY_MS, LAST_SEEN } from "./keys"
import { UpdateWiring } from "./update-wiring"
import { ANNOUNCE_WAKEUP, Announcements, COMPOSIO_CHANGE, KERNEL_CHANGE, providerChange, updateChange } from "./announce"

const REPLAY_LIMIT = 500

const decodeFrame = Schema.decodeUnknownSync(ClientToUser)

const AWAY_NOTICE = "away_notice"
const PUBLIC_ORIGIN = "public_origin"
const OLD_CHECK_IN = "check_in"
const OLD_CHECK_IN_SEEN = "check_in_seen"

const LAST_CHAT = "last_chat"


type NewAgentOutcome = { ok: true; agent: Agent; roomId: RoomId } | { ok: false; error: string }

export class UserDO extends DurableObject<Env> {
  private readonly sql: SqlStorage
  private alarms!: Alarms
  private life!: Life
  private souls!: Souls
  private home!: FileIndex<UserEvent>
  private holding: UserEvent[] | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    instrument(ctx, "user")
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
    this.sql = ctx.storage.sql
    void ctx.blockConcurrencyWhile(async () => {
      migrate(ctx.storage, USER_STEPS)
      this.alarms = createAlarms(ctx)
      this.life = new Life(this.sql, (fn) => ctx.storage.transactionSync(fn), { get: (key) => this.setting(key), set: (key, value) => this.putSetting(key, value) })
      this.souls = new Souls(this.sql)
      this.home = new FileIndex<UserEvent>(ctx.storage, HOME_TABLES, (_, body) => {
        const event = this.commit(body)
        if (!event) throw new Error("file change produced no event")
        return event
      }, actorKey)
      this.reminders = new Reminders(this.sql, this.alarms, Date.now, {
        deliverRun: async ({ deliveryId, routine, body }) => {
          return roomStub(env.ROOM, userIdFromObjectName(ctx.id.name), routine.roomId).deliverRoutine(deliveryId, { target: routine.target, body })
        },
        notice: (roomId, id, text) => roomStub(env.ROOM, userIdFromObjectName(ctx.id.name), roomId).systemNotice(id, text, "routine"),
        gate: {
          away: () => {
            const last = this.setting(LAST_SEEN)
            const away = last !== null && Date.now() - Number(last) > AWAY_MS
            if (away) this.ctx.waitUntil(this.awayNotice(Date.now()).catch(() => {}))
            return away
          },
        },
      }, () => this.changed("routines"))
    })
  }

  private reminders!: Reminders
  async listRoutines() { return this.reminders.list() }
  async cancelRoutine(id: string): Promise<RoutineResult> {
    const out = await this.#routines.cancelRoutine(id)
    if (out.ok || this.reminders.get(id)?.status === "cancelled") this.#recipes.routineGone(id)
    return out
  }
  async createRoutine(owner: string, input: NewRoutine): Promise<RoutineResult> { return this.#routines.createRoutine(owner, input) }
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
    const owner = userIdFromObjectName(this.ctx.id.name)
    const out = await makeAgentChat(
      {
        agents: async () => listAgents(this.sql),
        make: (spec) => this.makeAgent({ id: spec.id, name: spec.name, slug: spec.handle, description: spec.description, soul: spec.soul, model: "" }),
        openChat: (title, agentIds, roomId) => this.openChat(title, agentIds, roomId),
        recipes: (description) => this.recipeHints(description),
        introduce: (roomId, agent, text) => roomStub(this.env.ROOM, owner, roomId).introduce(owner, agent.slug, text),
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
    const owner = () => userIdFromObjectName(this.ctx.id.name)
    const library = new RecipeLibrary({
      sql: this.sql,
      files: fileStore(this.env),
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
        return roomId ? roomStub(this.env.ROOM, owner(), roomId).modelOf("kiko").catch(() => "") : ""
      },
      composio: {
        connected: async () => (this.#composio.status().connected ? await this.#composio.connectedToolkits(Date.now(), true).catch(() => null) : "off"),
        link: async (app) => {
          const manage = (await this.#composio.tools().catch(() => null))?.find((t) => t.name === MANAGE_CONNECTIONS)
          const out = manage && (await connectLinkFor(manage, (name, args) => this.#composio.call(name, args), app))
          return out && out.kind === "link" ? out.link : null
        },
      },
      announce: (roomId, input) => roomStub(this.env.ROOM, owner(), roomId).addRecipe(owner(), { ...input, agent: input.agent as AgentSlug }),
    })
    return this.#recipeService
  }

  async overview(): Promise<string> {
    const tz = this.setting("timezone") ?? DEFAULT_TIMEZONE
    return overview(this.sql, { reminders: this.reminders.list(), runs: this.reminders.runs(), tz, now: Date.now() })
  }

  async chatTasks(roomId: string, tasks: ChatTasks): Promise<void> {
    if (!tasks.open) this.sql.exec("DELETE FROM chat_tasks WHERE room_id = ?", roomId)
    else this.sql.exec("INSERT INTO chat_tasks (room_id, tasks) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET tasks = excluded.tasks", roomId, JSON.stringify(tasks))
    await this.#il.engine.arm()
  }

  // The dev-only bodies live in user/dev.ts, which only a development build can load. One cached load
  // per object reaches every dev method below.
  private devCache?: Promise<typeof import("./dev")>

  private dev(): Promise<typeof import("./dev")> {
    this.devCache ??= loadUserDev()
    return this.devCache
  }

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
    this.#il.engine.results(batch)
    for (const s of batch.signals) if (s.kind === "routine_result" && s.routineId !== INITIATIVE_RUN && s.routineId !== REMINDER_RUN) await this.reminders.finishRun(s.routineId, s.occurrence, s.outcome, s.seq)
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
    const chat = getChat(this.sql, this.existingFor(op) ?? roomId)
    if (!chat) throw new Error(`chat ${roomId} is missing right after create`)
    return chat
  }

  async renameChat(roomId: RoomId, title: string): Promise<Chat | null> {
    this.apply({ op: "rename", roomId, title })
    return getChat(this.sql, roomId)
  }

  async pinChat(roomId: RoomId, pinned: boolean): Promise<Chat | null> {
    this.apply({ op: "pin", roomId, pinned })
    return getChat(this.sql, roomId)
  }

  async deleteChat(roomId: RoomId): Promise<boolean> {
    return this.apply({ op: "delete", roomId }) !== null
  }

  async touchChat(roomId: RoomId, touch: Touch): Promise<boolean> {
    return this.commit(touchChat(this.sql, roomId, touch, Date.now())) !== null
  }

  /** Who is typing in each chat, for a socket that connects mid-run. Memory only: a clear always arrives as a frame. */
  readonly #typing = new Map<RoomId, readonly string[]>()

  async chatTyping(roomId: RoomId, names: readonly string[]): Promise<void> {
    if (!getChat(this.sql, roomId)) return
    if (names.length) this.#typing.set(roomId, names)
    else this.#typing.delete(roomId)
    this.broadcast({ t: "typing", roomId, names })
  }

  private changed(what: UserChange): void {
    this.broadcast({ t: "changed", what })
  }

  async searchChats(query: string): Promise<Chat[]> {
    return searchChats(this.sql, query)
  }

  async listChats(): Promise<Chat[]> {
    return listChats(this.sql)
  }

  async getChat(roomId: RoomId): Promise<Chat | null> {
    const chat = getChat(this.sql, roomId)
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
    if (!getChat(this.sql, roomId)) this.commit(applyChatOp(this.sql, { op: "create", roomId, title: [a, b].sort().map((s) => `@${s}`).join(" and "), agents: ids as string[] }, Date.now(), true))
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
      await this.#mem.armNaps()
      this.changed("memory")
    }
    return { ok: true, pos: out.pos, ...(out.duplicate ? { duplicate: true as const } : {}), ...(replaces === undefined ? {} : { replaced }) }
  }

  async lifeRecall(query: string): Promise<string[]> {
    return this.life
      .recall(query, 10, { skipCard: true })
      .map((l) => itemLine({ pos: l.pos, at: l.at, text: `${l.source ? `${l.source}: ` : ""}${l.text}` }, 400, true, "life"))
  }

  async captureHuman(roomId: RoomId, items: { messageId: string; text: string; at: number }[]): Promise<void> {
    await this.#il.hear(roomId, items)
    await this.#mem.captureHuman(roomId, items)
  }

  async forgetMessages(roomId: RoomId, messageIds: string[], requeue: { messageId: string; text: string; at: number }[], turns: number[]): Promise<void> {
    const ids = [...new Set([...messageIds, ...requeue.map((r) => r.messageId)])]
    const gone = this.life.redactRefs(ids.map((id) => `room:${roomId}:msg:${id}`))
    this.#il.loops.redactRefs(ids.map((id) => `room:${roomId}:msg:${id}`))
    this.sql.exec("DELETE FROM capture_queue WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))", roomId, JSON.stringify(ids))
    const prefix = `room:${roomId}:turns:`
    const spans = this.life.refsLike(prefix).filter((ref) => {
      const m = /^(\d+)-(\d+)$/.exec(ref.slice(prefix.length))
      return m !== null && turns.some((pos) => Number(m[1]) <= pos && pos < Number(m[2]))
    })
    if (gone.length + this.life.redactRefs(spans).length) {
      await this.#mem.armNaps()
      this.changed("memory")
    }
    for (const pos of turns) this.#il.loops.forgetTurn(roomId, pos)
    this.changed("loops")
    await this.captureHuman(roomId, requeue)
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

  async providerKeyRefused(provider: string, apiKey: string): Promise<boolean> {
    const key = checkApiKey(apiKey)
    const { models, settings } = userModels(async () => ({ auth: { apiKey: key } }), `check-${this.ctx.id.toString()}`)
    return keyRefused(models, provider, settings.stream?.headers)
  }

  async connectProvider(provider: string, apiKey: string): Promise<ProviderInfo> {
    const before = allAgentModels(this.sql)
    const info = await this.#credentials.connect(provider, apiKey)
    this.announceModels(before)
    await this.#mem.keyChanged(provider)
    await this.#announce.note(providerChange(provider, apiKey)).catch(() => {})
    return this.#mem.describe(info)
  }

  async disconnectProvider(provider: string): Promise<boolean> {
    const before = allAgentModels(this.sql)
    const removed = await this.#credentials.disconnect(provider)
    this.announceModels(before)
    await this.#mem.keyChanged(provider)
    await this.#announce.note(providerChange(provider, null)).catch(() => {})
    return removed
  }

  /** An agent nobody picked a model for follows the connected providers, so a key change can move it. */
  private announceModels(before: Record<string, AgentModel>): void {
    for (const [slug, now] of Object.entries(allAgentModels(this.sql))) {
      if (JSON.stringify(now) !== JSON.stringify(before[slug])) this.commit({ t: "agent_model", slug: slug as AgentSlug, ...now })
    }
  }

  async listProviders(): Promise<ProviderInfo[]> {
    return this.#credentials.listProviders().map((p) => this.#mem.describe(p))
  }

  private seen(): void {
    const now = Date.now()
    const last = Number(this.setting(LAST_SEEN) ?? 0)
    const wasAway = last > 0 && now - last > AWAY_MS
    if (now - last < 3_600_000) return
    this.putSetting(LAST_SEEN, String(now))
    if (wasAway) deleteSetting(this.sql, AWAY_NOTICE)
  }

  private async awayNotice(now: number): Promise<void> {
    if (this.setting(AWAY_NOTICE) !== null) return
    this.putSetting(AWAY_NOTICE, String(now))
    const roomId = kikoChatRoom(this.sql)
    const owner = userIdFromObjectName(this.ctx.id.name)
    if (roomId) await roomStub(this.env.ROOM, owner, roomId).systemNotice(`away:${now}`, "i paused your routines and follow-ups while you were away. they start again when you open kiko.", "limit")
  }

  /** What an agent runs on, for every chat. */
  async agentModel(slug: string): Promise<AgentModel> {
    return agentModel(this.sql, slug)
  }

  /** The room frame's setter: one model for the named agent, or for each of the room's agents. */
  async setAgentModels(slugs: readonly AgentSlug[], ref: string, roomId: RoomId): Promise<void> {
    for (const slug of slugs) this.setAgentModel(slug, ref, undefined, roomId)
  }

  /** One round trip for a run: the agent's model and level, then the credentials for that model's provider. */
  async agentTurn(slug: string): Promise<TurnContext & { model: string; thinking: ThinkingLevel }> {
    const picked = agentModel(this.sql, slug)
    return { ...(await this.turnContext(picked.model.slice(0, picked.model.indexOf("/")), slug)), model: picked.model, thinking: picked.thinking }
  }

  async turnContext(provider: string, slug?: string): Promise<TurnContext> {
    const setting = (key: string) =>
      getSetting(this.sql, key)
    const agent = slug ? { soul: await this.souls.get(slug) } : undefined
    return resolveTurnContext(this.#credentials, provider, { timezone: setting("timezone"), captures: this.#mem.captures() }, agent)
  }

  async lifeView(): Promise<string> {
    return this.life.view(Date.now())
  }

  #vault?: CredentialVault
  get #credentials(): CredentialVault {
    this.#vault ??= new CredentialVault(this.sql, keyringFromEnv(this.env), userIdFromObjectName(this.ctx.id.name))
    return this.#vault
  }

  #homeWiringCache?: HomeWiring
  get #homeWiring(): HomeWiring {
    this.#homeWiringCache ??= new HomeWiring({ ctx: this.ctx, env: this.env, home: this.home, holding: { set: (held) => { this.holding = held } }, broadcast: (frame) => this.broadcast(frame) })
    return this.#homeWiringCache
  }

  #routinesWiring?: RoutineWiring
  get #routines(): RoutineWiring {
    this.#routinesWiring ??= new RoutineWiring({ env: this.env, reminders: this.reminders })
    return this.#routinesWiring
  }

  #memory?: MemoryCapture
  get #mem(): MemoryCapture {
    this.#memory ??= new MemoryCapture({
      sql: this.sql,
      life: this.life,
      alarms: this.alarms,
      label: this.ctx.id.toString(),
      credentials: () => this.#credentials,
      turn: (provider) => this.turnContext(provider),
    })
    return this.#memory
  }

  #loopsModule?: InitiativeLoops
  get #il(): InitiativeLoops {
    this.#loopsModule ??= new InitiativeLoops({
      sql: this.sql,
      transaction: (fn) => this.ctx.storage.transactionSync(fn),
      alarms: this.alarms,
      life: this.life,
      memory: this.#mem,
      room: this.env.ROOM,
      userId: userIdFromObjectName(this.ctx.id.name),
    })
    return this.#loopsModule
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

  async composioCall(name: string, args: Record<string, unknown>): Promise<ComposioCallResult> {
    try {
      return await this.#composio.call(name, args)
    } catch (e) {
      return this.fail(composioFailure(e), e)
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
      new ComposioStore(this.sql, keyringFromEnv(this.env), userIdFromObjectName(this.ctx.id.name)),
      () => composioUserId(userIdFromObjectName(this.ctx.id.name)),
      undefined,
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
      await this.#announce.note({ ...COMPOSIO_CHANGE, secret: frame.t === "connectComposio" ? frame.apiKey : null }).catch(() => {})
      const { tools: _, ...others } = result
      const text = JSON.stringify({ t: "composio", result: others } satisfies UserToClient)
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() as Attachment | null)?.ready) trySend(other, text)
      }
    }
  }

  #kernelWiring?: KernelWiring
  get #kr(): KernelWiring {
    this.#kernelWiring ??= new KernelWiring({ ctx: this.ctx, sql: this.sql, env: this.env, alarms: this.alarms, userId: () => userIdFromObjectName(this.ctx.id.name), notify: (error) => this.broadcast({ t: "error", error }) })
    return this.#kernelWiring
  }

  /** The user's browser for `agentId`, headless unless the human asked to watch. Creates it when there is none. */
  async browserLease(agentId: string): Promise<Lease> {
    return this.#kr.lease(agentId)
  }

  /** Stamps last use. `tabs` (tab id to last URL) replaces the agent's tabs. False when the browser it knew is gone. */
  async browserTouch(agentId: string, tabs?: Record<string, string>): Promise<boolean> {
    return this.#kr.touch(agentId, tabs)
  }

  /** Whether the human is driving the browser. A tool returns "The human is using the browser" and waits while it is true. */
  async browserTakeover(): Promise<boolean> {
    return this.#kr.takeover()
  }

  /** The live view link for the human, with a reason it is also posted to the room (section 27.7). */
  async browserLive(agentId: string, roomId: string, mode: "watch" | "control", reason?: string): Promise<LiveLinkResult> {
    return this.#kr.liveLink(agentId, roomId, mode, reason)
  }

  /** The agent's socket died: the next lease makes a new browser. */
  async browserDead(agentId: string, sessionId: string): Promise<boolean> {
    return this.#kr.dead(agentId, sessionId)
  }

  /** HTTP through the browser's stack. The body is capped at 20000 chars and `truncated` says so; only http and https. */
  async browserFetch(req: FetchRequest): Promise<FetchResult> {
    return this.#kr.fetch(req)
  }

  /** Writes an upload into the browser's VM. `name` is sanitized to a basename; the file is capped at 10 MB. */
  async browserPutFile(name: string, base64: string): Promise<{ path: string }> {
    return this.#kr.putFile(basenameOf(name), decodeBase64(base64))
  }

  /** Reads a file from the browser's VM. The path must be under /tmp or the downloads folder; the file is capped at 10 MB. */
  async browserGetFile(path: string): Promise<{ name: string; base64: string; size: number }> {
    const bytes = await this.#kr.getFile(path)
    if (bytes.byteLength > FILE_CAP) throw new KernelError("failed", "file is over 10 MB")
    return { name: basenameOf(path), base64: encodeBase64(bytes), size: bytes.byteLength }
  }

  /** Names of the files in a folder on the browser's VM. The folder must be under /tmp or the downloads folder. */
  async browserListFiles(dir: string): Promise<string[]> {
    return this.#kr.listFiles(dir)
  }

  /** The agent closed its tabs. */
  async browserRelease(agentId: string): Promise<void> {
    this.#kr.release(agentId)
  }

  /** Read before each browser call. Holds no URL. */
  async browserCheck(agentId?: string): Promise<BrowserCheck> {
    return this.#kr.check(agentId)
  }

  async devBrowser(op: DevBrowserOp): Promise<Record<string, unknown>> {
    return (await this.dev()).devBrowser(() => this.#kr, userIdFromObjectName(this.ctx.id.name), op)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 })
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ ready: false, helloBy: helloBy() } satisfies Attachment)
    const origin = request.headers.get("origin") ?? new URL(request.url).origin
    if (this.setting(PUBLIC_ORIGIN) !== origin) this.putSetting(PUBLIC_ORIGIN, origin)
    await enforceHello(this.ctx, this.alarms)
    return new Response(null, { status: 101, webSocket: client })
  }

  #logins?: ProviderLogins<WebSocket>
  get #loginState(): ProviderLogins<WebSocket> {
    this.#logins ??= new ProviderLogins<WebSocket>({
      store: this.#credentials,
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

  #announcements?: Announcements
  get #announce(): Announcements {
    this.#announcements ??= new Announcements({
      sql: this.sql,
      alarms: this.alarms,
      now: Date.now,
      send: async (id, body) => {
        const roomId = kikoChatRoom(this.sql)
        if (roomId) {
          const owner = userIdFromObjectName(this.ctx.id.name)
          await roomStub(this.env.ROOM, owner, roomId).announce(owner, id, body)
        }
      },
    })
    return this.#announcements
  }

  #updateWiring?: UpdateWiring
  get #update(): UpdateWiring {
    this.#updateWiring ??= new UpdateWiring({
      env: this.env,
      sql: this.sql,
      userId: () => userIdFromObjectName(this.ctx.id.name),
      broadcast: (frame) => this.broadcast(frame),
      landed: (version) => this.#announce.note(updateChange(version)),
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
      // The reply says which build answered, so the client can tell it is out of date (versions in docs/app-kiko.md).
      const fileToken = await signToken(this.env.SESSION_SECRET, userIdFromObjectName(this.ctx.id.name), "files")
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
      const result = await this.#kr.kernelFrame(ws, frame)
      if (result.ok && frame.t !== "kernelStatus") await this.#announce.note({ ...KERNEL_CHANGE, secret: frame.t === "connectKernel" ? frame.apiKey : null }).catch(() => {})
      return
    }
    if (frame.t === "memory") {
      send(ws, { t: "memory_result", reqId: frame.reqId, result: await this.#mem.call(frame.op) })
      return
    }
    if (frame.t === "theme") {
      this.saveTheme(frame.theme)
      return
    }
    if (frame.t === "search") {
      send(ws, { t: "search", query: frame.query, chats: searchChats(this.sql, frame.query.slice(0, 200)) })
      return
    }
    if (frame.t === "agent") {
      this.saveAgent(frame.op.agent)
      return
    }
    if (frame.t === "agent_model") {
      this.setAgentModel(frame.slug, frame.ref, frame.thinking, frame.roomId)
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
    if (frame.t === "login.start") return void this.#loginState.start(ws, frame.loginId, frame.provider).catch(() => {})
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
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {
    }
  }

  async alarm(): Promise<void> {
    const due = await this.alarms.dueWakeups(Date.now())
    await runDue(this.alarms, due, {
      [HELLO_WAKEUP]: () => enforceHello(this.ctx, this.alarms),
      [REMINDERS_WAKEUP]: () => this.reminders.fire(),
      [LIFE_WAKEUP]: () => this.#mem.napLife().finally(() => this.memoryAndLoopsChanged()),
      [CAPTURE_WAKEUP]: () => this.#mem.captureNow().finally(() => this.memoryAndLoopsChanged()),
      [LOOPS_WAKEUP]: () => this.#il.now().finally(() => this.changed("loops")),
      [INITIATIVE_WAKEUP]: () => this.#il.engine.pass().finally(() => this.changed("loops")),
      [REAP_WAKEUP]: () => this.#kr.reap(),
      [ANNOUNCE_WAKEUP]: () => this.#announce.flush(),
    })
  }

  private memoryAndLoopsChanged(): void {
    this.changed("memory")
    this.changed("loops")
  }

  /** A reminder an agent set for itself opens its commitment (section 26.2); a dev route opens a loop for the fake-agent suite. */
  async loopOpen(owner: string, roomId: RoomId, ref: string, input: { kind: LoopKind; text: string; due: string | null; reminderId?: string }): Promise<OpenResult> {
    const out = await this.#il.open(owner, roomId, ref, input)
    if (out.ok) this.changed("loops")
    return out
  }

  /** `roomId`: an agent's close, which reaches only the loops of its own chat. */
  async loopClose(id: number, status: "done" | "dropped", roomId?: RoomId): Promise<boolean> {
    const closed = this.#il.close(id, status, roomId)
    if (closed) this.changed("loops")
    return closed
  }

  async loopList(filter: { status?: Loop["status"][]; owner?: string; room?: string; limit?: number } = {}): Promise<Loop[]> {
    return this.#il.loops.list(filter)
  }

  async initiativeBrief(roomId: RoomId, slug: string, burst: { text: string }): Promise<{ owe: string[]; related: string[]; noticed: string[]; noticedIds: number[] }> {
    return this.#il.initiative.brief(roomId, slug, burst)
  }

  /** The "on their plate" lines a run was given, so the next burst does not repeat them. */
  async devPass(): Promise<unknown> {
    return (await this.dev()).devPass(() => this.#il.engine)
  }

  async briefShown(loopIds: number[]): Promise<void> {
    this.#il.engine.briefed(loopIds)
  }

  /** An agent's answer, for the Jev pass to catch a promise to come back (section 26.2). */
  async loopsAnswer(roomId: RoomId, slug: string, items: { messageId: string; text: string; at: number }[]): Promise<void> {
    await this.#il.hear(roomId, items, slug)
  }

  private apply(op: ChatOp): UserEvent | null {
    if (movesKikoChat(this.sql, op) || this.existingFor(op)) return null
    const event = this.commit(applyChatOp(this.sql, op, Date.now()))
    // A private or deleted chat keeps no loops (section 26.1).
    if (event && ((op.op === "private" && op.private) || op.op === "delete")) this.#il.loops.forgetRoom(op.roomId)
    // A deleted chat keeps no reminders or routines.
    if (event && op.op === "delete") {
      this.ctx.waitUntil(this.reminders.cancelRoom(op.roomId).catch((e: unknown) => console.error(`routines not cancelled: ${e instanceof Error ? e.message : String(e)}`)))
      this.ctx.waitUntil(this.#recipes.chatGone(op.roomId).catch((e: unknown) => console.error(`recipes not cleared: ${e instanceof Error ? e.message : String(e)}`)))
    }
    if (event && op.op === "private") {
      const room = roomStub(this.env.ROOM, userIdFromObjectName(this.ctx.id.name), op.roomId)
      this.ctx.waitUntil(Promise.resolve(room.setPrivate(op.private)).catch((e: unknown) => console.error(`private flag not sent: ${e instanceof Error ? e.message : String(e)}`)))
    }
    return event
  }

  /** A create that would make a second chat with the same agents names the chat that is already there. */
  private existingFor(op: ChatOp): RoomId | null {
    if (op.op !== "create") return null
    return sameAgentChat(listChats(this.sql).map((c) => markKikoChat(this.sql, c)), op.agents ?? [], op.roomId)?.roomId ?? null
  }

  private lastChat(): RoomId | undefined {
    const stored = this.setting(LAST_CHAT)
    const chat = stored ? getChat(this.sql, stored) : null
    return chat?.roomId ?? kikoChatRoom(this.sql) ?? undefined
  }

  async ensureHome(): Promise<void> {
    renameLegacyAgent(this.sql)
    this.ctx.waitUntil(this.#recipes.retireSeeded().catch((e: unknown) => console.error(`recipe cleanup failed: ${e instanceof Error ? e.message : String(e)}`)))
    for (const op of kikoChatOps(this.sql, listChats(this.sql))) this.apply(op)
    const old = this.setting(OLD_CHECK_IN)
    if (old !== null) {
      await this.reminders.cancel(old)
      deleteSetting(this.sql, OLD_CHECK_IN)
      deleteSetting(this.sql, OLD_CHECK_IN_SEEN)
    }
  }

  private saveAgent(agent: Agent): Agent | null {
    const stored = createAgent(this.sql, agent, Date.now())
    if (!stored) return null
    this.commit({ t: "agent", agent: stored })
    // A new agent starts on the model it was made with, or on Kiko's.
    // Always announce it: the pick can equal the fallback, and the client still needs an entry for the new agent.
    this.setAgentModel(stored.slug, stored.model || agentModel(this.sql, KIKO).model, undefined, undefined, true)
    return stored
  }

  /** The one setter for an agent's model and level. Every chat, Settings, and the next run read what it saves. */
  setAgentModel(slug: AgentSlug, ref?: string, thinking?: ThinkingLevel, roomId?: RoomId, announce = false): AgentModel | null {
    const before = agentModel(this.sql, slug)
    const saved = saveAgentModel(this.sql, slug, ref, thinking)
    if (!saved) return null
    if (!announce && JSON.stringify(saved) === JSON.stringify(before)) return saved
    this.commit({ t: "agent_model", slug, ...saved })
    if (roomId && saved.model !== before.model) this.ctx.waitUntil(Promise.resolve(roomStub(this.env.ROOM, userIdFromObjectName(this.ctx.id.name), roomId).modelChanged(slug, saved.model)).catch(() => {}))
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

  private commit(change: ChatChange | { t: "agent"; agent: Agent } | ({ t: "agent_model"; slug: AgentSlug } & AgentModel) | { t: "theme"; theme: string | null } | FileBody | null): UserEvent | null {
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
    const text = JSON.stringify(frame)
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.ready) trySend(ws, text)
    }
  }

  private resume(lastSeq: number): UserToClient {
    const seq = this.currentSeq()
    const { oldest } = this.sql.exec<{ oldest: number | null }>("SELECT min(seq) AS oldest FROM user_events").one()
    const replayable = lastSeq > 0 && lastSeq <= seq && (oldest === null || lastSeq >= oldest - 1)
    if (!replayable) {
      const lastChat = this.lastChat()
      return {
        t: "reset",
        snapshot: { seq, chats: listChats(this.sql).map((c) => markKikoChat(this.sql, c)), agents: listAgents(this.sql), agentModels: allAgentModels(this.sql), theme: getTheme(this.sql), home: { files: this.home.all(), folders: this.home.folders() }, ...(lastChat ? { lastChat } : {}) },
      }
    }
    const events = this.sql
      .exec<{ body: string }>("SELECT body FROM user_events WHERE seq > ? ORDER BY seq", lastSeq)
      .toArray()
      .map((r) => JSON.parse(r.body) as UserEvent)
    return { t: "events", events }
  }

  // The human's own surfaces for initiative (architecture section 26): the loops list and two settings.

  async loopsFor(roomId: string | null): Promise<LoopRow[]> {
    return this.#il.humanLoops(roomId)
  }

  async loopAct(id: number, action: LoopAction): Promise<boolean> {
    const done = await this.#il.act(id, action)
    if (done) this.changed("loops")
    return done
  }

  async userSettings(): Promise<UserSettings> {
    const timezone = this.setting("timezone")
    return {
      initiative: this.#il.level(),
      capture: this.#mem.policy().capture,
      ...(timezone ? { timezone } : {}),
      ...(this.setting("onboarded") ? { onboarded: true } : {}),
    }
  }

  async setUserSettings(patch: UserSettingsPatch): Promise<UserSettings> {
    // The route checked the zone. The daily pass is at nine in it, so the pass is set again.
    if (patch.timezone) {
      this.putSetting("timezone", patch.timezone)
      await this.#il.engine.arm()
    }
    if (patch.initiative) {
      this.putSetting("initiative", patch.initiative)
      await this.#il.engine.arm()
    }
    if (patch.capture) this.#mem.setCapture(patch.capture)
    if (patch.onboarded) this.putSetting("onboarded", "1")
    return this.userSettings()
  }
}
