import { HistoryArchive } from "../owner/history-archive"
import { RoomHistoryStore } from "../owner/history-store"
import { historyR2 } from "../owner/history-r2"
import { eraseRoomSchema } from "../owner/schema"
import { fileStore } from "../files/store"
import { humanAnswerText, MAX_MESSAGE_TEXT, sendFits, isAgentSlug, linkAttachments, oneLine, tagline } from "@kiko/protocol"
import type { Activity, HumanAnswers, HumanQuestion, AgentSlug, AgentState, Chat, ClientToRoom, Envelope, FileOp, MemberOp, MemberRefusal, MessageId, RoomEvent, RoomId, RoomToClient, RunErrorKind, RunStep, SystemReason, TaskOp, WorkerRow } from "@kiko/protocol"
import type { OwnerServices, ServiceOptions } from "../owner/services"
import { loadRoomDev } from "../lib/dev-guard"
import type { Env } from "../index"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import { runDue } from "../owner/clock"
import { enforceHello, HELLO_WAKEUP, helloBy } from "@kiko/durable/hello-deadline"
import { RoomRoutines } from "./routines"
import type { Wake, WakeResult } from "./delivery"

import type { RoomRoutine } from "../user/routines"
import { sha256Hex } from "@kiko/durable/hash"
import { BURST_WAKEUP, Burst } from "./burst"
import { buildBrief, readBriefView } from "./brief"
import { RoomMemory } from "./memory"
import { Asks } from "./asks"
import { Bubbles, replyTag } from "./bubbles"
import type { StepItem } from "../agent/extensions/presence"
import { roomActivity, HUMAN_HANDLE, MEMBER_ACTIVITY, type MemberActivity } from "./activity"
import { Deliveries, withContext } from "./deliver"
import { type AgentSend, MessageChains } from "./messaging"
import { isRoomId } from "@kiko/protocol"
import { cleanPath, deleteFiles, fileKey } from "../files/upload"
import { changePaths, type CommitResult, type FileIndex, type IndexChange } from "../files/file-index"
import { CHAT_PATH } from "../files/room-fs"
import { Team } from "./team"
import { CHIEF, type GroupInput, type NewAgentSpec } from "./chief"
import { type FsChange, type FsEntry, type FsFail, type NewFile, type PutResult, roomFiles } from "./files"
import { isPrivate, RoomLog } from "./log"
import type { HeardStep } from "./steps"
import { cleanOptions, HumanAsks, MAX_QUESTION } from "./human-asks"
import { activityOf } from "./status"
import { dividerMessage, type Divider } from "./dividers"
import { findProvider } from "../models/catalog"
import { describeRunError } from "../agent/run-error"
import { problemOfRun } from "../user/provider-health"
import { parseModelRef } from "../agent/thinking"
import { parseRichText } from "./rich-text"
import { type MemberRow, Members, type NewMember } from "./members"
import { agentReact, reactionBrief } from "./reactions"
import { attachmentPath, claim, ClaimRefused, type NewPending, PENDING_TTL_MS, PENDING_WAKEUP, PendingUploads } from "./pending"
import { bubbleOf, discardWhole, putWhole, WHOLE_NAME, WHOLE_TYPE, type WholeText } from "./whole-text"
import { tags } from "./recipients"
import { searchMessages, type SearchOptions } from "./search"
import { STORAGE_ERROR } from "../lib/storage-error"
import { handleFrame, send, type SocketRoom } from "./socket"
import type { RoomDev } from "./dev"
import { MemoryNaps } from "./memory-naps"
import { applyTaskOp, RoomWorkspace, runCall, type WorkspaceAnswer, type WorkspaceCall } from "./workspace"
import { Reports } from "./reports"
import { Groups, type GroupResult } from "./groups"
import type { ReceiveDeps } from "./receive"
import type { AgentHome, Home } from "./home"
import { RoomDelivery } from "./delivery"
import { RoomMessaging } from "./messaging"
import { route } from "./deliver"
import { replyAddressees } from "./recipients"
import { deliverable, envelopeId } from "./burst"
import { receive } from "./receive"
import { type PairIn, RoomPair } from "./pair"

const MAX_DOING = 160
const DELEGATED_TITLE = 100
const edit = (caption: string): Activity => ({ kind: "tool", tool: "edit", caption })

/** A model reference as the human reads it, such as "Claude Opus 4.6", else the reference itself. */
const modelNamed = (ref: string): string => {
	const found = parseModelRef(ref)
	return (
		(found &&
			findProvider(found.provider)
				?.getModels()
				.find((m) => m.id === found.modelId)?.name) ||
		ref
	)
}

export const DEFAULT_AGENT = CHIEF
const CHIEF_NAME = "Kiko"
const KIKO_CHAT = "kiko_chat"
export type { AgentHome }

const ROW_EVENTS: ReadonlySet<RoomEvent["t"]> = new Set(["message", "edit", "delete", "react", "read", "member", "member_removed"])

type SendOutcome = { ack: { id: MessageId; seq: number }; events: RoomEvent[] } | { refused: string }

export class Room implements SocketRoom {
	log!: RoomLog
	private deliveries!: Deliveries
	private alarms!: Alarms
	private burst!: Burst
	private bubbles!: Bubbles
	private mail!: MessageChains
	private memory!: RoomMemory
	private memoryNaps!: MemoryNaps
	private groups!: Groups
	private asks!: Asks
	private humanAsks!: HumanAsks
	members!: Members
	files!: FileIndex<RoomEvent>
	team!: Team
	workspace!: RoomWorkspace
	private routines!: RoomRoutines
	private reports!: Reports
	private wakes!: RoomDelivery
	private mailer!: RoomMessaging
	private pairs!: RoomPair
	private receiver!: ReceiveDeps
	private pending!: PendingUploads
	private archive?: HistoryArchive
	private typingChain: Promise<void> = Promise.resolve()
	private typingSent: string | null = null
	private sends: Promise<unknown> = Promise.resolve()

	private readonly ctx: DurableObjectState
	private readonly env: Env
	private readonly services: OwnerServices
	private readonly publishFrame: (frame: unknown) => void
	private readonly ownerStorage: DurableObjectStorage
  private readonly identity: { ownerId: string; roomId: string }
  private erasing = false
	private readonly sql: SqlStorage
	constructor(options: ServiceOptions) {
		const { ctx, env, services, sql, broadcast } = options
		if (!options.identity.roomId) throw new Error("Room identity required")
      this.identity = { ownerId: options.identity.ownerId, roomId: options.identity.roomId }
      this.ownerStorage = ctx.storage
		this.ctx = ctx
		this.env = env
		this.services = services
		this.sql = sql
		this.publishFrame = broadcast

		{
			const roomId = this.identity.roomId
			this.log = new RoomLog(ctx.storage, roomId, Date.now, ctx.storage)
			this.deliveries = new Deliveries(ctx.storage, this.log)
			this.files = roomFiles(ctx.storage, this.log)
			this.team = new Team(ctx.storage.sql, roomId)
			this.alarms = options.clock
			this.burst = new Burst(ctx.storage, roomId, this.alarms)
			this.bubbles = new Bubbles(ctx.storage, this.log, (path) => {
				const entry = this.files.stat(path)
				return entry?.kind === "file" && entry.type.startsWith("image/") ? entry.id : null
			})
			this.asks = new Asks(ctx.storage.sql, roomId)
			this.humanAsks = new HumanAsks(ctx.storage.sql, roomId)
			this.mail = new MessageChains(
				ctx.storage,
				this.log,
				this.asks,
				(slug) => (this.members.get(slug)?.status ?? "idle") !== "idle",
				Date.now,
				(mail) => {
					const home = this.home()
					return home?this.mailer.deliver(home,mail):Promise.resolve()
				},
			)
			this.receiver = {
				services: this.services,
				log: this.log,
				mail: this.mail,
				deliveries: this.deliveries,
				publish: (events) => this.publish(events),
				agentHome: (home, slug, member) => this.agentHome(home, slug, member),
				delivery: (member, members, goal, raw) => this.delivery(member, members, goal, raw),
			}
			this.members = new Members(ctx.storage, this.log)
			this.workspace = new RoomWorkspace(ctx.storage, this.log)
			this.routines = new RoomRoutines(ctx.storage.sql, roomId, { get: (key) => this.log.meta(key), set: (key, value) => this.log.setMeta(key, value) })
			this.memory = new RoomMemory(ctx.storage, roomId, { get: (key) => this.log.meta(key), set: (key, value) => this.log.setMeta(key, value) }, (query, options) => searchMessages(this.ownerStorage.sql, this.log.roomId, query, options))
			this.memoryNaps = new MemoryNaps({ services: this.services, log: this.log, members: this.members, memory: this.memory, home: () => this.home() })
			this.groups = new Groups({ ctx, env: this.env, services: this.services, log: this.log, members: this.members, home: () => this.home(), publish: (events) => this.publish(events) })
			this.pending = new PendingUploads(ctx.storage.sql, roomId)
			this.reports = new Reports({ ctx, services: this.services, alarms: this.alarms, log: this.log, members: this.members, mail: this.mail, routines: this.routines, home: () => this.home() })
			this.wakes = new RoomDelivery({ services: this.services, log: this.log, members: this.members, routines: this.routines, workspace: this.workspace, burst: this.burst, home: () => this.home(), chat: (home) => this.chat(home), seedMembers: (home, chat) => this.seedMembers(home, chat), receiver: this.receiver })

			this.mailer = new RoomMessaging({
				...this.receiver,
				ctx,
				members: this.members,
				burst: this.burst,
				asks: this.asks,
				team: this.team,
				alarms: this.alarms,
				home: () => this.home(),
				title: (home) => this.title(home),
				pair: (from, to) => this.pairWith(from, to),
			})
			this.pairs = new RoomPair({
				...this.receiver,
				ctx,
				members: this.members,
				asks: this.asks,
				adopt: (userId) => this.adopt(userId),
				chat: (home) => this.chat(home),
				seedMembers: (home, chat) => this.seedMembers(home, chat),
			})
		}
	}

