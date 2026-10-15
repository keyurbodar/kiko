import { humanAnswerText, MAX_MESSAGE_TEXT, sendFits, isAgentSlug, linkAttachments, oneLine, tagline } from "@kiko/protocol"
import type { Activity, HumanAnswers, HumanQuestion, AgentSlug, AgentState, Chat, ClientToRoom, Envelope, FileOp, MemberOp, MemberRefusal, MessageId, RoomEvent, RoomId, RoomToClient, SystemReason, TaskOp, WorkerRow } from "@kiko/protocol"
import { DurableObject } from "cloudflare:workers"
import { instrument, loadRoomDev } from "../lib/dev-guard"
import type { Env } from "../index"
import { type Alarms, createAlarms, runDue } from "@kiko/durable/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "@kiko/durable/hello-deadline"
import { RoomRoutines } from "./routines"
import { SignalWindow, SIGNALS_WAKEUP } from "./signals"
import type { Wake, WakeResult } from "./wake"

import { chatTasks, openTasks } from "./open-tasks"
import type { RoomRoutine } from "../user/routines"
import { agentStub, HANDLE_HEADER, ROOM_ID_HEADER, USER_ID_HEADER, userStub } from "../lib/names"
import { sha256Hex } from "@kiko/durable/hash"
import { BURST_WAKEUP, Burst } from "./burst"
import { buildBrief, readBriefView } from "./brief"
import { RoomMemory } from "./memory"
import { Asks, type AskState } from "./asks"
import { Bubbles, replyTag } from "./bubbles"
import { chatTouch, HUMAN_HANDLE, MEMBER_ACTIVITY, type MemberActivity } from "./chat-touch"
import { Deliveries, type ReminderDelivery, withContext } from "./deliver"
import { type AgentSend, type Chain, Mail } from "./mail"
import { cleanPath, deleteFiles, fileKey } from "../files/upload"
import { changePaths, type CommitResult, type FileIndex, type IndexChange } from "../files/file-index"
import { CHAT_PATH } from "../files/room-fs"
import { Team } from "./team"
import { CHIEF, type ProposalInput } from "./chief"
import { type FsChange, type FsEntry, type FsFail, type NewFile, type PutResult, roomFiles } from "./files"
import { isPrivate, RoomLog } from "./log"
import { cleanOptions, HumanAsks, MAX_QUESTION } from "./human-asks"
import { readWorkers, statusOf, workersKey } from "./status"
import { workerMessages } from "./work-events"
import { parseRichText } from "./rich-text"
import { type MemberRow, Members, type NewMember } from "./members"
import { agentReact, reactionBrief } from "./reactions"
import { attachmentPath, claim, ClaimRefused, type NewPending, PENDING_TTL_MS, PENDING_WAKEUP, PendingUploads } from "./pending"
import { bubbleOf, discardWhole, putWhole, WHOLE_NAME, WHOLE_TYPE, type WholeText } from "./whole-text"
import { tags } from "./recipients"
import { migrate } from "@kiko/durable/migrate"
import { ROOM_STEPS } from "./schema"
import { searchMessages, type SearchOptions } from "./search"
import { type Attachment, attachment, handleFrame, send, type SocketRoom } from "./socket"
import type { RoomDev } from "./dev"
import { MemoryNaps, MEMORY_WAKEUP, QUIET_WAKEUP } from "./memory-naps"
import { applyTaskOp, RoomWorkspace, runCall, type WorkspaceAnswer, type WorkspaceCall } from "./workspace"
import { Reports } from "./reports"
import { Proposals } from "./proposals"
import type { ReceiveDeps } from "./receive"
import type { AgentHome, Home } from "./home"
import { RoomWakes, WAKES_WAKEUP } from "./wake-delivery"
import { MAIL_WAKEUP, RoomMail } from "./mail-drain"
import { BurstFlush } from "./burst-flush"

const MAX_DOING = 160
const DELEGATED_TITLE = 100
const edit = (caption: string): Activity => ({ kind: "tool", tool: "edit", caption })

export const DEFAULT_AGENT = CHIEF
const CHIEF_NAME = "Kiko"
export type { AgentHome }


