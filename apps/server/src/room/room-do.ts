import { isAgentSlug, tagline } from "@yuki/protocol"
import type { AgentSlug, AgentState, Chat, ClientToRoom, Envelope, FileOp, FileRef, MemberOp, MemberRefusal, MessageId, RoomEvent, RoomId, RoomToClient, Sender, SystemReason, TaskOp } from "@yuki/protocol"
import { DurableObject } from "cloudflare:workers"
import { instrument } from "../lib/dev-stats"
import type { Env } from "../index"
import { type Alarms, createAlarms, runDue } from "@yuki/durable/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "@yuki/durable/hello-deadline"
import { HUMAN, stamp } from "@yuki/agent/authority"
import { BUDGET_LINE, utcDay } from "./limits"
import { type Inflight, RoomRoutines, ROUTINES_WAKEUP } from "./routines"
import { chatTasks, LOOPS_WAKEUP, MAX_NUDGES, nextSweep, nudgeBody, openTasks, stalled } from "./stalls"
import type { RoomRoutine } from "../user/routines"
import type { RunDelivery } from "../user/reminders"
import { agentStub, HANDLE_HEADER, ROOM_ID_HEADER, USER_ID_HEADER, userStub, roomStub } from "../lib/names"
import { closeSockets, storedRows, wipeStorage } from "@yuki/durable/wipe"
import { type ApprovalAnswer, APPROVALS_WAKEUP, type ApprovalRequest, RoomApprovals } from "./approvals"
import { BURST_WAKEUP, Burst, deliverable, MAX_DELIVERY_ENVELOPES } from "./burst"
import { buildBrief, readBriefView } from "./brief"
import { RoomMemory } from "./memory"
import { Asks, type AskState } from "./asks"
import { Bubbles, replyTag } from "./bubbles"
import { chatTouch, HUMAN_HANDLE, MEMBER_ACTIVITY, type MemberActivity } from "./chat-touch"
import { Deliveries, type ReminderDelivery, route, withContext } from "./deliver"
import { resolveRecipients } from "./recipients"
import { type AgentSend, type Chain, Mail, messageIdOf, type QueuedMail, type StoredSend } from "./mail"
import { cleanPath, deleteFiles, fileKey } from "../files/upload"
import { changePaths, type CommitResult, type FileIndex, type IndexChange } from "../files/file-index"
import { CHAT_PATH } from "../files/room-fs"
import { Team } from "./team"
import { CHIEF, checkProposal, introduction, type NewAgentSpec, type Proposal, type ProposalInput } from "./chief"
import { type FsChange, type FsEntry, type FsFail, type NewFile, type PutResult, roomFiles } from "./files"
import { RoomLog } from "./log"
import { type MemberRow, Members, type NewMember } from "./members"
import { agentReact, markReactionsBriefed, reactionBrief } from "./reactions"
import { claim, ClaimRefused, legacyFiles, type NewPending, PENDING_TTL_MS, PENDING_WAKEUP, PendingUploads } from "./pending"
import { migrate } from "./schema"
import { searchMessages, type SearchOptions } from "./search"
import { type Attachment, attachment, handleFrame, send, type SocketRoom } from "./socket"
import { applyTaskOp, RoomWorkspace, runCall, wakeEnvelope, type WorkspaceAnswer, type WorkspaceCall } from "./workspace"

declare const process: { env: { NODE_ENV?: string } }

export const DEFAULT_AGENT = "yuki" as AgentSlug
/** The chief's display name. Its slug stays `yuki`; people read and type it as Yuki and `@yuki`. */
const CHIEF_NAME = "Yuki"
const DELIVERY_RETRY_MS = 2_000
const WAKES_WAKEUP = "ws_wakes"
const MAIL_WAKEUP = "mail"
const MEMORY_WAKEUP = "memory_naps"
const QUIET_WAKEUP = "memory_quiet"
const QUIET_MS = 6 * 3_600_000
const NAPS_PER_PASS = 24
const NAPS_AT_ONCE = 4

export type AgentHome = { userId: string; roomId: RoomId; slug: AgentSlug; role?: string; lead?: boolean; private?: boolean }


const ROW_EVENTS: ReadonlySet<RoomEvent["t"]> = new Set(["message", "edit", "delete", "react", "read", "member", "member_removed", "approval"])

export type SpawnInput = { id: string; slug: string; name?: string; role: string; task: string; tainted: boolean }

const SPAWN_REFUSAL: Record<MemberRefusal, string> = {
	limit: "the room is full: it holds at most 8 agents.",
	exists: "an agent with that handle is already here.",
	unknown: "no such agent.",
	last: "the room needs at least one agent.",
	reserved: "that handle is reserved. pick another.",
	chief: "yuki leads this room and cannot be removed.",
}