	private async flushBurst(): Promise<void> {
		const home = this.home()
		if (!home) return
		const pending = this.burst.envelopes(home.roomId)
		const batch = deliverable(pending)
		if (!batch.length) return
		const chat = await this.chat(home)
		if (!chat) {
			this.burst.clear()
			return
		}
		await this.seedMembers(home, chat)
		const members = this.members.list()
		const routes = route(batch, members, (id) => replyAddressees((at) => this.log.message(at), id))
		for (const [slug, envelopes] of routes) {
			const member = members.find((m) => m.slug === slug)
			if (member) await receive(this.receiver, home, member, members, chat.title, envelopes)
		}
		this.burst.delivered(batch.map((p) => p.envelope))
		if (this.log.meta("private") !== "1")
			await this.services.user().captureHuman(
				home.roomId,
				batch.flatMap(({ envelope: e }) => {
					const message = this.log.message(e.rootId)
					return message ? [{ messageId: e.rootId, text: e.body, at: message.at }] : []
				}),
			)
		if (this.burst.pending()) await this.burst.arm("")
	}
	private async redeliver(slug: AgentSlug, ids: readonly string[], errorId: string): Promise<void> {
		const home = this.home()
		if (!home) return
		const members = this.members.list()
		const member = members.find((m) => m.slug === slug)
		const chat = await this.chat(home)
		if (!member || !chat) return
		const envelopes = ids.flatMap((id): Envelope[] => {
			const m = this.log.message(id)
			return m ? [{ id: `${envelopeId(id)}#${errorId}`, roomId: home.roomId, from: { kind: "human" }, body: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}), hop: 0, rootId: id, seq: m.seq }] : []
		})
		if (envelopes.length) await receive(this.receiver, home, member, members, chat.title, envelopes)
	}
	saveChat(chat: Chat): void {
		const { lastSeq: _seq, lastPreview: _preview, unread: _unread, last: _last, mentions: _mentions, group: _group, ...settings } = chat
		this.log.setMeta("chat_settings", JSON.stringify(settings))
		this.log.setMeta("title", chat.title)
		this.setPrivate(chat.private ?? false)
	}
	chatView(): Chat | null {
		const value = this.log.meta("chat_settings")
		if (!value) return null
		const settings = JSON.parse(value) as Omit<Chat, "lastSeq" | "lastPreview" | "unread">
		const activity = this.activity()
		const { group, ...rest } = activity
		return { ...settings, ...rest, ...(group ? { group: true as const } : {}), updatedAt: Math.max(settings.updatedAt, activity.last?.at ?? 0) }
	}
	activity() {
		return roomActivity(this.sql, this.log)
	}
	openTasks() {
		const rows = this.sql.exec<{ id: string; title: string; status: string; owner: string | null; updated_at: number }>("SELECT id, title, status, owner, updated_at FROM ws_tasks WHERE NOT status IN ('done', 'cancelled') AND ws_tasks.room_id = ?1 ORDER BY updated_at", this.log.roomId).toArray()
		return { open: rows.length, oldest: rows.slice(0, 3).map((t) => ({ id: t.id, title: t.title, status: t.status, ...(t.owner ? { owner: t.owner } : {}), updatedAt: t.updated_at })) }
	}

	private home(): Home | null {
		const userId = this.log.meta("user_id")
		const roomId = this.log.meta("room_id")
		return userId && roomId ? { userId, roomId: roomId as RoomId } : null
	}

	private async chat(home: Home): Promise<Chat | null> {
		const chat = await this.services.user().getChat(home.roomId)
		if (chat) this.remember(chat)
		return chat
	}

	private remember(chat: Chat): void {
		this.setPrivate(chat.private ?? false)
		this.setKiko(chat.kiko === true)
		if (this.log.meta("title") !== chat.title) this.log.setMeta("title", chat.title)
	}

	private async title(home: Home): Promise<string> {
		return this.log.meta("title") ?? (await this.chat(home))?.title ?? ""
	}

	/** The Kiko chat is always Kiko alone. A member that got in before this rule is removed once, so its agent stops. */
	private setKiko(value: boolean): void {
		const stored = value ? "1" : "0"
		if (this.log.meta(KIKO_CHAT) !== stored) this.log.setMeta(KIKO_CHAT, stored)
		if (!value) return
		for (const m of this.members.list()) if (m.slug !== CHIEF) this.memberOp({ op: "remove", slug: m.slug })
	}

	setPrivate(value: boolean): void {
		if ((this.log.meta("private") === "1") !== value) this.log.setMeta("private", value ? "1" : "0")
	}

	private agentHome(home: Home, slug: AgentSlug, member: { role?: string; lead: boolean }): AgentHome {
		return { ...home, slug, role: member.role, lead: member.lead, private: this.log.meta("private") === "1" }
	}

	private async seedMembers(home: Home, chat: Chat): Promise<void> {
		if (chat.pair) return this.seedPair(home, chat)
		if (this.members.seeded()) return this.trySeedChatFile(chat.title)
		let agents: NewMember[] = []
		if (chat.agents?.length) {
			const mine = await this.services.user().listAgents()
			agents = chat.agents.flatMap((id): NewMember[] => {
				if (id === DEFAULT_AGENT) return [{ slug: DEFAULT_AGENT, name: CHIEF_NAME }]
				const a = mine.find((x) => x.id === id)
				const role = tagline(a?.prompt ?? "")
				return a ? [{ slug: a.slug, name: a.name, ...(role ? { role } : {}), model: a.model }] : []
			})
		}
		if (!agents.length) agents = [{ slug: DEFAULT_AGENT, name: CHIEF_NAME }]
		else if (agents.length > 1) agents = [{ slug: DEFAULT_AGENT, name: CHIEF_NAME }, ...agents.filter((a) => a.slug !== DEFAULT_AGENT)]
		this.publish(this.members.seed(agents))
		if (agents.length > 1) this.divider("group-formed", "Group formed", { kind: "group_formed", private: true })
		await this.trySeedChatFile(chat.title)
	}

	/** A pair room holds exactly its two agents. Kiko is there only when it is one of them, and the room has no group notice and no chat file. */
	private async seedPair(home: Home, chat: Chat): Promise<void> {
		if (this.members.seeded()) return
		const mine = await this.services.user().listAgents()
		const agents = (chat.agents ?? []).flatMap((id): NewMember[] => {
			if (id === DEFAULT_AGENT) return [{ slug: DEFAULT_AGENT, name: CHIEF_NAME }]
			const a = mine.find((x) => x.id === id)
			const role = tagline(a?.prompt ?? "")
			return a ? [{ slug: a.slug, name: a.name, ...(role ? { role } : {}), model: a.model }] : []
		})
		this.publish(this.members.seed(agents))
		this.log.setMeta("chat_file", "1")
	}

	private async pairWith(from: AgentSlug, to: AgentSlug): Promise<{ ok: true; roomId: RoomId } | { ok: false; error: string }> {
		const home = this.home()
		return home ? this.services.user().openPair(from, to) : { ok: false, error: "not sent: this chat is not set up yet." }
	}

	pairIn(userId: string, input: PairIn): Promise<"ok" | "full" | "refused"> {
		return this.pairs.receive(userId, input)
	}

	pairBack(input: { askId: string; from: AgentSlug; text: string; rootId: string; hop: number }): Promise<void> {
		return this.mailer.pairBack(input)
	}

	async writeChatFile(author: AgentSlug, text: string): Promise<boolean> {
		const home = this.home()
		if (!home) return false
		const body = new TextEncoder().encode(text)
		const id = crypto.randomUUID()
		const r2Key = fileKey(home.userId, home.roomId, id)
		const sha256 = await sha256Hex(body)
		await this.services.files().put(r2Key, body, { httpMetadata: { contentType: "text/markdown" } })
		const { drop, file, events } = this.files.put({ id, path: CHAT_PATH, r2Key, size: body.length, type: "text/markdown", sha256, author: { kind: "agent", slug: author }, expectSha256: "none" })
		if (events.length) this.publish(events)
		if (drop) await deleteFiles(this.services.files(), drop)
		return file !== null
	}

	/** Says a recipe was added, and wakes its agent to set it up unless the agent added it itself. Safe to run twice. */
	async addRecipe(userId: string, input: { installId: string; agent: AgentSlug; title: string; wake: string | null }): Promise<WakeResult> {
		if (!this.adopt(userId)) return "refused"
		const out = input.wake === null ? "delivered" : await this.wakes.wake({ id: `recipe:${input.installId}`, to: input.agent, why: "created", body: input.wake, chain: null })
		if (out === "delivered") await this.systemNotice(`recipe-added:${input.installId}`, `${input.title} added`, "created")
		return out
	}

	async modelOf(slug: string): Promise<string> {
		const home = this.home()
		const member = this.members.list().find((m) => m.slug === slug)
		if (!home || !member) return ""
		return (await this.services.user().agentModel(member.slug))?.model ?? ""
	}

	async createAgent(slug: AgentSlug, spec: NewAgentSpec): Promise<GroupResult> {
		return this.groups.createAgent(slug, spec)
	}

	async deleteGroup(slug: AgentSlug, roomId: string) {
		const home = this.home()
		if (!home || slug !== CHIEF || !this.members.get(slug)) return { ok: false as const, error: "only kiko can delete groups" }
		if (!isRoomId(roomId)) return { ok: false as const, error: "invalid room id" }
		const user = this.services.user()
		const chat = await user.getChat(roomId)
		if (!chat) return { ok: true as const, text: "group already deleted" }
		if (chat.kiko || chat.pair || (chat.agents?.length ?? 0) < 2) return { ok: false as const, error: "only group chats can be deleted with this tool" }
		await user.deleteChat(roomId)
		return { ok: true as const, text: "group deleted" }
	}

	async deleteOwnedAgent(slug: AgentSlug, handle: string) {
		const home = this.home()
		if (!home || slug !== CHIEF || !this.members.get(slug)) return { ok: false as const, error: "only kiko can delete agents" }
		return this.services.user().deleteAgent(handle)
	}

	async removeGroupMember(slug: AgentSlug, handle: string, roomId?: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
		if (!this.members.get(slug)) return { ok: false as const, error: "you are not a member of this chat" }
		const home = this.home()
		if (roomId && roomId !== home?.roomId) {
			if (!home || slug !== CHIEF) return { ok: false as const, error: "only kiko can manage another group" }
			if (!isRoomId(roomId)) return { ok: false as const, error: "invalid room id" }
			const chat = await this.services.user().getChat(roomId)
			if (!chat || chat.kiko || chat.pair) return { ok: false as const, error: "no such group" }
			return this.services.room(roomId).removeGroupMember(CHIEF, handle)
		}
		const target = handle.trim().toLowerCase().replace(/^@/, "")
		if (!isAgentSlug(target)) return { ok: false as const, error: "invalid handle" }
		if (this.log.meta(KIKO_CHAT) === "1" || this.members.list().length < 2) return { ok: false as const, error: "members can only be removed from groups" }
		if (!this.members.get(target)) return { ok: true as const, text: "member already removed" }
		const reason = this.memberOp({ op: "remove", slug: target })
		return reason ? { ok: false as const, error: reason } : { ok: true as const, text: `@${target} removed` }
	}

	async createGroup(slug: AgentSlug, input: GroupInput): Promise<GroupResult> {
		return this.groups.createGroup(slug, input)
	}

	async introduce(userId: string, slug: AgentSlug, text: string): Promise<void> {
		const home = this.adopt(userId)
		if (!home) return
		const chat = await this.chat(home)
		if (!chat) return
		await this.seedMembers(home, chat)
		const member = this.members.list().find((m) => m.slug === slug)
		if (!member) return
		const envelope: Envelope = { id: "intro", roomId: home.roomId, from: { kind: "system", reason: "created" }, body: text, hop: 0, rootId: "intro", seq: this.log.lastSeq() }
		const d = this.delivery(member, this.members.list(), chat.title, [envelope])
		await this.services.agent(home.roomId, slug).receive(d.envelopes, d.brief, this.agentHome(home, slug, member))
	}

	/** Opens a new group: its /chat.md when `chat` is set, then the creator's kickoff to every other member, as the creator's first message. */
	async startGroup(userId: string, input: { chat: string | null; creator: AgentSlug; kickoff: string }): Promise<void> {
		const home = this.adopt(userId)
		if (!home) return
		const chat = await this.chat(home)
		if (!chat) return
		if (input.chat !== null && this.log.meta("chat_file") === null) {
			await this.writeChatFile(CHIEF, input.chat)
			this.log.setMeta("chat_file", "1")
		}
		await this.seedMembers(home, chat)
		const id = `kickoff:${(await sha256Hex(`${input.creator}\n${input.kickoff}`)).slice(0, 16)}`
		await this.mailer.send(input.creator, { id, to: "all", text: input.kickoff })
	}

	private adopt(userId: string): Home | null {
		if (this.log.meta("user_id") === null) {
			const roomId = this.identity.roomId
      if (userId !== this.identity.ownerId) return null
			this.log.setMeta("user_id", userId)
			this.log.setMeta("room_id", roomId)
		}
		return this.home()
	}

	private async trySeedChatFile(title: string): Promise<void> {
		await this.seedChatFile(title).catch((e: unknown) => console.error(`chat.md seed failed: ${e instanceof Error ? e.message : String(e)}`))
	}

	private async seedChatFile(title: string): Promise<void> {
		if (this.log.meta("chat_file") !== null) return
		const members = this.members.list()
		if (members.length < 2) return
		if (this.files.stat(CHAT_PATH)) return this.log.setMeta("chat_file", "1")
		const team = members.map((m) => `- @${m.slug}: ${[m.lead ? "leads" : "", m.role ?? ""].filter(Boolean).join(". ")}`.trimEnd()).join("\n")
		const lead = members.find((m) => m.lead) ?? members[0]
		if (!lead) return
		await this.writeChatFile(lead.slug, `# ${title || "this chat"}\n\ngoal:\n\n## who does what\n${team}\n\n## decisions\n`)
		this.log.setMeta("chat_file", "1")
	}

	async alarm(): Promise<void> {
		if (this.log.meta("deleted") === "1" || this.log.meta("erasing") === "1") return
		const due = await this.alarms.dueWakeups(Date.now())
		await runDue(this.alarms, due, {
			[HELLO_WAKEUP]: () => enforceHello(this.ctx, this.alarms),
			[BURST_WAKEUP]: () => this.flushBurst(),
			["routine_events"]: () => this.reports.flush(),
			[PENDING_WAKEUP]: () => this.sweepPending(),
		})
	}

	restoreChain(slug: AgentSlug, envelopes: readonly Pick<Envelope, "rootId" | "hop">[]): void {
		this.mail.restore(slug, envelopes)
	}

	private delivery(member: MemberRow, members: readonly MemberRow[], goal: string, raw: Envelope[]) {
		const envelopes = raw.map((e) => withContext(this.log, e))
		const reactions = reactionBrief(this.log, this.sql, member.slug)
		const now = Date.now()
		const team = Object.fromEntries(members.map((m) => [m.slug, { doing: this.team.now(m.slug), holds: this.team.held(m.slug, now) }]))
		const human = this.log.meta(HUMAN_HANDLE) ?? undefined
		const view = { ...readBriefView(this.sql, member, members, goal, reactions.text, this.log.roomId), team, ...(human ? { human } : {}) }
		return { member, envelopes, brief: buildBrief(member, view), reactionsUpTo: reactions.upTo }
	}

	async agentMessage(slug: AgentSlug, send: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }> {
		return this.mailer.send(slug, send)
	}

	async askHuman(slug: AgentSlug, input: { id: string; question?: string; options?: readonly string[]; questions?: readonly HumanQuestion[] }): Promise<{ ok: true } | { ok: false; error: string }> {
		if (!this.members.get(slug)) return { ok: false, error: "you are not a member of this room" }
		const questions = input.questions
		if (
			questions &&
			(!questions.length ||
				questions.length > 8 ||
				new Set(questions.map((q) => q.id)).size !== questions.length ||
				questions.some(
					(q) =>
						!q.id.trim() ||
						!q.header.trim() ||
						q.header.length > 120 ||
						!q.question.trim() ||
						q.question.length > MAX_QUESTION ||
						q.options.length > 8 ||
						(!q.options.length && q.allowCustomAnswer === false) ||
						new Set(q.options.map((o) => o.value ?? o.label)).size !== q.options.length ||
						q.options.some((o) => !o.label.trim() || o.label.length > 120 || (o.description?.length ?? 0) > MAX_QUESTION),
				))
		)
			return { ok: false, error: "provide 1 to 8 questions with unique ids, short headers, and distinct options" }
		const text = questions ? questions.map((q) => q.question).join("\n\n") : (input.question ?? "").trim().slice(0, MAX_QUESTION)
		if (!text || text.length > MAX_MESSAGE_TEXT) return { ok: false, error: "the questions must fit in one message" }
		const options = cleanOptions(input.options)
		const events = this.ctx.storage.transactionSync((): RoomEvent[] => {
			if (this.humanAsks.get(input.id)) return []
			const posted = this.log.addMessage({ from: { kind: "agent", slug }, text, rich: parseRichText(text), clientId: `ask:${input.id}` })
			const ask = { id: input.id, from: slug, text, ...(options.length ? { options } : {}), ...(questions ? { questions } : {}), messageId: posted.id }
			this.humanAsks.create(ask, Date.now())
			return [...(posted.event ? [posted.event] : []), this.log.append(`agent:${slug}`, { t: "ask", ...ask })]
		})
		this.publish(events)
		return { ok: true }
	}

	async humanAskState(id: string): Promise<{ state: "open" | "answered" | "skipped"; answer: string | null } | null> {
		const ask = this.humanAsks.get(id)
		return ask ? { state: ask.state, answer: ask.answer } : null
	}

	async answerAsk(id: string, value: string | HumanAnswers): Promise<void> {
		const ask = this.humanAsks.get(id)
		if (!ask || ask.state !== "open") return
		const text = humanAnswerText(ask, value)
		if (!text || text.length > MAX_MESSAGE_TEXT || !sendFits(text)) return
		const event = this.resolveAsk(id, "answered", text)
		if (!event) return
		this.publish([event])
		const home = this.home()
		const heard = home
			? await this.services
					.agent(home.roomId, ask.from)
					.askAnswered(id, text)
					.catch(() => false)
			: false
		if (heard) {
			const { event: message } = this.log.addMessage({ from: { kind: "human" }, text, replyTo: ask.messageId, clientId: `answer:${id}` })
			if (message) this.publish([message], { deliver: false })
			return
		}
		const out = await this.humanSend({ t: "send", clientId: `answer:${id}`, text, replyTo: ask.messageId })
		if ("events" in out) this.publish(out.events)
	}

	async skipAsk(id: string): Promise<void> {
		const ask = this.humanAsks.get(id)
		if (!ask || ask.state !== "open") return
		const event = this.resolveAsk(id, "skipped", null)
		if (!event) return
		this.publish([event])
		const home = this.home()
		if (home)
			await this.services
				.agent(home.roomId, ask.from)
				.askAnswered(id, "")
				.catch(() => false)
	}

	private resolveAsk(id: string, how: "answered" | "skipped", answer: string | null): RoomEvent | null {
		return this.ctx.storage.transactionSync(() => (this.humanAsks.resolve(id, how, answer) ? this.log.append("human", { t: "ask_resolved", id, how }) : null))
	}

	async memoryView(seqs: number[]): Promise<{ text: string; count: number }> {
		const out = this.memoryNaps.view(seqs)
		return out
	}

	async memorySince(slug: AgentSlug, pos: number, seqs: number[]): Promise<{ text: string; count: number }> {
		const out = this.memoryNaps.since(slug, pos, seqs)
		return out
	}

	async memoryRecall(query: string, seen?: number, skip: number[] = []): Promise<string[]> {
    const archive = this.historyArchive()
    if (!archive) return this.memoryNaps.recall(query, seen, skip)
    const text = query.slice(0, 200)
    let hits = (await archive.search(text, { limit: 30, mail: true }, 1_000)).results
    if (!hits.length) {
      const words = [...new Set(text.toLowerCase().split(/\W+/).filter((word) => word.length > 2))].sort((a, b) => b.length - a.length).slice(0, 4)
      const found = new Map<string, (typeof hits)[number]>()
      for (const word of words) for (const hit of (await archive.search(word, { limit: 30, mail: true }, 1_000)).results) found.set(hit.id, hit)
      hits = [...found.values()].sort((a, b) => b.seq - a.seq)
    }
    return this.memory.recallHits(hits, Date.now(), 10, seen, new Set(skip))
	}

	async memoryZoom(id: string): Promise<string | null> {
    const archive = this.historyArchive()
    return archive ? this.memory.zoomArchived(id, (seq, before, after) => archive.around(seq, before, after), Date.now()) : this.memoryNaps.zoom(id)
	}

	memberSlugs(): AgentSlug[] {
		return this.members.list().map((m) => m.slug)
	}

	async eraseFormerAgent(slug: AgentSlug): Promise<void> {
		const home = this.home()
		if (home && this.members.everyone().includes(slug) && !this.members.get(slug)) await this.services.agent(home.roomId, slug).erase()
	}

	async erase(): Promise<void> {
		const home = this.home()
		if (!home || this.log.meta("deleted") === "1") return
		const archive = this.archive ?? (this.env.ARCHIVE ? new HistoryArchive(home.roomId, new RoomHistoryStore(this.ctx.storage, this.log), historyR2(this.env.ARCHIVE)) : undefined)
    this.erasing = true
    this.log.setMeta("erasing", "1")
    for (const slug of this.members.everyone()) await this.services.agent(home.roomId, slug).stop()
    await archive?.erase()
    for (const slug of this.members.everyone()) await this.services.agent(home.roomId, slug).erase()
		const pending = this.sql.exec<{ r2_key: string; upload_id: string | null }>("SELECT r2_key, upload_id FROM pending_uploads WHERE pending_uploads.room_id = ?1", this.log.roomId).toArray()
		for (const row of pending) if (row.upload_id) await this.services.files().resumeMultipartUpload(row.r2_key, row.upload_id).abort()
		const keys = this.sql
			.exec<{ r2_key: string }>("SELECT r2_key FROM files WHERE files.room_id = ?1 UNION SELECT r2_key FROM pending_uploads WHERE pending_uploads.room_id = ?1", this.log.roomId)
			.toArray()
			.map((r) => r.r2_key)
		if (keys.length) await deleteFiles(this.services.files(), keys)
		for (const ws of this.ctx.getWebSockets()) ws.close(1000, "Chat deleted")
		eraseRoomSchema(this.ownerStorage, this.log.roomId)
    await this.alarms.clearWakeup(BURST_WAKEUP)
	}

	async subscribe(ws: WebSocket, lastSeq: number, handle?: string): Promise<void> {
		const userId = this.identity.ownerId
		this.adopt(userId)
		if (handle && handle !== this.log.meta(HUMAN_HANDLE)) this.log.setMeta(HUMAN_HANDLE, handle)
		const home = this.home()
		if (!home) return
		const chat = await this.chat(home)
		if (chat) await this.seedMembers(home, chat)
		await handleFrame(this, ws, JSON.stringify({ t: "hello", lastSeq }))
	}

  async settleHumanInput(): Promise<void> {
    await this.burst.settle(() => this.flushBurst())
  }

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (this.log.meta("deleted") === "1" || this.log.meta("erasing") === "1") return
		try {
			await handleFrame(this, ws, message)
      await this.settleHumanInput()
		} catch (e) {
			console.error(`room frame failed: ${e instanceof Error ? e.message : String(e)}`)
			send(ws, { t: "error", error: STORAGE_ERROR })
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		try {
			ws.close(code, reason)
		} catch {}
	}

	publish(events: readonly RoomEvent[], { touch = true, deliver = true }: { touch?: boolean; deliver?: boolean } = {}): void {
		if (!events.length) return
		this.broadcast({ t: "events", events })
		if (touch && events.some((e) => ROW_EVENTS.has(e.t))) this.touchSoon()
		this.reports.gather(events)
		if (events.some((e) => e.t === "edit" || e.t === "delete")) this.ctx.waitUntil(this.memoryNaps.forget())
		const human = deliver ? events.flatMap((e) => (e.t === "message" && e.from.kind === "human" ? [e.text] : [])) : []
		const last = human.at(-1)
		if (last !== undefined) {
			this.ctx.waitUntil(this.burst.arm(last))
		}
	}

	private touchSoon(): void {
		const home = this.home()
		if (home) this.services.user().roomChanged(home.roomId)
	}
	private touchBubble(_message: Extract<RoomEvent, { t: "message" }>): void {
		this.touchSoon()
	}

	broadcast(frame: RoomToClient): void {
		this.publishFrame(frame)
	}

  private historyArchive(): HistoryArchive | undefined {
    const env = this.env
    const home = this.home()
    if ((this.erasing || this.log.meta("erasing") === "1") && !this.archive) return undefined
    if (!env.ARCHIVE || !home) return undefined
    return this.archive ??= new HistoryArchive(home.roomId, new RoomHistoryStore(this.ctx.storage, this.log), historyR2(env.ARCHIVE))
  }

  async afterRun(): Promise<void> {
    await this.memoryNaps.naps()
    await this.archiveHistory()
  }

  archiveHistory(): Promise<void> {
    return this.historyArchive()?.afterRun() ?? Promise.resolve()
  }

  async mutateMessage<T>(id: string, apply: () => T): Promise<T> {
    if (this.erasing || this.log.meta("erasing") === "1") throw new Error("Chat is being deleted")
    return this.historyArchive()?.mutate(id, apply) ?? apply()
  }

  async history(seq: number, before: number, after: number) {
    return this.historyArchive()?.around(seq, before, after) ?? this.log.around(seq, before, after)
  }

  async search(query: string, options?: SearchOptions) {
    return this.historyArchive()?.search(query, options) ?? searchMessages(this.ownerStorage.sql, this.log.roomId, query, options)
  }

	initiativeWake(input: { id: string; to: AgentSlug | null; body: string; reason: string }): Promise<WakeResult | "busy"> {
		return this.wakes.initiativeWake(input)
	}

	deliverRoutine(deliveryId: string, input: { target: string; body: string }): Promise<WakeResult> {
		return this.wakes.deliverRoutine(deliveryId, input)
	}

	async setRoutines(list: RoomRoutine[]): Promise<void> {
		this.routines.set(list)
	}

	async systemNotice(id: string, text: string, reason: SystemReason = "run_budget"): Promise<void> {
		const event = this.deliveries.notice(id, text, reason, reason === "routine" ? { kind: "routine", title: oneLine(text, DELEGATED_TITLE) } : undefined)
		if (event) this.publish([event])
	}

	wake(w: Wake): Promise<WakeResult> {
		return this.wakes.wake(w)
	}

	/**
	 * Sends run one at a time, in the order the sockets delivered them. A long send waits on R2
	 * before its transaction, so a short send that came after it must wait too, or it takes an earlier seq.
	 */
	humanSend(frame: Extract<ClientToRoom, { t: "send" }>): Promise<SendOutcome> {
		const out = this.sends.then(() => this.storeSend(frame))
		this.sends = out.catch(() => {})
		return out
	}

	private async storeSend(frame: Extract<ClientToRoom, { t: "send" }>): Promise<SendOutcome> {
    if (this.erasing || this.log.meta("erasing") === "1" || this.log.meta("deleted") === "1") return { refused: "This chat is being deleted." }
		const text = bubbleOf(frame.text)
		let whole: WholeText | null = null
		try {
			if (text.length < frame.text.length && !this.log.sentBefore(frame.clientId)) {
				const home = this.home()
				if (!home) throw new ClaimRefused("This chat is not ready. Send again in a moment.")
				whole = await putWhole(this.services.files(), home, frame.clientId, frame.text)
			}
			const store = (): SendOutcome => this.ctx.storage.transactionSync(() => {
				const earlier = this.log.sentBefore(frame.clientId)
				if (earlier) return { ack: earlier, events: [] }
				const now = Date.now()
				const claimed = frame.attachments?.length ? claim(this.pending, this.files, frame.attachments, now) : { refs: [], events: [] }
				const filed = whole ? this.files.put({ id: whole.id, path: attachmentPath(WHOLE_NAME, now, (p) => this.files.stat(p) !== null), r2Key: whole.r2Key, size: whole.size, type: WHOLE_TYPE, sha256: whole.sha256, author: { kind: "human" }, expectSha256: "none" }) : null
				if (filed && (!filed.file || filed.refused || filed.drop)) throw new ClaimRefused("The message's text could not be stored as a file.")
				const refs = [...claimed.refs, ...(filed?.file ? [filed.file] : [])]
				// Each attachment the human named in the text links to where it was stored.
				const paths = new Map((frame.attachments ?? []).map((a, i) => [a.pendingId, `/${claimed.refs[i]!.name}`]))
				const body = linkAttachments(text, (id) => paths.get(id))
				const target = frame.replyTo ? this.log.message(frame.replyTo) : null
				const replyTo = target && !isPrivate(target) ? target.id : undefined
				const stored = this.log.addMessage({
					from: { kind: "human" },
					text: body,
					rich: parseRichText(body),
					clientId: frame.clientId,
					...(replyTo ? { replyTo } : {}),
					...(replyTo && frame.quote?.trim() ? { quote: frame.quote.trim() } : {}),
					...(refs.length ? { files: refs } : {}),
				})
				// The burst row takes the whole text's mentions, so routing does not depend on the bubble.
				if (stored.event) this.burst.stage({ id: stored.id, seq: stored.seq, text: body, replyTo }, tags(frame.text))
				return { ack: { id: stored.id, seq: stored.seq }, events: [...claimed.events, ...(filed?.events ?? []), ...(stored.event ? [stored.event] : [])] }
			})
      return frame.replyTo ? await this.mutateMessage(frame.replyTo, store) : store()
		} catch (error) {
			if (whole) await discardWhole(this.services.files(), whole).catch((e: unknown) => console.error(`whole text delete failed: ${e instanceof Error ? e.message : String(e)}`))
			if (error instanceof ClaimRefused) return { refused: error.message }
			throw error
		}
	}

	async pendingOpen(input: NewPending): Promise<string | null> {
		const refused = this.pending.open(input, Date.now())
		if (!refused) await this.armPending()
		return refused
	}

	async pendingReady(id: string, sha256: string, size: number): Promise<"ok" | "gone" | "size"> {
		return this.pending.ready(id, sha256, size)
	}

	async pendingRemove(id: string): Promise<{ r2Key: string; uploadId: string | null } | null> {
		const row = this.pending.remove(id)
		return row ? { r2Key: row.r2_key, uploadId: row.upload_id } : null
	}

	async sweepPending(now = Date.now()): Promise<number> {
		const stale = this.pending.expired(now - PENDING_TTL_MS)
		for (const row of stale) {
			if (row.upload_id)
				await this.services
					.files()
					.resumeMultipartUpload(row.r2_key, row.upload_id)
					.abort()
					.catch(() => {})
		}
		if (stale.length)
			await deleteFiles(
				this.services.files(),
				stale.map((r) => r.r2_key),
			)
		this.pending.drop(stale.map((r) => r.id))
		await this.armPending()
		return stale.length
	}

	private async armPending(): Promise<void> {
		const at = this.pending.nextExpiry()
		if (at === null) await this.alarms.clearWakeup(PENDING_WAKEUP)
		else await this.alarms.setWakeup(PENDING_WAKEUP, at)
	}

	async putFile(input: NewFile): Promise<Omit<PutResult, "events"> & { entry: FsEntry | null }> {
		const by = input.author.kind === "agent" ? input.author.slug : null
		if (by) {
			const held = this.held(by, [input.path])
			if (held) return { file: null, drop: input.r2Key, refused: held, entry: null }
		}
		const { events, ...result } = this.files.put(input)
		if (by && result.file && !result.conflict && !result.refused) this.working(by, [input.path], `editing /${input.path}`, edit(`editing /${input.path}`))
		if (events.length) this.publish(events)
		return { ...result, entry: result.file && !result.conflict ? this.files.stat(input.path) : null }
	}

	async fsStat(path: string): Promise<FsEntry | null> {
		return this.files.stat(path)
	}

	async fsList(dir: string, recursive = false): Promise<FsEntry[] | FsFail> {
		return this.files.list(dir, recursive)
	}

	async fsMove(slug: AgentSlug, from: string, to: string): Promise<FsChange<RoomEvent> | FsFail> {
		return this.guarded(slug, [from, to], `moving /${from}`, () => this.files.move(from, to, { kind: "agent", slug }))
	}

	async fsRemove(slug: AgentSlug, paths: readonly string[], recursive: boolean): Promise<FsChange<RoomEvent> | FsFail> {
		return this.guarded(slug, paths, `deleting /${paths[0]}`, () => this.files.remove(paths, recursive, { kind: "agent", slug }))
	}

	async fsCommit(slug: AgentSlug, changes: readonly IndexChange[]): Promise<CommitResult<RoomEvent>> {
		const paths = changes.flatMap(changePaths)
		const held = this.held(slug, paths)
		if (held) return { ok: false, path: paths[0] ?? "", message: held.message, conflict: false }
		const out = this.files.commit(changes, { kind: "agent", slug })
		if (!out.ok) return out
		this.applyFs({ ok: true, events: out.events, drop: out.drop, changed: changes.length })
		if (paths.length) {
			const doing = `editing /${paths[0]}${paths.length > 1 ? ` and ${paths.length - 1} more` : ""}`
			this.working(slug, paths, doing, edit(doing))
		}
		return { ok: true, events: [], drop: [] }
	}

	private divider(id: string, text: string, event: Divider): void {
		const { event: stored } = this.log.addMessage(dividerMessage(id, text, event))
		if (stored) this.publish([stored])
	}

	async routineCreated(slug: AgentSlug, routineId: string, title: string, byAgent = false): Promise<void> {
		const text = byAgent ? `${this.members.get(slug)?.name ?? slug} created a routine: ${title}` : `Routine added: ${title}`
		this.divider(`routine-created:${routineId}`, text, { kind: "routine_created", agent: slug, title, ...(byAgent ? { byAgent: true as const } : {}), private: true })
	}

	async compacted(slug: AgentSlug, key: string): Promise<void> {
		this.divider(`compacted:${slug}:${key}`, `${this.members.get(slug)?.name ?? slug} compacted its context`, { kind: "compacted", agent: slug, private: true })
	}

	async homeNotice(slug: AgentSlug, text: string): Promise<void> {
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "files" }, text: `@${slug} ${text}`.slice(0, 300) })
		if (event) this.publish([event])
	}

	async fsMkdir(slug: AgentSlug, path: string): Promise<FsChange<RoomEvent> | FsFail> {
		return this.guarded(slug, [path], `setting up /${path}`, () => this.files.mkdir(path, { kind: "agent", slug }))
	}

	private held(slug: AgentSlug, paths: readonly string[]): FsFail | null {
		const h = this.team.holder(slug, paths, Date.now())
		return h ? { ok: false, code: "invalid", message: Team.refusal(h) } : null
	}

	private working(slug: AgentSlug, paths: readonly string[], doing: string, activity: Activity): void {
		const now = Date.now()
		this.team.take(slug, paths, now)
		this.memory.did(slug, doing, now)
		if (this.team.now(slug) === doing) return
		this.team.doing(slug, doing, now, activity)
		this.broadcastStatus(slug)
	}

	private guarded<T extends FsChange<RoomEvent> | FsFail>(slug: AgentSlug, paths: readonly string[], doing: string, act: () => T): T | FsFail {
		const held = this.held(slug, paths)
		if (held) return held
		const out = this.applyFs(act())
		if (out.ok) this.working(slug, paths, doing, edit(doing))
		return out
	}

	/**
	 * Tool calls that started or ended, in order, from one agent in one message. A running step is kept in memory and sent on;
	 * an ended one is written once. Each item may also say what the agent is doing now, so a call costs no second request.
	 * A non-member's report is dropped, and a step that starts after its run ended.
	 */
	async reportSteps(slug: AgentSlug, items: readonly StepItem[]): Promise<void> {
		if (!this.members.list().some((m) => m.slug === slug)) return
		const over = new Map<string, boolean>()
		let latest: StepItem | undefined
		for (const item of items) {
			const step: HeardStep = { ...item.step, slug }
			// A worker's steps keep coming after the run that started it ends.
			if (step.status === "running" && !step.worker) {
				const done = over.get(step.runId) ?? this.bubbles.ended(step.runId)
				over.set(step.runId, done)
				if (done) continue
			}
			const stored = this.log.hearStep(step)
			if (stored) this.broadcast({ t: "step", step: stored })
			if (item.doing && item.activity) latest = item
		}
		// Only the newest caption shows, so a batch writes it once.
		if (latest?.doing && latest.activity) {
			const doing = latest.doing.slice(0, MAX_DOING)
			this.working(slug, [], doing, "caption" in latest.activity ? { ...latest.activity, caption: doing } : latest.activity)
		}
	}

	stepWindow(slug: AgentSlug, after: number): RunStep[] {
		return this.log.steps.window(slug, after)
	}

	async teamNow(): Promise<{ slug: AgentSlug; name: string; status: AgentState; doing: string | null; holds: string[] }[]> {
		const now = Date.now()
		return this.members.list().map((m) => ({ slug: m.slug, name: m.name, status: m.status, doing: this.team.now(m.slug), holds: this.team.held(m.slug, now) }))
	}

	fileOp(op: FileOp): string | null {
		const human = { kind: "human" } as const
		const paths = op.op === "rm" ? op.paths : op.op === "mv" ? [op.from, op.to] : [op.path]
		if (paths.some((p) => cleanPath(p) === null)) return "that is not a path in this chat's files"
		const out = this.applyFs(op.op === "rm" ? this.files.remove(op.paths, op.recursive ?? false, human) : op.op === "mv" ? this.files.move(op.from, op.to, human) : this.files.mkdir(op.path, human))
		return out.ok ? null : out.message
	}

	private applyFs<T extends FsChange<RoomEvent> | FsFail>(out: T): T {
		if (!out.ok) return out
		if (out.events.length) this.publish(out.events)
		if (out.drop.length) this.ctx.waitUntil(deleteFiles(this.services.files(), out.drop).catch((e: unknown) => console.error(`r2 delete failed: ${e instanceof Error ? e.message : String(e)}`)))
		return out
	}

	/** The human's messages still in the burst window are not dropped: they go out after the stop, as sent. */
	stop(): void {
		const home = this.home()
		if (!home) return
		this.mail.stop()
		for (const member of this.members.list()) {
			if (member.status !== "idle") this.divider(`stopped:${member.slug}:${crypto.randomUUID()}`, "Stopped", { kind: "run_stopped", agent: member.slug, private: true })
			this.stopAgent(home, member.slug)
			this.reports.run(this.routines.dropped(member.slug), "stopped")
		}
	}

	private stopAgent(home: Home, slug: AgentSlug): void {
		const agent = this.services.agent(home.roomId, slug)
		this.ctx.waitUntil(
			agent.stop().then(
				() => undefined,
				(error: unknown) => console.error(`stop failed: ${error instanceof Error ? error.message : String(error)}`),
			),
		)
	}

	memberOp(op: MemberOp): MemberRefusal | null {
		if (op.op === "add" && this.log.meta(KIKO_CHAT) === "1") return "kiko"
		const name = op.op === "remove" ? this.members.get(op.slug)?.name : undefined
		const result = this.members.apply(op)
		if (!result.ok) return result.reason
		const notice: RoomEvent[] = []
		if (op.op === "add") {
			const count = this.files.stat("")
			const n = count?.kind === "directory" ? count.files : 0
			if (n) {
				const { event } = this.log.addMessage({ from: { kind: "system", reason: "files" }, text: `@${op.slug} can now see this chat's ${n} file${n === 1 ? "" : "s"}` })
				if (event) notice.push(event)
			}
		}
		if (op.op !== "rename" && result.events.length) {
			const activity: MemberActivity = { seq: this.log.lastSeq(), at: result.events[0]?.at ?? 0, kind: op.op === "add" ? "joined" : "left", name: op.op === "add" ? op.name : (name ?? op.slug) }
			this.log.setMeta(MEMBER_ACTIVITY, JSON.stringify(activity))
		}
		if (op.op !== "rename") {
			const joined = op.op === "add"
			const who = joined ? op.name : (name ?? op.slug)
			const slug = op.slug
			const line = this.log.addMessage(dividerMessage(`member:${result.events[0]?.seq}`, `${who} ${joined ? "joined" : "left"}`, joined ? { kind: "member_added", slug, name: who, private: true } : { kind: "member_removed", slug, name: who, private: true })).event
			if (line) notice.push(line)
		}
		this.publish([...result.events, ...notice])
		const home = this.home()
		if (op.op === "remove" && home) this.stopAgent(home, op.slug)
		if (op.op !== "rename" && home) {
			const slugs = this.members.list().map((m) => m.slug)
			this.ctx.waitUntil((async () => this.services.user().chatMembers(home.roomId, slugs))().catch((e: unknown) => console.error(`chat members not saved: ${e instanceof Error ? e.message : String(e)}`)))
		}
		return null
	}

	/** The frame for a model pick. The user keeps it for every chat, so this passes it on. */
	setModel(ref: string, slug?: AgentSlug): void {
		const home = this.home()
		if (!home || ref.indexOf("/") <= 0) return
		const slugs = this.members
			.list()
			.filter((m) => !slug || m.slug === slug)
			.map((m) => m.slug)
		this.ctx.waitUntil(this.services.user().setAgentModels(slugs, ref, home.roomId))
	}

	/** The user calls this when an agent in this chat changes model here. `was` is the model it ran on before. */
	async modelChanged(slug: AgentSlug, ref: string, was?: string): Promise<void> {
		const member = this.members.get(slug)
		if (!member) return
		const to = modelNamed(ref)
		const from = was ? modelNamed(was) : undefined
		this.divider(`model:${slug}:${crypto.randomUUID()}`, from ? `Context handoff from ${from} to ${to}` : `${member.name} now uses ${to}`, { kind: "model_changed", agent: slug, model: to, ...(from ? { from } : {}), private: true })
	}

	taskOp(op: TaskOp): string | null {
		let reason: string | null = null
		this.publish(
			applyTaskOp(
				this.workspace,
				op,
				this.members.list().map((m) => m.slug),
				(error) => {
					reason = error
				},
			),
		)
		this.ctx.waitUntil(this.deliverWakes())
		return reason
	}

	async workspaceCall(slug: AgentSlug, call: WorkspaceCall): Promise<WorkspaceAnswer> {
		const members = this.members.list()
		const member = members.find((m) => m.slug === slug)
		if (!member) return { ok: false, error: "you are not a member of this room" }
		const { answer, events } = this.ctx.storage.transactionSync(() => {
			const result = runCall(
				this.workspace,
				slug,
				member.lead,
				call,
				members.map((m) => m.slug),
				this.mail.chain(slug),
			)
			const lead = members.find((m) => m.lead)
			if (lead && lead.slug !== slug)
				for (const event of result.events) {
					if (event.t === "task" && (event.task.status === "review" || event.task.status === "done" || event.task.status === "blocked")) this.workspace.queueReport(event, slug, lead.slug)
				}
			return result
		})
		this.publish(events)

		this.ctx.waitUntil(this.deliverWakes())
		return answer
	}

	private deliverWakes(): Promise<void> {
		return this.wakes.deliverWakes()
	}

	humanTyping(): void {
		this.wakes.humanTyped()
		this.ctx.waitUntil(this.burst.typing())
	}

	async post(slug: AgentSlug, runId: string, attempt: number, index: number, block: string): Promise<boolean> {
		const root = this.mail.chainRoot(slug)
		const reason = root?.startsWith("initiative:") ? this.log.meta(`initiative:${root}`) : null
		const events = this.bubbles.post(slug, { runId, attempt, index }, block, reason ? { reason } : undefined)
		this.publish(events, { touch: false })
		const posted = events.find((e) => e.t === "message")
		if (posted) this.touchBubble(posted)
		return posted !== undefined
	}

	async react(slug: AgentSlug, emoji: string, messageId?: string): Promise<boolean> {
		const event = agentReact(this.log, this.sql, slug, emoji, messageId)
		if (event) this.publish([event])
		return event !== null
	}

	async noProvider(slug: AgentSlug, provider: string, requestId: string, heard: readonly string[] = [], inputs: readonly string[] = [], kind: "no_key" | "signed_out" | "network" = "no_key"): Promise<boolean> {
		const because = kind === "signed_out" ? `the human's ${provider} sign-in expired` : kind === "network" ? `kiko could not reach ${provider}` : `the human has not connected ${provider}`
		return this.cannotRun(slug, `no_provider:${slug}:${requestId}`, kind, provider, because, heard, inputs)
	}

	/** The agent's model is one pi-ai does not list, such as a retired one. It stays picked; the human picks another. */
	async modelGone(slug: AgentSlug, provider: string, model: string, requestId: string, heard: readonly string[] = [], inputs: readonly string[] = []): Promise<boolean> {
		return this.cannotRun(slug, `model_gone:${slug}:${requestId}`, "model_not_found", provider, `its model ${model} is not one Kiko can run`, heard, inputs, `${model} is not in the model list this version of Kiko knows.`)
	}

	/** The agent has no model because the human never picked one. Kiko does not pick for them. */
	async noModel(slug: AgentSlug, requestId: string, heard: readonly string[] = [], inputs: readonly string[] = []): Promise<boolean> {
		return this.cannotRun(slug, `no_model:${slug}:${requestId}`, "no_model", "", "the human has not picked a model for it", heard, inputs)
	}

	private async cannotRun(slug: AgentSlug, key: string, kind: RunErrorKind, provider: string, because: string, heard: readonly string[], inputs: readonly string[], detail?: string): Promise<boolean> {
		const stored = this.reportRunError(slug, key, kind, provider, inputs, detail)
		const home = this.home()
		if (home) {
			const why = `(no answer: @${slug} cannot run, because ${because}. tell the human, or go on without it.)`
			await this.mailer.relayHeard(slug, heard, why, { id: key, seq: stored?.seq ?? this.log.sentBefore(key)?.seq ?? 0 })
		}
		this.reports.run(this.routines.dropped(slug), "failed")
		return stored !== null
	}

	async runError(slug: AgentSlug, runId: string, error: { kind: RunErrorKind; provider: string; inputs: readonly string[]; detail?: string }): Promise<void> {
		this.reportRunError(slug, `run-error:${slug}:${runId}`, error.kind, error.provider, error.inputs, typeof error.detail === "string" ? error.detail.slice(0, 300) : undefined)
	}

	/**
	 * A failed run is a row in the transcript the human can act on, and one toast for a human who is
	 * in another chat. `key` makes a repeat store nothing. Retry needs the human messages the run
	 * answered, so it is offered only when there are some.
	 */
	private reportRunError(slug: AgentSlug, key: string, kind: RunErrorKind, provider: string, inputs: readonly string[], detail?: string): { id: MessageId; seq: number } | null {
		const member = this.members.get(slug)
		const home = this.home()
		if (!member || !home) return null
		const heard = inputs.filter((id) => this.log.message(id)?.from.kind === "human")
		const failure = describeRunError(kind, findProvider(provider)?.name ?? provider)
		const actions = heard.length ? failure.actions : failure.actions.filter((a) => a !== "retry")
		const stored = this.log.addMessage(dividerMessage(key, failure.message, { kind: "run_error", slug, reason: kind, actions, ...(provider ? { provider } : {}), ...(detail ? { detail } : {}), private: true }))
		if (!stored.event) return null
		this.log.setMeta(`retry:${stored.id}`, JSON.stringify({ slug, inputs: heard }))
		this.publish([stored.event])
		const user = this.services.user()
		this.ctx.waitUntil(
			Promise.all([user.notifyError({ code: "model", message: `${member.name} could not answer. ${failure.message}`, ...(failure.toast ? { action: failure.toast } : {}) }, home.roomId), problemOfRun(kind) && provider ? user.recordProviderProblem(provider, kind) : undefined]).catch((e: unknown) =>
				console.error(`run error notice failed: ${e instanceof Error ? e.message : String(e)}`),
			),
		)
		return stored
	}

	/** Runs again the input of a failed run, as new deliveries of the same human messages. Nothing is sent again. */
	async retryRun(messageId: MessageId): Promise<void> {
		const saved = this.log.meta(`retry:${messageId}`)
		if (!saved) return
		const { slug, inputs } = JSON.parse(saved) as { slug: AgentSlug; inputs: string[] }
		await this.redeliver(slug, inputs, messageId)
	}

	async runDropped(slug: AgentSlug): Promise<void> {
		this.reports.run(this.routines.dropped(slug), "failed")
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "run_budget" }, text: `@${slug} stopped: its reply kept crashing, so it was dropped. send a message to try again.` })
		if (event) this.publish([event])
		await this.setStatus(slug, "idle")
	}

	async draft(slug: AgentSlug, runId: string, index: number, text: string): Promise<void> {
		this.broadcast({ t: "draft", slug, runId, index, text: replyTag(text).text })
	}

	/**
	 * The words a run wrote between two tool calls, as a step of its own. It is not a call: the panel shows it as a
	 * paragraph, in order with the calls around it, so the chat keeps only the ack and the answer.
	 */
	async note(slug: AgentSlug, runId: string, id: string, text: string): Promise<void> {
		if (!this.members.list().some((m) => m.slug === slug)) return
		const at = Date.now()
		const step: HeardStep = { id, runId, slug, tool: "other", name: "note", note: true, label: text, status: "done", startedAt: at, endedAt: at }
		const stored = this.log.hearStep(step)
		if (stored) this.broadcast({ t: "step", step: stored })
	}

	async setStatus(slug: AgentSlug, state: AgentState, detail?: string | null): Promise<boolean> {
		if (state === "idle") {
			this.team.clear(slug)
			this.reports.run(this.routines.ended(slug), "ended")
		} else if (this.members.get(slug)?.status === "idle") this.routines.started(slug, this.log.lastSeq())
		if (!this.members.setStatus(slug, state)) return false
		// What the typing row says. A string sets it, null puts back "writing a reply", and no argument leaves a tool's caption.
		if (state === "typing" && detail !== undefined) this.team.doing(slug, detail ?? "writing a reply", Date.now(), { kind: "writing" })
		else if (state === "typing" && !this.team.now(slug)) this.team.doing(slug, "writing a reply", Date.now(), { kind: "writing" })
		this.broadcastStatus(slug)
		this.broadcast(this.activeFrame())
		await this.pushTyping()

		return true
	}

	private agentStatus(slug: AgentSlug): import("@kiko/protocol").AgentStatus | null {
		const member = this.members.get(slug)
		if (!member) return null
		const workers = this.workerRows.get(slug) ?? []
		const activity = activityOf(member.status, this.team.activity(slug), workers)
		const doing = this.team.now(slug)
		return { slug, state: member.status, ...(member.status !== "idle" && doing ? { doing } : {}), ...(activity ? { activity } : {}) }
	}
	private readonly workerRows = new Map<AgentSlug, readonly WorkerRow[]>()

	private broadcastStatus(slug: AgentSlug): void {
		const status = this.agentStatus(slug)
		if (status) this.broadcast({ t: "status", ...status })
	}

	async setWorkers(slug: AgentSlug, rows: readonly WorkerRow[]): Promise<void> {
		const member = this.members.get(slug)
		if (!member) return
		const next = JSON.stringify(rows)
		const before = JSON.stringify(this.workerRows.get(slug) ?? [])
		if (before === next) return
		this.workerRows.set(slug, rows)
		if (member.status !== "idle") this.broadcastStatus(slug)
	}

	async endRun(slug: AgentSlug, runId: string, heard: readonly string[] = [], working = false, mailOnly = false): Promise<void> {
		const settled = this.bubbles.settle(slug, runId)
		if (settled) this.publish([settled], { touch: false })
		for (const step of this.log.steps.abandon(runId)) this.broadcast({ t: "step", step })
		const home = this.home()
		const first = !this.bubbles.ended(runId)
		if (home && first) {
			this.memory.trace(slug, runId, Date.now())
			await this.mailer.answerAsks(slug, runId, heard)
		}
		this.mail.runEnded(slug)
		if (working) this.team.clearDoing(slug)
		if (home && first) {
			this.services.user().roomChanged(home.roomId)
			this.bubbles.markEnded(runId)
		}
		const changed = await this.setStatus(slug, working ? "working" : "idle")
		if (working && !changed) this.broadcastStatus(slug)
	}

	private activeFrame(): RoomToClient {
		return { t: "typing", who: [...this.members.busy().keys()] }
	}

	/** What a new room socket needs to know: who is busy and what each is doing. Statuses are not part of a catch-up. */
	presence(): RoomToClient[] {
		const statuses = this.members
			.list()
			.filter((m) => m.status !== "idle")
			.flatMap((m) => {
				const status = this.agentStatus(m.slug)
				return status ? [status] : []
			})
		return statuses.length ? [this.activeFrame(), ...statuses.map((s): RoomToClient => ({ t: "status", ...s }))] : []
	}

	/** The sidebar says "typing" for an agent that is writing a reply, not for one using a tool. One chain keeps the frames in order. */
	private pushTyping(): Promise<void> {
		const home = this.home()
		if (!home) return Promise.resolve()
		this.typingChain = this.typingChain
			.then(async () => {
				const names = [...this.members.busy().values()].filter((m) => m.status === "typing").map((m) => m.name)
				const key = JSON.stringify(names)
				if (key === this.typingSent) return
				await this.services.user().chatTyping(home.roomId, names)
				this.typingSent = key
			})
			.catch((error) => console.error(`chatTyping failed: ${error instanceof Error ? error.message : String(error)}`))
		return this.typingChain
	}

	// The dev-only bodies live in room/dev.ts, which only a development build can load. One cached load
	// per object reaches every dev method below.
	private devCache?: Promise<RoomDev>

	private dev(): Promise<RoomDev> {
		this.devCache ??= loadRoomDev().then((m) => new m.RoomDev({
			sql: this.sql,
      storage: this.ctx.storage,
      archive: () => this.historyArchive(),
			log: this.log,
			members: this.members,
			memory: this.memory,
			pending: this.pending,
			publish: (events) => this.publish(events),
			armMemory: () => this.memoryNaps.naps(),
			tasksChanged: async () => this.touchSoon(),
			sweepPending: () => this.sweepPending(),
		}))
		return this.devCache
	}

  async devArchive() {
    return (await this.dev()).archive()
  }

	async devSeed(turns: { from: string; text: string }[]): Promise<number> {
		return (await this.dev()).seed(turns)
	}

	async devMemory(): Promise<{ turns: number; pending: number; view: string }> {
		return (await this.dev()).memory()
	}

	async devAge(ms: number): Promise<number> {
		return (await this.dev()).age(ms)
	}

	async devAgePending(ms: number): Promise<number> {
		return (await this.dev()).agePending(ms)
	}

	/** A card in the chat that asks the human to take control of the browser. `key` names the spell of control, so a retry adds nothing. */
	async browserAsk(slug: AgentSlug, reason: string, key: string): Promise<boolean> {
		const member = this.members.get(slug)
		if (!member) return false
		this.divider(`browser-ask:${key}:${slug}`, `${member.name} needs you in the browser: ${reason}`, { kind: "browser_control", agent: slug, reason, private: true })
		return true
	}

	async browserShare(slug: AgentSlug, reason: string): Promise<boolean> {
		const member = this.members.get(slug)
		if (!member) return false
		const { event } = this.log.addMessage({ from: { kind: "agent", slug }, text: reason })
		if (event) this.publish([event])
		return true
	}
}