const ROW_EVENTS: ReadonlySet<RoomEvent["t"]> = new Set(["message", "edit", "delete", "react", "read", "member", "member_removed"])

type SendOutcome = { ack: { id: MessageId; seq: number }; events: RoomEvent[] } | { refused: string }

export class RoomDO extends DurableObject<Env> implements SocketRoom {
	log!: RoomLog
	private burstFlush!: BurstFlush
	private deliveries!: Deliveries
	private alarms!: Alarms
	private burst!: Burst
	private bubbles!: Bubbles
	private mail!: Mail
	private memory!: RoomMemory
	private memoryNaps!: MemoryNaps
	private proposals!: Proposals
	private asks!: Asks
	private humanAsks!: HumanAsks
	members!: Members
	files!: FileIndex<RoomEvent>
	team!: Team
	workspace!: RoomWorkspace
	private routines!: RoomRoutines
	private signals!: SignalWindow
	private reports!: Reports
	private wakes!: RoomWakes
	private mailer!: RoomMail
	private receiver!: ReceiveDeps
	private pending!: PendingUploads
	private readonly typing = new Set<AgentSlug>()
	private sends: Promise<unknown> = Promise.resolve()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		instrument(ctx, "room")
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
		void ctx.blockConcurrencyWhile(async () => {
			migrate(ctx.storage, ROOM_STEPS)
			this.log = new RoomLog(ctx.storage)
			this.deliveries = new Deliveries(ctx.storage, this.log)
			this.files = roomFiles(ctx.storage, this.log)
			this.team = new Team(ctx.storage.sql)
			this.alarms = createAlarms(ctx)
			this.burst = new Burst(ctx.storage, this.alarms)
			this.bubbles = new Bubbles(ctx.storage, this.log)
			this.asks = new Asks(ctx.storage.sql)
			this.humanAsks = new HumanAsks(ctx.storage.sql)
			this.mail = new Mail(ctx.storage, this.log, this.asks, (slug) => (this.members.get(slug)?.status ?? "idle") !== "idle")
			this.receiver = {
				env: this.env,
				log: this.log,
				mail: this.mail,
				deliveries: this.deliveries,
				publish: (events) => this.publish(events),
				agentHome: (home, slug, member) => this.agentHome(home, slug, member),
				delivery: (member, members, goal, raw) => this.delivery(member, members, goal, raw),
			}
			this.members = new Members(ctx.storage, this.log)
			this.workspace = new RoomWorkspace(ctx.storage, this.log)
			this.routines = new RoomRoutines(ctx.storage.sql, { get: (key) => this.log.meta(key), set: (key, value) => this.log.setMeta(key, value) })
			this.memory = new RoomMemory(ctx.storage, { get: (key) => this.log.meta(key), set: (key, value) => this.log.setMeta(key, value) })
			this.memoryNaps = new MemoryNaps({ ctx, env: this.env, alarms: this.alarms, log: this.log, members: this.members, memory: this.memory, home: () => this.home() })
			this.proposals = new Proposals({ ctx, env: this.env, log: this.log, members: this.members, home: () => this.home(), publish: (events) => this.publish(events) })
			this.pending = new PendingUploads(ctx.storage.sql)
			this.signals = new SignalWindow(ctx.storage.sql, () => this.log.meta("room_id"))
			this.reports = new Reports({ ctx, env: this.env, alarms: this.alarms, log: this.log, members: this.members, mail: this.mail, routines: this.routines, signals: this.signals, home: () => this.home() })
			this.wakes = new RoomWakes({
				env: this.env,
				log: this.log,
				members: this.members,
				mail: this.mail,
				deliveries: this.deliveries,
				routines: this.routines,
				alarms: this.alarms,
				workspace: this.workspace,
				burst: this.burst,
				home: () => this.home(),
				chat: (home) => this.chat(home),
				seedMembers: (home, chat) => this.seedMembers(home, chat),
				publish: (events) => this.publish(events),
				receiver: this.receiver,
			})
			this.mailer = new RoomMail({
				...this.receiver,
				ctx,
				members: this.members,
				burst: this.burst,
				asks: this.asks,
				team: this.team,
				alarms: this.alarms,
				home: () => this.home(),
				title: (home) => this.title(home),
			})
			this.burstFlush = new BurstFlush({
				...this.receiver,
				ctx,
				members: this.members,
				burst: this.burst,
				home: () => this.home(),
				chat: (home) => this.chat(home),
				seedMembers: (home, chat) => this.seedMembers(home, chat),
				drainMail: () => this.mailer.drain(),
			})
		})
	}

	private home(): Home | null {
		const userId = this.log.meta("user_id")
		const roomId = this.log.meta("room_id")
		return userId && roomId ? { userId, roomId: roomId as RoomId } : null
	}

	private async chat(home: Home): Promise<Chat | null> {
		const chat = await userStub(this.env.USER, home.userId).getChat(home.roomId)
		if (chat) this.remember(chat)
		return chat
	}

	private remember(chat: Chat): void {
		this.setPrivate(chat.private ?? false)
		if (this.log.meta("title") !== chat.title) this.log.setMeta("title", chat.title)
	}

	private async title(home: Home): Promise<string> {
		return this.log.meta("title") ?? (await this.chat(home))?.title ?? ""
	}

	setPrivate(value: boolean): void {
		if ((this.log.meta("private") === "1") !== value) this.log.setMeta("private", value ? "1" : "0")
	}

	private agentHome(home: Home, slug: AgentSlug, member: { role?: string; lead: boolean }): AgentHome {
		return { ...home, slug, role: member.role, lead: member.lead, private: this.log.meta("private") === "1" }
	}

	private async seedMembers(home: Home, chat: Chat): Promise<void> {
		if (this.members.seeded()) return this.trySeedChatFile(chat.title)
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
		await this.trySeedChatFile(chat.title)
	}

	async writeChatFile(author: AgentSlug, text: string): Promise<boolean> {
		const home = this.home()
		if (!home) return false
		const body = new TextEncoder().encode(text)
		const id = crypto.randomUUID()
		const r2Key = fileKey(home.userId, home.roomId, id)
		const sha256 = await sha256Hex(body)
		await this.env.FILES.put(r2Key, body, { httpMetadata: { contentType: "text/markdown" } })
		const { drop, file, events } = this.files.put({ id, path: CHAT_PATH, r2Key, size: body.length, type: "text/markdown", sha256, author: { kind: "agent", slug: author }, expectSha256: "none" })
		if (events.length) this.publish(events)
		if (drop) await deleteFiles(this.env.FILES, drop)
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
		// Chat model picks live in AgentDO; the member row keeps only its original model.
		const model = await agentStub(this.env.AGENT, home.userId, home.roomId, member.slug).model()
		return `${model.provider}/${model.modelId}`
	}

	async propose(slug: AgentSlug, input: ProposalInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		return this.proposals.propose(slug, input)
	}

	async createProposal(slug: AgentSlug, id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
		return this.proposals.create(slug, id)
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

	private adopt(userId: string): Home | null {
		if (this.log.meta("user_id") === null) {
			const name = this.ctx.id.name ?? ""
			const roomId = name.slice(name.lastIndexOf(":") + 1)
			if (name !== `room:${userId}:${roomId}`) return null
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
		const due = await this.alarms.dueWakeups(Date.now())
		await runDue(this.alarms, due, {
			[HELLO_WAKEUP]: () => enforceHello(this.ctx, this.alarms),
			[BURST_WAKEUP]: () => this.burstFlush.flush(),
			[WAKES_WAKEUP]: () => this.deliverWakes(),
			[MAIL_WAKEUP]: () => this.mailer.drain(),
			[MEMORY_WAKEUP]: () => this.memoryNaps.naps(),
			[QUIET_WAKEUP]: () => this.memoryNaps.rollupQuiet(),
			[SIGNALS_WAKEUP]: () => this.reports.flush(),
			[PENDING_WAKEUP]: () => this.sweepPending(),
		}, { retryMs: { [BURST_WAKEUP]: 2_000, [WAKES_WAKEUP]: 2_000, [MAIL_WAKEUP]: 2_000, [SIGNALS_WAKEUP]: 5_000 } })
		if (!due.includes(MAIL_WAKEUP) && this.mail.queued()) await this.mailer.drain()
	}

	private async captureAnswer(home: Home, slug: AgentSlug, runId: string): Promise<void> {
		if (this.log.meta("private") === "1") return
		const items = this.ctx.storage.sql
			.exec<{ id: string; text: string; at: number }>("SELECT id, text, at FROM messages WHERE run_id = ? AND deleted_at IS NULL ORDER BY seq", runId)
			.toArray()
		if (!items.length) return
		try {
			const last = items.at(-1)
			if (!last) return
			await userStub(this.env.USER, home.userId).loopsAnswer(home.roomId, slug, [{ messageId: last.id, text: items.map((m) => m.text).join("\n"), at: last.at }])
		} catch (error) {
			console.error(`answer capture failed: ${error instanceof Error ? error.message : String(error)}`)
		}
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
		const proposal = member.slug === CHIEF ? this.proposals.open() : null
		const view = { ...readBriefView(this.ctx.storage.sql, member, members, goal, reactions.text), team, ...(human ? { human } : {}), ...(proposal ? { proposal } : {}) }
		return { member, envelopes, brief: buildBrief(member, view), reactionsUpTo: reactions.upTo }
	}

	async agentMessage(slug: AgentSlug, send: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }> {
		return this.mailer.send(slug, send, null)
	}

	async ask(slug: AgentSlug, send: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }> {
		if (send.to === "all") return { ok: false, error: "not sent: ask one agent at a time" }
		if (send.to === slug) return { ok: false, error: "not sent: you cannot ask yourself" }
		if (this.asks.get(send.id) === null && this.asks.waiting(send.to, slug)) {
			return { ok: false, error: `not sent: @${send.to} is waiting for your answer to its question. answer it first with send_message, or in your reply.` }
		}
		this.asks.open(send.id, slug, send.to, Date.now())
		const out = await this.mailer.send(slug, send, send.id)
		if (!out.ok) this.asks.close(send.id)
		return out
	}

	async askState(id: string): Promise<AskState | null> {
		return this.asks.get(id)
	}

	async closeAsk(id: string): Promise<AskState | null> {
		return this.asks.close(id)
	}

	async askHuman(slug: AgentSlug, input: { id: string; question?: string; options?: readonly string[]; questions?: readonly HumanQuestion[] }): Promise<{ ok: true } | { ok: false; error: string }> {
		if (!this.members.get(slug)) return { ok: false, error: "you are not a member of this room" }
		const questions = input.questions
		if (questions && (
			!questions.length || questions.length > 8 ||
			new Set(questions.map((q) => q.id)).size !== questions.length ||
			questions.some((q) =>
				!q.id.trim() || !q.header.trim() || q.header.length > 120 ||
				!q.question.trim() || q.question.length > MAX_QUESTION ||
				q.options.length > 8 || (!q.options.length && q.allowCustomAnswer === false) ||
				new Set(q.options.map((o) => o.value ?? o.label)).size !== q.options.length ||
				q.options.some((o) => !o.label.trim() || o.label.length > 120 || (o.description?.length ?? 0) > MAX_QUESTION),
			)
		)) return { ok: false, error: "provide 1 to 8 questions with unique ids, short headers, and distinct options" }
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
		const heard = home ? await agentStub(this.env.AGENT, home.userId, home.roomId, ask.from).askAnswered(id, text).catch(() => false) : false
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
		if (home) await agentStub(this.env.AGENT, home.userId, home.roomId, ask.from).askAnswered(id, "").catch(() => false)
	}

	private resolveAsk(id: string, how: "answered" | "skipped", answer: string | null): RoomEvent | null {
		return this.ctx.storage.transactionSync(() => (this.humanAsks.resolve(id, how, answer) ? this.log.append("human", { t: "ask_resolved", id, how }) : null))
	}

	async memoryView(seqs: number[]): Promise<{ text: string; count: number }> {
		const out = this.memoryNaps.view(seqs)
		await this.memoryNaps.arm()
		return out
	}

	async memorySince(slug: AgentSlug, pos: number, seqs: number[]): Promise<{ text: string; count: number }> {
		const out = this.memoryNaps.since(slug, pos, seqs)
		await this.memoryNaps.arm()
		return out
	}

	async memoryRecall(query: string, seen?: number, skip: number[] = []): Promise<string[]> {
		return this.memoryNaps.recall(query, seen, skip)
	}

	async memoryZoom(id: string): Promise<string | null> {
		return this.memoryNaps.zoom(id)
	}




	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return new Response("expected a websocket upgrade", { status: 426 })
		}
		const userId = request.headers.get(USER_ID_HEADER)
		const roomId = request.headers.get(ROOM_ID_HEADER)
		if (!userId || !roomId) return new Response("missing room identity", { status: 400 })
		if (this.log.meta("user_id") === null) {
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
		await handleFrame(this, ws, message)
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		try {
			ws.close(code, reason)
		} catch {
		}
	}

	publish(events: readonly RoomEvent[], { touch = true, deliver = true }: { touch?: boolean; deliver?: boolean } = {}): void {
		if (!events.length) return
		this.broadcast({ t: "events", events })
		if (touch && events.some((e) => ROW_EVENTS.has(e.t))) this.touchSoon()
		this.reports.gather(events)
		if (events.some((e) => e.t === "edit" || e.t === "delete")) this.ctx.waitUntil(this.memoryNaps.forget())
		if (events.some((e) => e.t === "task" || e.t === "task_removed")) this.ctx.waitUntil(this.tasksChanged())
		const human = deliver ? events.flatMap((e) => (e.t === "message" && e.from.kind === "human" ? [e.text] : [])) : []
		const last = human.at(-1)
		if (last !== undefined) {
			this.ctx.waitUntil(this.burst.arm(last))
			this.ctx.waitUntil(this.burstFlush.warnBusyAgents())
		}
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
					if (home) await userStub(this.env.USER, home.userId).touchChat(home.roomId, chatTouch(this.ctx.storage.sql, this.log))
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

	deliverReminder(id: string, reminder: ReminderDelivery): Promise<WakeResult | "posted"> {
		return this.wakes.deliverReminder(id, reminder)
	}

	initiativeWake(input: { id: string; to: AgentSlug | null; body: string; reason: string }): Promise<WakeResult | "busy"> {
		return this.wakes.initiativeWake(input)
	}

	deliverRoutine(deliveryId: string, input: { target: string; body: string }): Promise<WakeResult> {
		return this.wakes.deliverRoutine(deliveryId, input)
	}

	async chainOf(slug: AgentSlug): Promise<Chain> {
		return this.mail.chain(slug)
	}

	async setRoutines(list: RoomRoutine[]): Promise<void> {
		this.routines.set(list)
	}

	private async tasksChanged(): Promise<void> {
		const home = this.home()
		if (!home) return
		const rows = openTasks(this.ctx.storage.sql)
		const summary = JSON.stringify(chatTasks(rows))
		if (this.log.meta("tasks_reported") === summary) return
		this.log.setMeta("tasks_reported", summary)
		await userStub(this.env.USER, home.userId).chatTasks(home.roomId, chatTasks(rows)).catch(() => {})
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
		const text = bubbleOf(frame.text)
		let whole: WholeText | null = null
		try {
			if (text.length < frame.text.length && !this.log.sentBefore(frame.clientId)) {
				const home = this.home()
				if (!home) throw new ClaimRefused("This chat is not ready. Send again in a moment.")
				whole = await putWhole(this.env.FILES, home, frame.clientId, frame.text)
			}
			return this.ctx.storage.transactionSync(() => {
				const earlier = this.log.sentBefore(frame.clientId)
				if (earlier) return { ack: earlier, events: [] }
				const now = Date.now()
				const claimed = frame.attachments?.length ? claim(this.pending, this.files, frame.attachments, now) : { refs: [], events: [] }
				const filed = whole
					? this.files.put({ id: whole.id, path: attachmentPath(WHOLE_NAME, now, (p) => this.files.stat(p) !== null), r2Key: whole.r2Key, size: whole.size, type: WHOLE_TYPE, sha256: whole.sha256, author: { kind: "human" }, expectSha256: "none" })
					: null
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
		} catch (error) {
			if (whole) await discardWhole(this.env.FILES, whole).catch((e: unknown) => console.error(`whole text delete failed: ${e instanceof Error ? e.message : String(e)}`))
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
		const member = this.members.list().find((m) => m.slug === slug)
		if (member) this.broadcast({ t: "status", slug, state: member.status === "idle" ? "working" : member.status, doing, activity })
	}

	private guarded<T extends FsChange<RoomEvent> | FsFail>(slug: AgentSlug, paths: readonly string[], doing: string, act: () => T): T | FsFail {
		const held = this.held(slug, paths)
		if (held) return held
		const out = this.applyFs(act())
		if (out.ok) this.working(slug, paths, doing, edit(doing))
		return out
	}

	async reportDoing(slug: AgentSlug, doing: string, activity: Activity): Promise<void> {
		if (!this.members.list().some((m) => m.slug === slug)) return
		const caption = doing.slice(0, MAX_DOING)
		this.working(slug, [], caption, "caption" in activity ? { ...activity, caption } : activity)
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

	/** The human's messages still in the burst window are not dropped: they go out after the stop, as sent. */
	stop(): void {
		const home = this.home()
		if (!home) return
		this.mail.stop()
		for (const member of this.members.list()) {
			this.stopAgent(home, member.slug)
			this.reports.run(this.routines.dropped(member.slug), "stopped")
		}
	}

	private stopAgent(home: Home, slug: AgentSlug): void {
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
			const activity: MemberActivity = { seq: this.log.lastSeq(), at: result.events[0]?.at ?? 0, kind: op.op === "add" ? "joined" : "left", name: op.op === "add" ? op.name : (name ?? op.slug) }
			this.log.setMeta(MEMBER_ACTIVITY, JSON.stringify(activity))
		}
		this.publish([...result.events, ...notice])
		const home = this.home()
		if (op.op === "remove" && home) this.stopAgent(home, op.slug)
		return null
	}

	setModel(ref: string, slug?: AgentSlug): void {
		const home = this.home()
		const at = ref.indexOf("/")
		if (!home || at <= 0) return
		const model = { provider: ref.slice(0, at), modelId: ref.slice(at + 1) }
		const targets = this.members.list().filter((m) => !slug || m.slug === slug)
		for (const m of targets) this.ctx.waitUntil(agentStub(this.env.AGENT, home.userId, home.roomId, m.slug).setModel(model).then(() => undefined))
	}

	taskOp(op: TaskOp): string | null {
		let reason: string | null = null
		this.publish(applyTaskOp(this.workspace, op, this.members.list().map((m) => m.slug), (error) => { reason = error }))
		this.ctx.waitUntil(this.deliverWakes())
		return reason
	}

	async workspaceCall(slug: AgentSlug, call: WorkspaceCall): Promise<WorkspaceAnswer> {
		const members = this.members.list()
		const member = members.find((m) => m.slug === slug)
		if (!member) return { ok: false, error: "you are not a member of this room" }
		const { answer, events } = this.ctx.storage.transactionSync(() => {
			const result = runCall(this.workspace, slug, member.lead, call, members.map((m) => m.slug), this.mail.chain(slug))
			const lead = members.find((m) => m.lead)
			if (lead && lead.slug !== slug) for (const event of result.events) {
				if (event.t === "task" && (event.task.status === "review" || event.task.status === "done" || event.task.status === "blocked")) this.workspace.queueReport(event, slug, lead.slug)
			}
			return result
		})
		this.publish(events)
		if (events.length) await this.alarms.setWakeup(WAKES_WAKEUP, Date.now())
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
			const event = this.log.append(`agent:${slug}`, { t: "no_provider", slug, provider })
			this.log.setMeta(key, String(event.seq))
			return event
		})
		if (event) this.publish([event])
		const home = this.home()
		if (home) {
			const why = `(no answer: @${slug} cannot run, because the human has not connected ${provider}. tell the human, or go on without it.)`
			this.mailer.answerHeard(home, slug, heard, why, { id: key, seq: Number(this.log.meta(key)) })
		}
		this.reports.run(this.routines.dropped(slug), "failed")
		return event !== null
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

	async setStatus(slug: AgentSlug, state: AgentState): Promise<boolean> {
		if (state === "idle") {
			this.team.clear(slug)
			this.reports.run(this.routines.ended(slug), "ended")
		}
		else if (this.members.get(slug)?.status === "idle") this.routines.started(slug, this.log.lastSeq())
		if (!this.members.setStatus(slug, state)) return false
		if (state === "typing" && !this.team.now(slug)) this.team.doing(slug, "writing a reply", Date.now(), { kind: "writing" })
		this.broadcastStatus(slug)
		await this.setTyping(slug, state !== "idle")
		if (state === "idle") this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", `live:${slug}`)
		else if (this.log.meta(`live:${slug}`) === null) this.log.setMeta(`live:${slug}`, String(this.log.lastSeq()))
		return true
	}

	private broadcastStatus(slug: AgentSlug): void {
		const status = statusOf(this.ctx.storage.sql, slug)
		if (status) this.broadcast({ t: "status", ...status })
	}

	async setWorkers(slug: AgentSlug, rows: readonly WorkerRow[]): Promise<void> {
		const member = this.members.get(slug)
		if (!member) return
		const next = JSON.stringify(rows)
		if (this.log.meta(workersKey(slug)) === next) return
		const before = readWorkers(this.ctx.storage.sql, slug)
		const events = this.ctx.storage.transactionSync(() => {
			this.log.setMeta(workersKey(slug), next)
			return workerMessages(slug, before, rows).flatMap((m) => {
				const { event } = this.log.addMessage(m)
				return event ? [event] : []
			})
		})
		this.publish(events)
		if (member.status !== "idle") this.broadcastStatus(slug)
	}

	async endRun(slug: AgentSlug, runId: string, heard: readonly string[] = [], working = false): Promise<void> {
		const settled = this.bubbles.settle(slug, runId)
		if (settled) this.publish([settled], { touch: false })
		const home = this.home()
		const first = !this.bubbles.ended(runId)
		if (home && first) {
			this.memory.trace(slug, runId, Date.now())
			this.mailer.answerAsks(home, slug, runId, heard)
		}
		this.mail.runEnded(slug)
		if (working) this.team.clearDoing(slug)
		const changed = await this.setStatus(slug, working ? "working" : "idle")
		if (working && !changed) this.broadcastStatus(slug)
		if (!home || !first) return
		await this.captureAnswer(home, slug, runId)
		await this.memoryNaps.arm()
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

	// The dev-only bodies live in room/dev.ts, which only a development build can load. One cached load
	// per object reaches every dev method below.
	private devCache?: Promise<RoomDev>

	private dev(): Promise<RoomDev> {
		this.devCache ??= loadRoomDev().then((m) => new m.RoomDev({
			sql: this.ctx.storage.sql,
			log: this.log,
			members: this.members,
			memory: this.memory,
			pending: this.pending,
			publish: (events) => this.publish(events),
			armMemory: () => this.memoryNaps.arm(),
			rollupQuiet: () => this.memoryNaps.rollupQuiet(),
			tasksChanged: () => this.tasksChanged(),
			sweepPending: () => this.sweepPending(),
		}))
		return this.devCache
	}

	async devSeed(turns: { from: string; text: string }[]): Promise<number> {
		return (await this.dev()).seed(turns)
	}

	async devMemory(): Promise<{ turns: number; pending: number; view: string }> {
		return (await this.dev()).memory()
	}

	async devQuiet(): Promise<void> {
		return (await this.dev()).quiet()
	}

	async devAge(ms: number): Promise<number> {
		return (await this.dev()).age(ms)
	}

	async devAgePending(ms: number): Promise<number> {
		return (await this.dev()).agePending(ms)
	}

	async browserShare(slug: AgentSlug, reason: string): Promise<boolean> {
		const member = this.members.get(slug)
		if (!member) return false
		const { event } = this.log.addMessage({ from: { kind: "agent", slug }, text: reason })
		if (event) this.publish([event])
		return true
	}

}