export class RoomDO extends DurableObject<Env> implements SocketRoom {
	// Set in the constructor's `blockConcurrencyWhile`, which ends before any request or alarm runs.
	log!: RoomLog
	private deliveries!: Deliveries
	private alarms!: Alarms
	private burst!: Burst
	private bubbles!: Bubbles
	private mail!: Mail
	private memory!: RoomMemory
	private asks!: Asks
	members!: Members
	files!: FileIndex<RoomEvent>
	team!: Team
	workspace!: RoomWorkspace
	approvals!: RoomApprovals
	private routines!: RoomRoutines
	private pending!: PendingUploads
	private readonly typing = new Set<AgentSlug>()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		instrument(ctx, "room")
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
		void ctx.blockConcurrencyWhile(async () => {
			migrate(ctx.storage)
			this.log = new RoomLog(ctx.storage)
			this.deliveries = new Deliveries(ctx.storage, this.log)
			this.files = roomFiles(ctx.storage, this.log)
			this.team = new Team(ctx.storage.sql)
			this.alarms = createAlarms(ctx)
			this.burst = new Burst(ctx.storage, this.alarms)
			this.bubbles = new Bubbles(ctx.storage, this.log)
			this.mail = new Mail(ctx.storage, this.log, (slug) => (this.members.get(slug)?.status ?? "idle") !== "idle")
			this.members = new Members(ctx.storage, this.log)
			this.workspace = new RoomWorkspace(ctx.storage, this.log)
			this.approvals = new RoomApprovals(ctx.storage, this.log)
			this.asks = new Asks(ctx.storage.sql)
			this.routines = new RoomRoutines(ctx.storage.sql, { get: (key) => this.log.meta(key), set: (key, value) => this.log.setMeta(key, value) })
			this.memory = new RoomMemory(ctx.storage, { get: (key) => this.log.meta(key), set: (key, value) => this.log.setMeta(key, value) })
			this.pending = new PendingUploads(ctx.storage.sql)
		})
	}

	private home(): { userId: string; roomId: RoomId } | null {
		const userId = this.log.meta("user_id")
		const roomId = this.log.meta("room_id")
		return userId && roomId ? { userId, roomId: roomId as RoomId } : null
	}

	private async chat(home: { userId: string; roomId: RoomId }): Promise<Chat | null> {
		const chat = await userStub(this.env.USER, home.userId).getChat(home.roomId)
		if (chat) this.remember(chat)
		return chat
	}

	private remember(chat: Chat): void {
		this.setPrivate(chat.private ?? false)
		if (this.log.meta("title") !== chat.title) this.log.setMeta("title", chat.title)
	}

	private async title(home: { userId: string; roomId: RoomId }): Promise<string> {
		return this.log.meta("title") ?? (await this.chat(home))?.title ?? ""
	}

	setPrivate(value: boolean): void {
		if ((this.log.meta("private") === "1") !== value) this.log.setMeta("private", value ? "1" : "0")
	}

	private agentHome(home: { userId: string; roomId: RoomId }, slug: AgentSlug, member: { role?: string; lead: boolean }): AgentHome {
		return { ...home, slug, role: member.role, lead: member.lead, private: this.log.meta("private") === "1" }
	}

	private async seedMembers(home: { userId: string; roomId: RoomId }, chat: Chat): Promise<void> {
		if (this.members.seeded()) return this.trySeedChatFile(home, chat.title)
		let agents: NewMember[] = []
		if (chat.agents?.length) {
			const mine = await userStub(this.env.USER, home.userId).listAgents()
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
		await this.trySeedChatFile(home, chat.title)
	}

	/** Writes /chat.md where there is none. The team's own file, once it has one, is never replaced. */
	async writeChatFile(author: AgentSlug, text: string): Promise<boolean> {
		const home = this.home()
		if (!home) return false
		const body = new TextEncoder().encode(text)
		const id = crypto.randomUUID()
		const r2Key = fileKey(home.userId, home.roomId, id)
		const digest = await crypto.subtle.digest("SHA-256", body)
		const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
		await this.env.FILES.put(r2Key, body, { httpMetadata: { contentType: "text/markdown" } })
		const { drop, file, events } = this.files.put({ id, path: CHAT_PATH, r2Key, size: body.length, type: "text/markdown", sha256, author: { kind: "agent", slug: author }, expectSha256: "none" })
		if (events.length) this.publish(events)
		if (drop) await deleteFiles(this.env.FILES, drop)
		return file !== null
	}

	async propose(slug: AgentSlug, input: ProposalInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		const home = this.home()
		if (!home) return { ok: false, error: "this chat is not set up yet" }
		if (slug !== CHIEF) return { ok: false, error: "only yuki makes agents and groups" }
		const checked = checkProposal(input, await userStub(this.env.USER, home.userId).listAgents())
		if ("error" in checked) return { ok: false, error: checked.error }
		const id = crypto.randomUUID().slice(0, 8)
		const runStart = Number(this.log.meta(`live:${slug}`) ?? Number.NaN)
		const proposal: Proposal = { ...checked, id, seq: Number.isFinite(runStart) ? Math.min(runStart, this.log.lastSeq()) : this.log.lastSeq() }
		this.log.setMeta(`proposal:${id}`, JSON.stringify(proposal))
		return { ok: true, id }
	}

	private openProposal(): string | null {
		const id = this.newestProposal()
		if (!id || this.log.meta(`created:${id}`)) return null
		const p = JSON.parse(this.log.meta(`proposal:${id}`)!) as Proposal
		const what = p.kind === "agent" ? `the agent @${p.agent.handle}` : `the group "${p.title}"`
		return `your proposal of ${what} waits for the human's answer. if they say yes, call create. if they want changes, propose again.`
	}

	private newestProposal(): string | null {
		const rows = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key LIKE 'proposal:%'").toArray()
		const newest = rows.map((r) => JSON.parse(r.value) as Proposal).sort((a, b) => b.seq - a.seq)[0]
		return newest?.id ?? null
	}

	async createProposal(slug: AgentSlug, id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
		const home = this.home()
		if (!home || slug !== CHIEF) return { ok: false, error: "only yuki makes agents and groups" }
		id ||= this.newestProposal() ?? ""
		const done = this.log.meta(`created:${id}`)
		if (done) return { ok: true, text: done }
		const raw = this.log.meta(`proposal:${id}`)
		if (!raw) return { ok: false, error: `no proposal ${id}. propose first` }
		const proposal = JSON.parse(raw) as Proposal
		const answered = this.ctx.storage.sql
			.exec("SELECT 1 FROM messages WHERE seq > ? AND deleted_at IS NULL AND json_extract(sender, '$.kind') = 'human' LIMIT 1", proposal.seq)
			.toArray().length
		if (!answered) return { ok: false, error: "not yet: show the human what you'll make and wait for their yes. never create on your own." }
		const user = userStub(this.env.USER, home.userId)
		const model = this.members.list().find((m) => m.slug === CHIEF)?.model ?? ""
		const make = async (spec: NewAgentSpec) => {
			const agent = await user.makeAgent({ name: spec.name, slug: spec.handle, description: spec.description, soul: spec.soul, model })
			if (!agent) throw new Error(`@${spec.handle} could not be made (the handle may be taken)`)
			return agent
		}
		let text: string
		try {
			if (proposal.kind === "agent") {
				const agent = await make(proposal.agent)
				const roomId = await user.openChat(agent.name, [agent.id])
				const { event } = this.log.addMessage({ from: { kind: "system", reason: "created" }, text: `yuki made @${agent.slug}. say hi in your new chat.`, goto: roomId })
				if (event) this.publish([event])
				this.ctx.waitUntil(
					roomStub(this.env.ROOM, home.userId, roomId)
						.introduce(home.userId, agent.slug, introduction(proposal.agent))
						.catch((e: unknown) => console.error(`introduce failed: ${e instanceof Error ? e.message : String(e)}`)),
				)
				text = `made @${agent.slug}. the human is taken to its chat now; say one short line, nothing more.`
			} else {
				const mine = await user.listAgents()
				const made = []
				for (const spec of proposal.agents) made.push(await make(spec))
				const members = [...proposal.members.map((m) => mine.find((a) => a.slug === m)!), ...made]
				const chat = await this.chat(home)
				if (chat?.temp) {
					for (const a of members) {
						const role = tagline(a.prompt)
						this.memberOp({ op: "add", slug: a.slug, name: a.name, ...(role ? { role } : {}), ...(a.model ? { model: a.model } : {}) })
					}
					await this.writeChatFile(CHIEF, proposal.chat)
					this.log.setMeta("chat_file", "1")
					await user.keepChat(home.roomId, proposal.title, [CHIEF, ...members.map((a) => a.id)])
					const { event } = this.log.addMessage({ from: { kind: "system", reason: "created" }, text: `yuki started ${proposal.title} with ${members.map((a) => `@${a.slug}`).join(", ")}` })
					if (event) this.publish([event])
					text = `the group is ready, here in this chat, with ${members.map((a) => `@${a.slug}`).join(", ")}. /chat.md holds the plan. kick it off in a line or two.`
				} else {
					const roomId = await user.openChat(proposal.title, [CHIEF, ...members.map((a) => a.id)])
					this.ctx.waitUntil(
						roomStub(this.env.ROOM, home.userId, roomId)
							.startGroup(home.userId, proposal.chat)
							.catch((e: unknown) => console.error(`start group failed: ${e instanceof Error ? e.message : String(e)}`)),
					)
					const { event } = this.log.addMessage({ from: { kind: "system", reason: "created" }, text: `yuki started ${proposal.title}. open it to begin.`, goto: roomId })
					if (event) this.publish([event])
					text = `the group ${proposal.title} is made, in its own chat. say one short line.`
				}
			}
		} catch (error) {
			return { ok: false, error: error instanceof Error ? error.message : String(error) }
		}
		this.log.setMeta(`created:${id}`, text)
		return { ok: true, text }
	}

	async introduce(userId: string, slug: AgentSlug, text: string): Promise<void> {
		const home = this.adopt(userId)
		if (!home) return
		const chat = await this.chat(home)
		if (!chat) return
		await this.seedMembers(home, chat)
		const member = this.members.list().find((m) => m.slug === slug)
		if (!member) return
		const envelope: Envelope = { id: "intro", roomId: home.roomId, from: { kind: "system", reason: "created" }, body: text, hop: 0, rootId: "intro", tainted: false, seq: this.log.lastSeq() }
		const d = this.delivery(member, this.members.list(), chat.title, [envelope])
		await agentStub(this.env.AGENT, home.userId, home.roomId, slug).receive(d.envelopes, d.brief, this.agentHome(home, slug, member))
	}

	async startGroup(userId: string, chatFile: string): Promise<void> {
		const home = this.adopt(userId)
		if (!home) return
		const chat = await this.chat(home)
		if (!chat) return
		await this.seedMembers(home, chat)
		await this.writeChatFile(CHIEF, chatFile)
		this.log.setMeta("chat_file", "1")
	}

	private adopt(userId: string): { userId: string; roomId: RoomId } | null {
		if (this.log.meta("user_id") === null) {
			const name = this.ctx.id.name ?? ""
			const roomId = name.slice(name.lastIndexOf(":") + 1)
			if (name !== `room:${userId}:${roomId}`) return null
			this.log.setMeta("user_id", userId)
			this.log.setMeta("room_id", roomId)
		}
		return this.home()
	}

	private async trySeedChatFile(home: { userId: string; roomId: RoomId }, title: string): Promise<void> {
		await this.seedChatFile(home, title).catch((e: unknown) => console.error(`chat.md seed failed: ${e instanceof Error ? e.message : String(e)}`))
	}

	private async seedChatFile(home: { userId: string; roomId: RoomId }, title: string): Promise<void> {
		if (this.log.meta("chat_file") !== null) return
		const members = this.members.list()
		if (members.length < 2) return
		if (this.files.stat(CHAT_PATH)) return this.log.setMeta("chat_file", "1")
		const team = members.map((m) => `- @${m.slug}: ${[m.lead ? "leads" : "", m.role ?? ""].filter(Boolean).join(". ")}`.trimEnd()).join("\n")
		const lead = members.find((m) => m.lead) ?? members[0]!
		await this.writeChatFile(lead.slug, `# ${title || "this chat"}\n\ngoal:\n\n## who does what\n${team}\n\n## decisions\n`)
		this.log.setMeta("chat_file", "1")
	}

	async alarm(): Promise<void> {
		const due = await this.alarms.dueWakeups(Date.now())
		await runDue(this.alarms, due, {
			[HELLO_WAKEUP]: () => enforceHello(this.ctx, this.alarms),
			[BURST_WAKEUP]: () => this.flush(),
			[WAKES_WAKEUP]: () => this.deliverWakes(),
			[MAIL_WAKEUP]: () => this.drainMail(),
			[MEMORY_WAKEUP]: () => this.naps(),
			[QUIET_WAKEUP]: () => this.rollupQuiet(),
			[ROUTINES_WAKEUP]: () => this.flushRoutineEvents(),
			[LOOPS_WAKEUP]: () => this.sweepStalls(),
			[PENDING_WAKEUP]: () => this.sweepPending(),
			[APPROVALS_WAKEUP]: async () => {
				this.publish(this.approvals.expire())
				await this.deliverApprovals()
				await this.armApprovals()
			},
		}, { retryMs: { [BURST_WAKEUP]: 2_000, [WAKES_WAKEUP]: 2_000, [MAIL_WAKEUP]: 2_000, [ROUTINES_WAKEUP]: 5_000 } })
		if (!due.includes(MAIL_WAKEUP) && this.mail.queued()) await this.drainMail()
	}

	private async flush(): Promise<void> {
		const home = this.home()
		if (!home) return
		const pending = this.burst.envelopes(home.roomId, MAX_DELIVERY_ENVELOPES + 1)
		const envelopes = deliverable(pending)
		if (!envelopes.length) return
		let reached: Set<AgentSlug>
		try {
			const out = await this.deliverBurst(home, envelopes)
			if (out === "full") return await this.burst.retry(DELIVERY_RETRY_MS)
			reached = out
			if (envelopes.length < pending.length) return await this.burst.retry(0)
		} catch (error) {
			console.error(`burst delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			return await this.burst.retry(DELIVERY_RETRY_MS)
		}
		this.closeWarnings(home, reached)
		await this.drainMail()
	}

	private async deliverBurst(home: { userId: string; roomId: RoomId }, envelopes: Envelope[]): Promise<Set<AgentSlug> | "full"> {
		const burstId = envelopes[0]!.id
		const takeTurn = () => (this.log.meta("turn_taken") === burstId ? Promise.resolve({ ok: true } as const) : userStub(this.env.USER, home.userId).takeTurn())
		const known = this.log.meta("title") !== null
		const [chat, turn] = known ? await Promise.all([this.chat(home), takeTurn()]) : await this.chat(home).then(async (c) => [c, c ? await takeTurn() : ({ ok: true } as const)] as const)
		if (!chat) {
			this.burst.clear()
			return new Set()
		}
		if (!turn.ok) {
			const at = new Date(turn.resetAt).toISOString().slice(11, 16)
			const { event } = this.log.addMessage({ from: { kind: "system", reason: "limit" }, text: `you've used today's ${turn.limit} replies. they come back at ${at} utc.` })
			if (event) this.publish([event])
			this.burst.delivered(envelopes)
			return new Set()
		}
		this.log.setMeta("turn_taken", burstId)
		await this.seedMembers(home, chat)
		const members = this.members.list()
		const replyAuthor = (id: string) => {
			const from = this.log.message(id)?.from
			return from?.kind === "agent" ? from.slug : undefined
		}
		const routes = route(envelopes, members, replyAuthor)
		const deliveries = [...routes].map(([slug, mine]) => this.delivery(members.find((m) => m.slug === slug)!, members, chat.title, mine))
		const results = await Promise.allSettled(
			deliveries.map(async ({ member, envelopes: mine, brief, reactionsUpTo }) => {
				const agent = agentStub(this.env.AGENT, home.userId, home.roomId, member.slug)
				const { refused } = await agent.receive(mine, brief, this.agentHome(home, member.slug, member))
				if (refused === "full") return "full"
				if (refused) console.error(`burst delivery to ${member.slug} refused: ${refused}`)
				this.mail.delivered(member.slug, mine)
				markReactionsBriefed(this.log, member.slug, reactionsUpTo)
				return "admitted"
			}),
		)
		const failed = results.find((r) => r.status === "rejected")
		if (failed) throw failed.reason
		if (results.some((r) => r.status === "fulfilled" && r.value === "full")) return "full"
		this.burst.delivered(envelopes)
		if (this.log.meta("private") !== "1") await this.captureHuman(home, envelopes)
		return new Set(routes.keys())
	}

	private async captureHuman(home: { userId: string; roomId: RoomId }, envelopes: Envelope[]): Promise<void> {
		const items = envelopes.flatMap((e) => {
			const message = e.from.kind === "human" ? this.log.message(e.rootId) : null
			return message ? [{ messageId: e.rootId, text: e.body, at: message.at }] : []
		})
		if (!items.length) return
		try {
			await userStub(this.env.USER, home.userId).captureHuman(home.roomId, items)
		} catch (error) {
			console.error(`capture failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	private async forwardForgotten(): Promise<void> {
		const home = this.home()
		if (!home || this.#wiped) return
		const changes = this.memory.changes()
		if (!changes) return
		const user = userStub(this.env.USER, home.userId)
		try {
			if (changes.deleted.length || changes.edited.length) await user.forgetMessages(home.roomId, changes.deleted, this.log.meta("private") === "1" ? [] : changes.edited)
			for (const pos of changes.positions) await user.forgetRoomTurn(home.roomId, pos)
			this.memory.forwarded(changes.upto)
		} catch (error) {
			console.error(`forget failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 30_000)
		}
	}

	#warned = new Set<AgentSlug>()

	private closeWarnings(home: { userId: string; roomId: RoomId }, reached: ReadonlySet<AgentSlug>): void {
		if (this.burst.pending()) return
		for (const slug of this.#warned) {
			if (reached.has(slug)) continue
			this.ctx.waitUntil(
				agentStub(this.env.AGENT, home.userId, home.roomId, slug)
					.humanGone()
					.catch((e: unknown) => console.error(`human gone failed: ${e instanceof Error ? e.message : String(e)}`)),
			)
		}
		this.#warned.clear()
	}

	#woke = false

	private wakeLiveAgents(userId: string, roomId: string): void {
		if (this.#woke) return
		this.#woke = true
		const live = this.ctx.storage.sql
			.exec<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'live:%'")
			.toArray()
			.map((r) => r.key.slice("live:".length) as AgentSlug)
		for (const slug of live) {
			this.ctx.waitUntil(
				agentStub(this.env.AGENT, userId, roomId, slug)
					.wake()
					.then((running) => {
						if (!running) this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", `live:${slug}`)
					})
					.catch((error: unknown) => console.error(`wake failed: ${error instanceof Error ? error.message : String(error)}`)),
			)
		}
	}

	private delivery(member: MemberRow, members: readonly MemberRow[], goal: string, raw: Envelope[]) {
		const envelopes = raw.map((e) => withContext(this.log, e))
		const reactions = reactionBrief(this.log, this.ctx.storage.sql, member.slug)
		const now = Date.now()
		const team = Object.fromEntries(members.map((m) => [m.slug, { doing: this.team.now(m.slug), holds: this.team.held(m.slug, now) }]))
		const human = this.log.meta(HUMAN_HANDLE) ?? undefined
		const proposal = member.slug === CHIEF ? this.openProposal() : null
		const view = { ...readBriefView(this.ctx.storage.sql, member, members, goal, reactions.text), team, ...(human ? { human } : {}), ...(proposal ? { proposal } : {}) }
		return { member, envelopes, brief: buildBrief(member, view), reactionsUpTo: reactions.upTo }
	}

	async agentMessage(slug: AgentSlug, send: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }> {
		return this.sendMail(slug, send, null)
	}

	private async sendMail(slug: AgentSlug, send: AgentSend, askId: string | null): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }> {
		const home = this.home()
		const members = this.members.list()
		if (!home || !members.some((m) => m.slug === slug)) return { ok: false, error: "not sent: you are not a member of this room." }
		const out = this.mail.send(slug, send, members)
		if (out.ok && out.fresh) this.team.doing(slug, `messaging ${send.to === "all" ? "everyone" : `@${send.to}`}`, Date.now())
		this.publish(out.events)
		if (!out.ok) return out
		if (askId) this.asks.sent(askId, out.send.messageId)
		const asked = askId || send.to === "all" ? null : out.fresh ? this.asks.answer(slug, send.to, send.text, send.id, send.tainted) : this.asks.answeredBy(send.id)
		if (asked) {
			this.pushAnswer(home, send.to as AgentSlug, asked, out.send.text, out.send.tainted)
			return { ok: true, to: out.send.recipients }
		}
		this.mail.queue(slug, out.send)
		this.ctx.waitUntil(this.drainMail())
		return { ok: true, to: out.send.recipients }
	}

	private pushAnswer(home: { userId: string; roomId: RoomId }, asker: AgentSlug, askId: string, text: string, tainted: boolean): void {
		this.ctx.waitUntil(
			agentStub(this.env.AGENT, home.userId, home.roomId, asker)
				.askAnswered(askId, text, tainted)
				.catch((e: unknown) => console.error(`ask answer push failed: ${e instanceof Error ? e.message : String(e)}`)),
		)
	}

	async ask(slug: AgentSlug, send: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }> {
		if (send.to === "all") return { ok: false, error: "not sent: ask one agent at a time" }
		if (send.to === slug) return { ok: false, error: "not sent: you cannot ask yourself" }
		if (this.asks.get(send.id) === null && this.asks.waiting(send.to, slug)) {
			return { ok: false, error: `not sent: @${send.to} is waiting for your answer to its question. answer it first with send_message, or in your reply.` }
		}
		this.asks.open(send.id, slug, send.to, Date.now())
		const out = await this.sendMail(slug, send, send.id)
		if (!out.ok) this.asks.close(send.id)
		return out
	}

	async askState(id: string): Promise<AskState | null> {
		return this.asks.get(id)
	}

	async closeAsk(id: string): Promise<AskState | null> {
		return this.asks.close(id)
	}

	private answerAsks(home: { userId: string; roomId: RoomId }, slug: AgentSlug, runId: string, heard: readonly string[]): void {
		const asks = this.asks.unanswered(slug, heard.flatMap((id) => messageIdOf(id) ?? []))
		if (!asks.length) return
		const bubbles = this.ctx.storage.sql
			.exec<{ id: string; seq: number; text: string; tainted: number }>("SELECT id, seq, text, tainted FROM messages WHERE run_id = ? AND deleted_at IS NULL ORDER BY seq", runId)
			.toArray()
		const text = bubbles.map((b) => b.text).join("\n\n").trim()
		if (!text) return
		const last = bubbles.at(-1)!
		const tainted = bubbles.some((b) => b.tainted === 1)
		let relayed = false
		for (const ask of asks) {
			if (!this.asks.settle(ask.id, text, tainted)) continue
			if (ask.state === "open") {
				this.pushAnswer(home, ask.asker, ask.id, text, tainted)
				continue
			}
			const send = this.mail.relay(`answer:${ask.id}`, slug, ask.asker, { id: last.id, seq: last.seq, text, tainted })
			if (send) {
				this.mail.queue(slug, send)
				relayed = true
			}
		}
		if (relayed) this.ctx.waitUntil(this.drainMail())
	}

	#draining = false

	private async drainMail(): Promise<void> {
		const home = this.home()
		if (!home || this.#draining) return
		this.#draining = true
		try {
			for (;;) {
				const queued = this.mail.pending()
				if (!queued.length) return
				const held = this.burstAddressed(home)
				const heads = new Map<AgentSlug, QueuedMail>()
				for (const mail of queued) if (!heads.has(mail.to)) heads.set(mail.to, mail)
				const ready = [...heads.values()].filter((mail) => !held.has(mail.to))
				if (!ready.length) return await this.alarms.setWakeup(MAIL_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
				const results = await Promise.allSettled(ready.map((mail) => this.deliverMail(home, mail)))
				let failed = false
				results.forEach((result, i) => {
					if (result.status === "fulfilled") return this.mail.done(ready[i]!.n)
					failed = true
					console.error(`agent mail delivery failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
				})
				if (failed) return await this.alarms.setWakeup(MAIL_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
			}
		} finally {
			this.#draining = false
		}
	}

	private burstAddressed(home: { userId: string; roomId: RoomId }): Set<AgentSlug> {
		if (!this.burst.pending()) return new Set()
		const replyAuthor = (id: string) => {
			const from = this.log.message(id)?.from
			return from?.kind === "agent" ? from.slug : undefined
		}
		return new Set(route(this.burst.envelopes(home.roomId), this.members.list(), replyAuthor).keys())
	}

	private async warnBusyAgents(messages: readonly { text: string; replyTo?: string }[]): Promise<void> {
		const home = this.home()
		if (!home) return
		const members = this.members.list()
		const to = new Set<AgentSlug>()
		for (const m of messages) {
			const from = m.replyTo ? this.log.message(m.replyTo)?.from : undefined
			for (const slug of resolveRecipients({ text: m.text, ...(from?.kind === "agent" ? { replyToAgent: from.slug } : {}) }, members)) to.add(slug)
		}
		const busy = members.filter((m) => to.has(m.slug) && m.status !== "idle")
		for (const m of busy) this.#warned.add(m.slug)
		await Promise.allSettled(busy.map((m) => agentStub(this.env.AGENT, home.userId, home.roomId, m.slug).humanComing()))
	}

	private async deliverMail(home: { userId: string; roomId: RoomId }, mail: QueuedMail): Promise<void> {
		const members = this.members.list()
		const member = members.find((m) => m.slug === mail.to)
		if (!member || this.mail.stopped(mail.send.rootId)) return
		const d = this.delivery(member, members, await this.title(home), [this.mail.envelope(home.roomId, mail.from, mail.send, mail.to)])
		const { refused } = await agentStub(this.env.AGENT, home.userId, home.roomId, mail.to).receive(d.envelopes, d.brief, this.agentHome(home, mail.to, member))
		if (refused === "full") throw new Error(`${mail.to}'s inbox is full`)
		if (refused) return console.error(`agent message to ${mail.to} refused: ${refused}`)
		this.mail.delivered(mail.to, d.envelopes)
		markReactionsBriefed(this.log, mail.to, d.reactionsUpTo)
	}

	async memoryView(seqs: number[]): Promise<{ text: string; count: number }> {
		const text = this.memory.view(Date.now(), new Set(seqs))
		await this.armMemory()
		return { text, count: this.memory.count() }
	}

	async memorySince(slug: AgentSlug, pos: number, seqs: number[]): Promise<{ text: string; count: number }> {
		const out = this.memory.since(slug, pos, Date.now(), new Set(seqs))
		await this.armMemory()
		return out
	}

	async memoryRecall(query: string): Promise<string[]> {
		return this.memory.recall(query.slice(0, 200), Date.now())
	}

	async memoryZoom(id: string): Promise<string | null> {
		return this.memory.zoom(id, Date.now())
	}

	private async armMemory(): Promise<void> {
		if (this.memory.pending(1).length) await this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 2_000)
		if (this.log.meta("private") !== "1") await this.alarms.setWakeup(QUIET_WAKEUP, Date.now() + QUIET_MS)
	}

	#napping = false

	private async naps(): Promise<void> {
		const home = this.home()
		if (!home || this.#napping) return
		this.#napping = true
		await this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 120_000)
		await this.forwardForgotten()
		const user = userStub(this.env.USER, home.userId)
		const rollup = this.log.meta("private") === "1" ? null : (text: string, tainted: boolean, at: number, span: { lo: number; hi: number }) => user.lifeRollup(home.roomId, text, tainted, at, span)
		const pass = async () => {
			for (let done = 0; done < NAPS_PER_PASS; done += NAPS_AT_ONCE) {
				if (this.members.list().some((m) => m.status !== "idle")) return void (await this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 30_000))
				const spans = this.memory.pending(NAPS_AT_ONCE)
				if (!spans.length) return void (await (this.memory.changes() ? this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 30_000) : this.alarms.clearWakeup(MEMORY_WAKEUP)))
				const outs = await Promise.all(spans.map((span) => this.memory.nap(span, (prompt) => user.compress(prompt), rollup)))
				const retryAt = outs.find((o) => o.retryAt)?.retryAt
				if (retryAt) return void (await this.alarms.setWakeup(MEMORY_WAKEUP, retryAt))
			}
			await this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 1_000)
		}
		this.ctx.waitUntil(
			pass()
				.catch(async (error: unknown) => {
					console.error(`memory summary failed: ${error instanceof Error ? error.message : String(error)}`)
					await this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 60_000)
				})
				.finally(() => {
					this.#napping = false
				}),
		)
	}

	private async rollupQuiet(): Promise<void> {
		const home = this.home()
		if (!home || this.log.meta("private") === "1") return
		const user = userStub(this.env.USER, home.userId)
		const out = await this.memory.rollupQuiet((prompt) => user.compress(prompt), (text, tainted, at, span) => user.lifeRollup(home.roomId, text, tainted, at, span))
		if (out.retryAt) await this.alarms.setWakeup(QUIET_WAKEUP, out.retryAt)
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return new Response("expected a websocket upgrade", { status: 426 })
		}
		const userId = request.headers.get(USER_ID_HEADER)
		const roomId = request.headers.get(ROOM_ID_HEADER)
		if (!userId || !roomId) return new Response("missing room identity", { status: 400 })
		if (this.#closed || this.#wiped) return new Response("account deleted", { status: 410 })
		if (this.log.meta("user_id") === null) {
			const recorded = this.env.USER ? await userStub(this.env.USER, userId).recordRoom(roomId as RoomId) : true
			if (!recorded) return new Response("account deleted", { status: 410 })
			this.log.setMeta("user_id", userId)
			this.log.setMeta("room_id", roomId)
		}
		const handle = request.headers.get(HANDLE_HEADER)
		if (handle && handle !== this.log.meta(HUMAN_HANDLE)) this.log.setMeta(HUMAN_HANDLE, handle)
		const home = this.home()
		if (home && !this.members.seeded()) {
			const chat = await this.chat(home).catch(() => null)
			if (chat) await this.seedMembers(home, chat).catch(() => undefined)
		}
		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
		this.ctx.acceptWebSocket(server)
		server.serializeAttachment({ ready: false, helloBy: helloBy() } satisfies Attachment)
		await enforceHello(this.ctx, this.alarms)
		this.wakeLiveAgents(userId, roomId)
		return new Response(null, { status: 101, webSocket: client })
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		handleFrame(this, ws, message)
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		try {
			ws.close(code, reason)
		} catch {
			// Already closed by the runtime's automatic reply.
		}
	}

	publish(events: readonly RoomEvent[], { touch = true }: { touch?: boolean } = {}): void {
		if (!events.length) return
		this.broadcast({ t: "events", events })
		if (touch && events.some((e) => ROW_EVENTS.has(e.t))) this.touchSoon()
		this.matchRoutines(events)
		if (events.some((e) => e.t === "edit" || e.t === "delete")) this.ctx.waitUntil(this.forwardForgotten())
		if (events.some((e) => e.t === "task" || e.t === "task_removed")) this.ctx.waitUntil(this.tasksChanged())
		for (const e of events) if (e.t === "message" && e.from.kind === "human") this.ctx.waitUntil(this.burst.add(e))
		const human = events.flatMap((e) => (e.t === "message" && e.from.kind === "human" ? [e] : []))
		if (human.length) this.ctx.waitUntil(this.warnBusyAgents(human))
	}

	#touching = false

	private touchSoon(): void {
		if (this.#touching) return
		this.#touching = true
		this.ctx.waitUntil(
			Promise.resolve()
				.then(async () => {
					this.#touching = false
					const home = this.home()
					if (home && !this.#wiped) await userStub(this.env.USER, home.userId).touchChat(home.roomId, chatTouch(this.ctx.storage.sql, this.log))
				})
				.catch((error) => console.error(`touchChat failed: ${error instanceof Error ? error.message : String(error)}`)),
		)
	}

	broadcast(frame: RoomToClient): void {
		for (const ws of this.ctx.getWebSockets()) if (attachment(ws).ready) send(ws, frame)
	}

	search(query: string, options?: SearchOptions) {
		return searchMessages(this.ctx.storage.sql, query, options)
	}

	async deliverReminder(id: string, reminder: ReminderDelivery): Promise<boolean> {
		const event = this.deliveries.reminder(id, reminder)
		if (event) this.publish([event])
		const home = this.home()
		if (event && home && event.t === "message" && this.members.get(reminder.target as AgentSlug)) {
			const own = `reminder:${id}`
			const made = reminder.chain ?? (reminder.createdBy === "human" ? { rootId: own, hop: 0, authority: HUMAN } : null)
			const kept = made && reminder.recurring ? { ...made, rootId: own, hop: 0 } : made
			const chain = reminder.authority ? { rootId: kept?.rootId ?? own, hop: kept?.hop ?? 0, authority: reminder.authority } : kept
			const envelope: Envelope = { id: own, roomId: home.roomId, from: { kind: "system", reason: "reminder" }, body: `reminder: ${reminder.text}`, tainted: false, seq: event.seq, ...this.chained(chain, own) }
			await this.deliverAuto(home, reminder.target as AgentSlug, envelope)
		}
		return event !== null
	}

	private chained(chain: Chain | null, own: string): Pick<Envelope, "rootId" | "hop" | "origin" | "grant"> {
		if (!chain) return { rootId: own, hop: 0, origin: "auto" }
		const stopped = this.mail.stopped(chain.rootId)
		return { rootId: stopped ? own : chain.rootId, hop: stopped ? 0 : chain.hop, ...stamp(chain.authority) }
	}

	async chainOf(slug: AgentSlug): Promise<Chain> {
		return this.mail.chain(slug)
	}

	async setRoutines(list: RoomRoutine[]): Promise<void> {
		this.routines.set(list)
	}

	async deliverRoutine(deliveryId: string, input: { target: string; body: string; tainted: boolean; grant: readonly string[] }): Promise<RunDelivery> {
		const home = this.home()
		if (!home) return "refused"
		if (this.deliveries.seen(deliveryId)) return "duplicate"
		const chat = await this.chat(home)
		if (!chat) return "gone"
		await this.seedMembers(home, chat)
		const slug = input.target as AgentSlug
		if (!this.members.get(slug)) return "gone"
		const id = `routine:${deliveryId}`
		const seq = this.log.lastSeq()
		const envelope: Envelope = { id, roomId: home.roomId, from: { kind: "system", reason: "routine" }, body: input.body, hop: 0, rootId: id, tainted: input.tainted, seq, origin: "routine", grant: input.grant }
		const cut = deliveryId.indexOf(":")
		const run = { routineId: deliveryId.slice(0, cut), occurrence: deliveryId.slice(cut + 1), slug, seq }
		this.routines.follow(run)
		let out: Awaited<ReturnType<RoomDO["deliverAuto"]>>
		try {
			out = await this.deliverAuto(home, slug, envelope, { userPaid: true })
		} catch (error) {
			this.routines.unfollow(run)
			throw error
		}
		if (out !== "delivered") this.routines.unfollow(run)
		if (out === "delivered" || out === "held") this.deliveries.mark(deliveryId)
		return out
	}

	private matchRoutines(events: readonly RoomEvent[]): void {
		const seqs = events.map((e) => e.seq)
		let actors: Map<number, string> | null = null
		const actorOf = (seq: number) => {
			actors ??= new Map(this.ctx.storage.sql.exec<{ seq: number; actor: string }>("SELECT seq, actor FROM events WHERE seq IN (SELECT value FROM json_each(?))", JSON.stringify(seqs)).toArray().map((r) => [r.seq, r.actor]))
			return actors.get(seq) ?? null
		}
		const eventRun = (slug: AgentSlug) => /^routine:[^:]+:(event|hook|watch):/.test(this.mail.chainRoot(slug) ?? "")
		const nameOf = (slug: AgentSlug) => this.members.get(slug)?.name ?? slug
		const cleanMessage = (id: string) => this.ctx.storage.sql.exec<{ tainted: number }>("SELECT tainted FROM messages WHERE id = ?", id).toArray()[0]?.tainted === 0
		const closes = this.routines.add(events, { actorOf, eventRun, nameOf, cleanMessage }, Date.now())
		if (closes !== null) this.ctx.waitUntil(this.alarms.setWakeup(ROUTINES_WAKEUP, closes))
	}

	private async flushRoutineEvents(): Promise<void> {
		const home = this.home()
		if (!home) return
		const user = userStub(this.env.USER, home.userId)
		for (const w of this.routines.due(Date.now())) {
			const lines = [...w.lines, ...(w.more ? ["and more"] : [])].map((l) => `- ${l}`).join("\n")
			await user.routineEvent(w.routineId, `event:${w.openedAt}`, "events in this chat", `what happened:\n${lines}`, w.tainted)
			this.routines.closed(w.routineId)
		}
		const next = this.routines.nextClose()
		if (next !== null) await this.alarms.setWakeup(ROUTINES_WAKEUP, next)
	}

	private reportRuns(runs: readonly Inflight[], status: "ended" | "stopped" | "failed" | "timeout"): void {
		const home = this.home()
		if (!home || !runs.length) return
		const user = userStub(this.env.USER, home.userId)
		for (const r of runs) {
			const posted = status === "ended" ? this.log.lastAgentSeq(r.slug, r.seq) : null
			const outcome = status === "ended" ? (posted !== null ? "ok" : "quiet") : status === "stopped" ? "quiet" : status
			this.ctx.waitUntil(user.routineRunDone(r.routineId, r.occurrence, outcome, posted).catch((e: unknown) => console.error(`routine report failed: ${e instanceof Error ? e.message : String(e)}`)))
		}
	}

	private async tasksChanged(): Promise<void> {
		const home = this.home()
		if (!home) return
		const rows = openTasks(this.ctx.storage.sql)
		await this.armSweep(rows, Date.now())
		const summary = JSON.stringify(chatTasks(rows))
		if (this.log.meta("tasks_reported") === summary) return
		this.log.setMeta("tasks_reported", summary)
		await userStub(this.env.USER, home.userId).chatTasks(home.roomId, chatTasks(rows)).catch(() => {})
	}

	private async armSweep(rows: ReturnType<typeof openTasks>, now: number): Promise<void> {
		const at = nextSweep(rows, now, (id) => this.deliveries.seen(id))
		if (at === null) await this.alarms.clearWakeup(LOOPS_WAKEUP)
		else await this.alarms.setWakeup(LOOPS_WAKEUP, at)
	}

	private async sweepStalls(): Promise<void> {
		const home = this.home()
		const rows = openTasks(this.ctx.storage.sql)
		const now = Date.now()
		if (home) {
			const day = utcDay(now)
			const [countedDay, counted] = (this.log.meta("nudges") ?? ":0").split(":")
			let sent = countedDay === day ? Number(counted) : 0
			const lead = this.members.list().find((m) => m.lead)?.slug ?? null
			for (const n of stalled(rows, lead, now, (id) => this.deliveries.seen(id))) {
				if (sent >= MAX_NUDGES) break
				if (!this.members.get(n.to)) continue
				const envelope: Envelope = { id: n.id, roomId: home.roomId, from: { kind: "system", reason: "stalled" }, body: nudgeBody(n), tainted: false, seq: this.log.lastSeq(), ...this.chained(this.workspace.chainOf(n.taskId), n.id) }
				const out = await this.deliverAuto(home, n.to, envelope)
				if (out === "held") break
				this.deliveries.mark(n.id)
				this.log.setMeta("nudges", `${day}:${++sent}`)
			}
		}
		await this.armSweep(openTasks(this.ctx.storage.sql), now)
	}

	async runTimedOut(slug: AgentSlug): Promise<void> {
		this.reportRuns(this.routines.dropped(slug), "timeout")
	}

	async systemNotice(id: string, text: string, reason: SystemReason = "run_budget"): Promise<void> {
		const event = this.deliveries.notice(id, text, reason)
		if (event) this.publish([event])
	}

	private async deliverAuto(home: { userId: string; roomId: RoomId }, slug: AgentSlug, envelope: Envelope, { userPaid = false } = {}): Promise<"delivered" | "held" | "refused" | "gone"> {
		const members = this.members.list()
		const member = members.find((m) => m.slug === slug)
		if (!member) return "gone"
		const now = Date.now()
		const room = this.mail.reserve(now, envelope.id)
		if (room === "full") return this.budgetHeld(now, "this chat")
		if (room === "ok" && !userPaid) {
			const user = await userStub(this.env.USER, home.userId).takeAutonomous()
			if (!user.ok) {
				this.mail.refund(envelope.id)
				return user.reason === "away" ? "held" : this.budgetHeld(now, "your account")
			}
		}
		const goal = await this.title(home)
		const d = this.delivery(member, members, goal, [envelope])
		const { refused } = await agentStub(this.env.AGENT, home.userId, home.roomId, slug).receive(d.envelopes, d.brief, this.agentHome(home, slug, member))
		if (refused === "full") throw new Error(`${slug}'s inbox is full`)
		if (refused) {
			console.error(`${envelope.from.kind === "system" ? envelope.from.reason : "auto"} delivery to ${slug} refused: ${refused}`)
			return "refused"
		}
		this.mail.delivered(slug, d.envelopes)
		markReactionsBriefed(this.log, slug, d.reactionsUpTo)
		return "delivered"
	}

	private budgetHeld(now: number, whose: string): "held" {
		const event = this.deliveries.notice(`budget:${utcDay(now)}`, BUDGET_LINE(whose))
		if (event) this.publish([event])
		return "held"
	}

	humanSend(frame: Extract<ClientToRoom, { t: "send" }>): { ack: { id: MessageId; seq: number }; events: RoomEvent[] } | { refused: string } {
		const earlier = this.log.sentBefore(frame.clientId)
		if (earlier) return { ack: earlier, events: [] }
		try {
			return this.ctx.storage.transactionSync(() => {
				const claimed = frame.attachments?.length
					? claim(this.pending, this.files, frame.attachments, Date.now())
					: { refs: frame.files?.length ? legacyFiles(this.files, frame.files) : [], events: [] }
				const replyTo = frame.replyTo && this.log.message(frame.replyTo) ? frame.replyTo : undefined
				const stored = this.log.addMessage({
					from: { kind: "human" },
					text: frame.text,
					clientId: frame.clientId,
					...(replyTo ? { replyTo } : {}),
					...(replyTo && frame.quote?.trim() ? { quote: frame.quote.trim() } : {}),
					...(claimed.refs.length ? { files: claimed.refs } : {}),
				})
				return { ack: { id: stored.id, seq: stored.seq }, events: [...claimed.events, ...(stored.event ? [stored.event] : [])] }
			})
		} catch (error) {
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
			if (row.upload_id) await this.env.FILES.resumeMultipartUpload(row.r2_key, row.upload_id).abort().catch(() => {})
		}
		if (stale.length) await deleteFiles(this.env.FILES, stale.map((r) => r.r2_key))
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
		if (by && result.file && !result.conflict && !result.refused) this.working(by, [input.path], `editing /${input.path}`)
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
		if (paths.length) this.working(slug, paths, `editing /${paths[0]}${paths.length > 1 ? ` and ${paths.length - 1} more` : ""}`)
		return { ok: true, events: [], drop: [] }
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

	private working(slug: AgentSlug, paths: readonly string[], doing: string): void {
		const now = Date.now()
		this.team.take(slug, paths, now)
		this.memory.did(slug, doing, now)
		if (this.team.now(slug) === doing) return
		this.team.doing(slug, doing, now)
		const member = this.members.list().find((m) => m.slug === slug)
		if (member) this.broadcast({ t: "status", slug, state: member.status === "idle" ? "working" : member.status, doing })
	}

	private guarded<T extends FsChange<RoomEvent> | FsFail>(slug: AgentSlug, paths: readonly string[], doing: string, act: () => T): T | FsFail {
		const held = this.held(slug, paths)
		if (held) return held
		const out = this.applyFs(act())
		if (out.ok) this.working(slug, paths, doing)
		return out
	}

	async reportDoing(slug: AgentSlug, doing: string): Promise<void> {
		if (this.members.list().some((m) => m.slug === slug)) this.working(slug, [], doing.slice(0, 160))
	}

	async teamNow(): Promise<{ slug: AgentSlug; name: string; status: AgentState; doing: string | null; holds: string[] }[]> {
		const now = Date.now()
		return this.members.list().map((m) => ({ slug: m.slug, name: m.name, status: m.status, doing: this.team.now(m.slug), holds: this.team.held(m.slug, now) }))
	}

	fileOp(op: FileOp): string | null {
		const human = { kind: "human" } as const
		const paths = op.op === "rm" ? op.paths : op.op === "mv" ? [op.from, op.to] : [op.path]
		if (paths.some((p) => cleanPath(p) === null)) return "that is not a path in this chat's files"
		const out = this.applyFs(
			op.op === "rm" ? this.files.remove(op.paths, op.recursive ?? false, human) : op.op === "mv" ? this.files.move(op.from, op.to, human) : this.files.mkdir(op.path, human),
		)
		return out.ok ? null : out.message
	}

	private applyFs<T extends FsChange<RoomEvent> | FsFail>(out: T): T {
		if (!out.ok) return out
		if (out.events.length) this.publish(out.events)
		if (out.drop.length) this.ctx.waitUntil(deleteFiles(this.env.FILES, out.drop).catch((e: unknown) => console.error(`r2 delete failed: ${e instanceof Error ? e.message : String(e)}`)))
		return out
	}

	stop(): void {
		const home = this.home()
		if (!home) return
		this.burst.clear()
		this.mail.stop()
		for (const member of this.members.list()) {
			this.stopAgent(home, member.slug)
			this.reportRuns(this.routines.dropped(member.slug), "stopped")
		}
	}

	private stopAgent(home: { userId: string; roomId: RoomId }, slug: AgentSlug): void {
		const agent = agentStub(this.env.AGENT, home.userId, home.roomId, slug)
		this.ctx.waitUntil(
			agent.stop().then(
				() => undefined,
				(error: unknown) => console.error(`stop failed: ${error instanceof Error ? error.message : String(error)}`),
			),
		)
	}

	memberOp(op: MemberOp): MemberRefusal | null {
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
			const activity: MemberActivity = { seq: this.log.lastSeq(), at: result.events[0]!.at, kind: op.op === "add" ? "joined" : "left", name: op.op === "add" ? op.name : (name ?? op.slug) }
			this.log.setMeta(MEMBER_ACTIVITY, JSON.stringify(activity))
		}
		this.publish([...result.events, ...notice])
		const home = this.home()
		if (op.op === "remove" && home) this.stopAgent(home, op.slug)
		return null
	}

	async spawnAgent(by: AgentSlug, input: SpawnInput): Promise<{ ok: true; slug: AgentSlug } | { ok: false; error: string }> {
		const members = this.members.list()
		const me = members.find((m) => m.slug === by)
		if (!me?.lead) return { ok: false, error: "only the lead can add an agent to this room." }
		const slug = input.slug.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32)
		if (!isAgentSlug(slug)) return { ok: false, error: `"${input.slug}" is not a usable handle. use lowercase letters, digits, and dashes.` }
		const home = this.home()
		if (home) await userStub(this.env.USER, home.userId).seedSoul(slug, input.name?.trim() || slug, input.role)
		if (!members.some((m) => m.slug === slug)) {
			const refused = this.memberOp({ op: "add", slug, name: input.name?.trim() || slug, role: input.role, ...(me.model ? { model: me.model } : {}) })
			if (refused) return { ok: false, error: SPAWN_REFUSAL[refused] }
		}
		await this.workspaceCall(by, { op: "create_task", id: `spawn-${input.id}`.slice(0, 64), title: input.task.slice(0, 140), owner: slug })
		const sent = await this.agentMessage(by, { id: `spawn:${input.id}`, to: slug, text: input.task, tainted: input.tainted })
		return sent.ok ? { ok: true, slug } : sent
	}

	setModel(ref: string, slug?: AgentSlug): void {
		const home = this.home()
		const at = ref.indexOf("/")
		if (!home || at <= 0) return
		const model = { provider: ref.slice(0, at), modelId: ref.slice(at + 1) }
		const targets = this.members.list().filter((m) => !slug || m.slug === slug)
		for (const m of targets) this.ctx.waitUntil(agentStub(this.env.AGENT, home.userId, home.roomId, m.slug).setModel(model).then(() => undefined))
	}

	taskOp(op: TaskOp): void {
		this.publish(applyTaskOp(this.workspace, op, this.members.list().map((m) => m.slug)))
		this.ctx.waitUntil(this.deliverWakes())
	}

	async workspaceCall(slug: AgentSlug, call: WorkspaceCall): Promise<WorkspaceAnswer> {
		const members = this.members.list()
		const member = members.find((m) => m.slug === slug)
		if (!member) return { ok: false, error: "you are not a member of this room" }
		const { answer, events } = runCall(this.workspace, slug, member.lead, call, members.map((m) => m.slug), this.mail.chain(slug))
		this.publish(events)
		this.ctx.waitUntil(this.deliverWakes())
		return answer
	}

	private async deliverWakes(): Promise<void> {
		const home = this.home()
		const wakes = this.workspace.pendingWakes()
		if (!home || !wakes.length) return
		try {
			if (!(await this.chat(home))) return
			for (const wake of wakes) {
				await this.deliverAuto(home, wake.owner, { ...wakeEnvelope(home.roomId, wake), ...this.chained(wake.chain, `unblocked:${wake.taskId}`) })
				this.workspace.markWoken(wake.taskId)
			}
		} catch (error) {
			console.error(`task_unblocked delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.alarms.setWakeup(WAKES_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
		}
	}

	async requestApproval(slug: AgentSlug, req: ApprovalRequest): Promise<ApprovalAnswer> {
		if (!this.members.list().some((m) => m.slug === slug)) return { refused: "not run: you are not a member of this room." }
		const { answer, event } = this.approvals.request(slug, req)
		if (event) {
			this.publish([event])
			await this.armApprovals()
		}
		return answer
	}

	approve(id: string, action: "accept" | "decline"): void {
		const event = this.approvals.decide(id, action)
		if (!event) return
		this.publish([event])
		this.ctx.waitUntil(this.deliverApprovals())
	}

	private async armApprovals(): Promise<void> {
		const at = this.approvals.nextExpiry()
		if (at === null) await this.alarms.clearWakeup(APPROVALS_WAKEUP)
		else await this.alarms.setWakeup(APPROVALS_WAKEUP, at)
	}

	private async deliverApprovals(): Promise<void> {
		const home = this.home()
		if (!home) return
		const results = this.approvals.undelivered(home.roomId)
		if (!results.length) return
		try {
			const chat = await this.chat(home)
			for (const { slug, id, envelope } of results) {
				const members = this.members.list()
				const member = members.find((m) => m.slug === slug)
				if (!member) {
					this.approvals.markDelivered(id)
					continue
				}
				const brief = buildBrief(member, readBriefView(this.ctx.storage.sql, member, members, chat?.title ?? "", null))
				const agent = agentStub(this.env.AGENT, home.userId, home.roomId, slug)
				const { refused } = await agent.receive([envelope], brief, this.agentHome(home, slug, member))
				if (refused === "full") throw new Error("inbox full")
				if (refused) console.error(`approval_result delivery to ${slug} refused: ${refused}`)
				else this.mail.delivered(slug, [envelope])
				this.approvals.markDelivered(id)
			}
		} catch (error) {
			console.error(`approval_result delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.alarms.setWakeup(APPROVALS_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
		}
	}

	humanTyping(): void {
		this.ctx.waitUntil(this.burst.typing())
	}

	async post(slug: AgentSlug, runId: string, attempt: number, index: number, block: string, tainted = false): Promise<boolean> {
		const events = this.bubbles.post(slug, { runId, attempt, index }, block, tainted)
		this.publish(events, { touch: false })
		return events.some((e) => e.t === "message")
	}

	async react(slug: AgentSlug, emoji: string, messageId?: string): Promise<boolean> {
		const event = agentReact(this.log, this.ctx.storage.sql, slug, emoji, messageId)
		if (event) this.publish([event])
		return event !== null
	}

	async noProvider(slug: AgentSlug, provider: string, requestId: string, heard: readonly string[] = []): Promise<boolean> {
		const key = `no_provider:${slug}:${requestId}`
		const event = this.ctx.storage.transactionSync(() => {
			if (this.log.meta(key) !== null) return null
			this.log.setMeta(key, "1")
			return this.log.append(`agent:${slug}`, { t: "no_provider", slug, provider })
		})
		if (event) this.publish([event])
		const home = this.home()
		if (home) {
			const why = `(no answer: @${slug} cannot run, because the human has not connected ${provider}. tell the human, or go on without it.)`
			for (const ask of this.asks.unanswered(slug, heard.flatMap((id) => messageIdOf(id) ?? []))) {
				if (this.asks.settle(ask.id, why, false) && ask.state === "open") this.pushAnswer(home, ask.asker, ask.id, why, false)
			}
		}
		this.reportRuns(this.routines.dropped(slug), "failed")
		return event !== null
	}

	async runDropped(slug: AgentSlug): Promise<void> {
		this.reportRuns(this.routines.dropped(slug), "failed")
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "run_budget" }, text: `@${slug} stopped: its reply kept crashing, so it was dropped. send a message to try again.` })
		if (event) this.publish([event])
		await this.setStatus(slug, "idle")
	}

	async draft(slug: AgentSlug, runId: string, index: number, text: string): Promise<void> {
		this.broadcast({ t: "draft", slug, runId, index, text: replyTag(text).text })
	}

	async setStatus(slug: AgentSlug, state: AgentState): Promise<void> {
		if (state === "idle") this.team.clear(slug)
		else if (this.members.get(slug)?.status === "idle") this.routines.started(slug)
		if (!this.members.setStatus(slug, state)) return
		if (state === "typing" && !this.team.now(slug)) this.team.doing(slug, "writing a reply", Date.now())
		this.broadcast({ t: "status", slug, state, ...(state === "idle" ? {} : { doing: this.team.now(slug) ?? undefined }) })
		await this.setTyping(slug, state !== "idle")
		if (state === "idle") this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", `live:${slug}`)
		else if (this.log.meta(`live:${slug}`) === null) this.log.setMeta(`live:${slug}`, String(this.log.lastSeq()))
	}

	async endRun(slug: AgentSlug, runId: string, heard: readonly string[] = []): Promise<void> {
		const settled = this.bubbles.settle(slug, runId)
		if (settled) this.publish([settled], { touch: false })
		const home = this.home()
		const first = !this.bubbles.ended(runId)
		if (home && first) {
			this.memory.trace(slug, runId, Date.now())
			this.answerAsks(home, slug, runId, heard)
		}
		this.mail.runEnded(slug)
		await this.setStatus(slug, "idle")
		this.reportRuns(this.routines.ended(slug), "ended")
		if (!home || !first) return
		await this.armMemory()
		await userStub(this.env.USER, home.userId).touchChat(home.roomId, chatTouch(this.ctx.storage.sql, this.log))
		this.bubbles.markEnded(runId)
	}

	async setTyping(slug: AgentSlug, typing: boolean): Promise<void> {
		const had = this.typing.has(slug)
		if (typing === had) return
		if (typing) this.typing.add(slug)
		else this.typing.delete(slug)
		this.broadcast({ t: "typing", who: [...this.typing] })
		const home = this.home()
		if (home) {
			const names = [...this.typing].map((s) => this.members.get(s)?.name ?? s)
			this.ctx.waitUntil(
				Promise.resolve()
					.then(() => userStub(this.env.USER, home.userId).chatTyping(home.roomId, names))
					.catch(() => undefined),
			)
		}
	}

	#wiped = false

	async close(): Promise<void> {
		this.#closed = true
		closeSockets(this.ctx)
	}
	#closed = false

	async inventory(): Promise<{ agents: AgentSlug[]; keys: string[] }> {
		if (this.#wiped) return { agents: [], keys: [] }
		const sql = this.ctx.storage.sql
		const agents = this.members.everyone()
		const keys = sql.exec<{ r2_key: string }>("SELECT r2_key FROM ws_files").toArray().map((r) => r.r2_key)
		return { agents, keys: [...keys, ...this.pending.keys()] }
	}

	async deleteAll(): Promise<number> {
		if (this.#wiped) return 0
		const rows = await wipeStorage(this.ctx)
		this.#wiped = true
		return rows
	}

	async storedRows(): Promise<number> {
		return this.#wiped ? 0 : storedRows(this.ctx.storage)
	}

	async devSeed(turns: { from: string; text: string }[]): Promise<number> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		// The log drops a second message for a run it has seen, as a retried post. Each call
		// gets its own run ids, so a second seed into the same room is not mistaken for one.
		const call = crypto.randomUUID()
		for (const [i, t] of turns.entries()) {
			const from: Sender = t.from === "human" ? { kind: "human" } : { kind: "agent", slug: t.from as AgentSlug }
			this.log.addMessage({ from, text: t.text, ...(from.kind === "agent" ? { run: { runId: `seed:${call}:${i}`, attempt: 0, index: 0 } } : {}) })
		}
		const count = this.memory.sync()
		await this.armMemory()
		return count
	}

	async devMemory(): Promise<{ turns: number; pending: number; view: string }> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		const view = this.memory.view(Date.now())
		const pending = this.memory.pending(1_000).length
		if (pending) await this.armMemory()
		return { turns: this.memory.count(), pending, view }
	}

	async devAge(ms: number): Promise<number> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		this.ctx.storage.sql.exec("UPDATE ws_tasks SET updated_at = updated_at - ? WHERE status NOT IN ('done', 'cancelled')", ms)
		await this.sweepStalls()
		return openTasks(this.ctx.storage.sql).length
	}

	/** Development only. Ages every pending upload by `ms` and runs the sweep now (`verify attachments`). Returns how many remain. */
	async devAgePending(ms: number): Promise<number> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		this.pending.age(ms)
		await this.sweepPending()
		return this.pending.count()
	}

	async devAgentMessage(slug: AgentSlug, text: string): Promise<void> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		const added = this.members.apply({ op: "add", slug, name: slug })
		if (added.ok) this.publish(added.events)
		const { event } = this.log.addMessage({ from: { kind: "agent", slug }, text })
		if (event) this.publish([event])
	}
}
