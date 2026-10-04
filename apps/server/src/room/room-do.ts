import { isAgentSlug, tagline } from "@kiko/protocol"
import type { AgentSlug, AgentState, Chat, Envelope, FileOp, FileRef, MemberOp, MemberRefusal, RoomEvent, RoomId, RoomToClient, Sender, TaskOp } from "@kiko/protocol"
import { DurableObject } from "cloudflare:workers"
import { instrument } from "../lib/dev-stats"
import type { Env } from "../index"
import { type Alarms, createAlarms, runDue } from "../lib/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "../lib/hello-deadline"
import { agentStub, HANDLE_HEADER, ROOM_ID_HEADER, USER_ID_HEADER, userStub, roomStub } from "../lib/names"
import { closeSockets, storedRows, wipeStorage } from "../lib/wipe"
import { type ApprovalAnswer, APPROVALS_WAKEUP, type ApprovalRequest, RoomApprovals } from "./approvals"
import { BURST_WAKEUP, Burst, deliverable, MAX_DELIVERY_ENVELOPES } from "./burst"
import { buildBrief, readBriefView } from "./brief"
import { RoomMemory } from "./memory"
import { Asks, type AskState } from "./asks"
import { type AgentSend, attachedLine, Bubbles, chatTouch, Deliveries, HUMAN_HANDLE, Mail, MEMBER_ACTIVITY, type MemberActivity, type ReminderDelivery, replyTag, route } from "./deliver"
import { cleanPath, deleteFiles, fileKey } from "../files/upload"
import type { FileIndex } from "../files/file-index"
import { CHAT_PATH } from "../files/room-fs"
import { Team } from "./team"
import { CHIEF, checkProposal, introduction, type NewAgentSpec, type Proposal, type ProposalInput } from "./chief"
import { type FileMeta, type FileMetaPatch, type FsChange, type FsEntry, type FsFail, type NewFile, type PutResult, roomFiles } from "./files"
import { attachPreview, humanWrote, previewTarget } from "./link-preview"
import { RoomLog } from "./log"
import { type MemberRow, Members, type NewMember } from "./members"
import { agentReact, markReactionsBriefed, reactionBrief } from "./reactions"
import { migrate } from "./schema"
import { listCatalog } from "./catalog"
import { searchMessages, type SearchOptions } from "./search"
import { type Attachment, attachment, handleFrame, send, type SocketRoom } from "./socket"
import { applyTaskOp, RoomWorkspace, runCall, wakeEnvelope, type WorkspaceAnswer, type WorkspaceCall } from "./workspace"

declare const process: { env: { NODE_ENV?: string } }

// Architecture sections 4.1 and 9. One room per chat. This file holds the
// socket entry points and the broadcast. The log is in log.ts, frames in socket.ts.

/**
 * ASSUMPTION: a chat created without agents gets one member with this slug, as its lead. A chat
 * created with agents gets those, the first as lead (section 7.2).
 */
export const DEFAULT_AGENT = "kiko" as AgentSlug
/** The first retry after a failed delivery. ASSUMPTION: the number. */
const DELIVERY_RETRY_MS = 2_000
/** The wakeup key for `task_unblocked` deliveries that failed (section 7.6). */
const WAKES_WAKEUP = "ws_wakes"
/** Agent mail that waits for delivery: held behind a human burst, or retried after a failure. */
const MAIL_WAKEUP = "mail"
const MAIL_KEY = "held_mail"
/** ASSUMPTION: the most files one agent message carries. */
const MAX_SENT_FILES = 50
/** Log memory (section 13): the summaries still to make, and a chat gone quiet. */
const MEMORY_WAKEUP = "memory_naps"
const QUIET_WAKEUP = "memory_quiet"
/** ASSUMPTION: a chat this long without a run is quiet, and its new turns roll up into the user's life. */
const QUIET_MS = 6 * 3_600_000
/** Summaries per background pass, then it yields and the alarm comes back. */
const NAPS_PER_PASS = 24
/** Summaries in flight at once for this room. `UserDO` caps them per user, across rooms, at the same number. */
const NAPS_AT_ONCE = 4

/**
 * Who an agent is and where it lives. The room passes it with every delivery so the agent can reach
 * back. `role` and `lead` are the member row at that delivery; the agent builds its prompt from them.
 */

/** What an agent learns about itself on every delivery. `private` is the chat's flag (section 7.10). */
export type AgentHome = { userId: string; roomId: RoomId; slug: AgentSlug; role?: string; lead?: boolean; private?: boolean }


/** Stored events that can change the chat list row: its activity line, its unread counts, or its members. */
const ROW_EVENTS: ReadonlySet<RoomEvent["t"]> = new Set(["message", "edit", "delete", "react", "read", "member", "member_removed", "approval"])

export type SpawnInput = { id: string; slug: string; name?: string; role: string; task: string; tainted: boolean }

const SPAWN_REFUSAL: Record<MemberRefusal, string> = {
	limit: "the room is full: it holds at most 8 agents.",
	exists: "an agent with that handle is already here.",
	unknown: "no such agent.",
	last: "the room needs at least one agent.",
	reserved: "that handle is reserved. pick another.",
	chief: "kiko leads this room and cannot be removed.",
}

/** An agent message stored while a human burst was pending, delivered right after the burst. */
type SentMail = Extract<ReturnType<Mail["send"]>, { ok: true }>["send"]
type HeldMail = { from: AgentSlug; send: SentMail }

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
	// ASSUMPTION: which agents are typing is kept in memory only, so a typing
	// change costs no write. Hibernation forgets it, and the next setTyping call
	// sends the set as it is then.
	private readonly typing = new Set<AgentSlug>()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		instrument(ctx, "room")
		// The client's liveness ping, answered by the runtime without waking this object.
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
		// Architecture section 23: the schema migration runs before any other work on every start.
		void ctx.blockConcurrencyWhile(async () => {
			migrate(ctx.storage)
			this.log = new RoomLog(ctx.storage)
			this.deliveries = new Deliveries(ctx.storage, this.log)
			this.files = roomFiles(ctx.storage, this.log)
			this.team = new Team(ctx.storage.sql)
			this.alarms = createAlarms(ctx)
			this.burst = new Burst(ctx.storage, this.alarms)
			this.bubbles = new Bubbles(ctx.storage, this.log)
			this.mail = new Mail(ctx.storage, this.log)
			this.members = new Members(ctx.storage, this.log)
			this.workspace = new RoomWorkspace(ctx.storage, this.log)
			this.approvals = new RoomApprovals(ctx.storage, this.log)
			this.asks = new Asks(ctx.storage.sql)
			this.memory = new RoomMemory(ctx.storage, { get: (key) => this.log.meta(key), set: (key, value) => this.log.setMeta(key, value) })
		})
	}

	/** The user and room the Worker named this object for. Set by the first socket. */
	private home(): { userId: string; roomId: RoomId } | null {
		const userId = this.log.meta("user_id")
		const roomId = this.log.meta("room_id")
		return userId && roomId ? { userId, roomId: roomId as RoomId } : null
	}

	/** The user's chat row for this room, or null when the room is not in the chat list. */
	private async chat(home: { userId: string; roomId: RoomId }): Promise<Chat | null> {
		// One row, not the whole chat list, so the hop costs the same for a user with a thousand chats.
		const chat = await userStub(this.env.USER, home.userId).getChat(home.roomId)
		if (chat) this.setPrivate(chat.private ?? false)
		return chat
	}

	/** RPC from UserDO when the human toggles the chat's private flag, and on every read of the chat. */
	setPrivate(value: boolean): void {
		if ((this.log.meta("private") === "1") !== value) this.log.setMeta("private", value ? "1" : "0")
	}

	/** The home an agent is told on a delivery: who it is here, and whether the chat is private. */
	private agentHome(home: { userId: string; roomId: RoomId }, slug: AgentSlug, member: { role?: string; lead: boolean }): AgentHome {
		return { ...home, slug, role: member.role, lead: member.lead, private: this.log.meta("private") === "1" }
	}

	/**
	 * Gives a new room its first members. A chat made without agents gets `DEFAULT_AGENT`. A chat
	 * with one agent gets that agent alone. A group gets `DEFAULT_AGENT` as lead, then its agents. Runs once; a room that has had members is left alone.
	 * ASSUMPTION: an agent id the user's list no longer has is skipped.
	 */
	private async seedMembers(home: { userId: string; roomId: RoomId }, chat: Chat): Promise<void> {
		if (this.members.seeded()) return this.trySeedChatFile(home, chat.title)
		let agents: NewMember[] = []
		if (chat.agents?.length) {
			const mine = await userStub(this.env.USER, home.userId).listAgents()
			agents = chat.agents.flatMap((id): NewMember[] => {
				// The built-in agent is not a stored record: the new-chat picker sends its slug as its id.
				if (id === DEFAULT_AGENT) return [{ slug: DEFAULT_AGENT, name: "kiko" }]
				const a = mine.find((x) => x.id === id)
				// Who the agent is lives in its soul (section 7.10); the member row keeps a tagline for teammates.
				const role = tagline(a?.prompt ?? "")
				return a ? [{ slug: a.slug, name: a.name, ...(role ? { role } : {}), model: a.model }] : []
			})
		}
		if (!agents.length) agents = [{ slug: DEFAULT_AGENT, name: DEFAULT_AGENT }]
		// kiko is the chief of a group: first, so it leads. A chat with one agent stays one-to-one.
		else if (agents.length > 1) agents = [{ slug: DEFAULT_AGENT, name: "kiko" }, ...agents.filter((a) => a.slug !== DEFAULT_AGENT)]
		this.publish(this.members.seed(agents))
		await this.trySeedChatFile(home, chat.title)
	}

	/** Stores /chat.md as `author` wrote it. `expect` "none" keeps a file that is already there. */
	async writeChatFile(author: AgentSlug, text: string, expect?: "none"): Promise<boolean> {
		const home = this.home()
		if (!home) return false
		const body = new TextEncoder().encode(text)
		const id = crypto.randomUUID()
		const r2Key = fileKey(home.userId, home.roomId, id)
		const digest = await crypto.subtle.digest("SHA-256", body)
		const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
		await this.env.FILES.put(r2Key, body, { httpMetadata: { contentType: "text/markdown" } })
		// The room writes this for the team, so it is nobody's act on the board (section 7.12).
		const { drop, file, events } = this.files.put({ id, path: CHAT_PATH, r2Key, size: body.length, type: "text/markdown", sha256, author: { kind: "agent", slug: author }, ...(expect ? { expectSha256: expect } : {}) })
		if (events.length) this.publish(events)
		if (drop) await deleteFiles(this.env.FILES, drop)
		return file !== null
	}

	// kiko makes agents and groups (section 7.11). A proposal is stored with the log's sequence, and
	// create runs only once the human has written after it: kiko asks, the human answers, then it
	// happens. A repeated create returns what the first one made.

	/** RPC for kiko's propose tools. Returns the proposal's id, or why it is refused. */
	async propose(slug: AgentSlug, input: ProposalInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
		const home = this.home()
		if (!home) return { ok: false, error: "this chat is not set up yet" }
		if (slug !== CHIEF) return { ok: false, error: "only kiko makes agents and groups" }
		const checked = checkProposal(input, await userStub(this.env.USER, home.userId).listAgents())
		if ("error" in checked) return { ok: false, error: checked.error }
		const id = crypto.randomUUID().slice(0, 8)
		const proposal: Proposal = { ...checked, id, seq: this.log.lastSeq() }
		this.log.setMeta(`proposal:${id}`, JSON.stringify(proposal))
		return { ok: true, id }
	}

	/** RPC for kiko's create tool. Makes what was proposed, once the human has answered. */
	/**
	 * kiko's newest proposal that is not made yet, as a line of its brief. A run starts from memory, not
	 * from the tool result that saved the proposal (section 13), so the room says it is waiting.
	 */
	private openProposal(): string | null {
		const id = this.newestProposal()
		if (!id || this.log.meta(`created:${id}`)) return null
		const p = JSON.parse(this.log.meta(`proposal:${id}`)!) as Proposal
		const what = p.kind === "agent" ? `the agent @${p.agent.handle}` : `the group "${p.title}"`
		return `your proposal of ${what} waits for the human's answer. if they say yes, call create. if they want changes, propose again.`
	}

	/** The id of the newest stored proposal, or null. */
	private newestProposal(): string | null {
		const rows = this.ctx.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key LIKE 'proposal:%'").toArray()
		const newest = rows.map((r) => JSON.parse(r.value) as Proposal).sort((a, b) => b.seq - a.seq)[0]
		return newest?.id ?? null
	}

	async createProposal(slug: AgentSlug, id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
		const home = this.home()
		if (!home || slug !== CHIEF) return { ok: false, error: "only kiko makes agents and groups" }
		// A run starts from memory, not from the last run's tool results (section 13), so kiko may not
		// have the id. No id means the newest proposal.
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
				const { event } = this.log.addMessage({ from: { kind: "system", reason: "created" }, text: `kiko made @${agent.slug}. say hi in your new chat.`, goto: roomId })
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
					const { event } = this.log.addMessage({ from: { kind: "system", reason: "created" }, text: `kiko started ${proposal.title} with ${members.map((a) => `@${a.slug}`).join(", ")}` })
					if (event) this.publish([event])
					text = `the group is ready, here in this chat, with ${members.map((a) => `@${a.slug}`).join(", ")}. /chat.md holds the plan. kick it off in a line or two.`
				} else {
					const roomId = await user.openChat(proposal.title, [CHIEF, ...members.map((a) => a.id)])
					this.ctx.waitUntil(
						roomStub(this.env.ROOM, home.userId, roomId)
							.startGroup(home.userId, proposal.chat)
							.catch((e: unknown) => console.error(`start group failed: ${e instanceof Error ? e.message : String(e)}`)),
					)
					const { event } = this.log.addMessage({ from: { kind: "system", reason: "created" }, text: `kiko started ${proposal.title}. open it to begin.`, goto: roomId })
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

	/**
	 * RPC for the room kiko opened for a new agent: the agent hears it was made and says hi first.
	 * The room learns its identity from the room that made it, which built both names from the
	 * session's user. The envelope id is fixed, so a repeat wakes nobody twice.
	 */
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

	/** RPC for a group kiko made outside a temporary chat: members, and kiko's /chat.md. */
	async startGroup(userId: string, chatFile: string): Promise<void> {
		const home = this.adopt(userId)
		if (!home) return
		const chat = await this.chat(home)
		if (!chat) return
		await this.seedMembers(home, chat)
		await this.writeChatFile(CHIEF, chatFile)
		this.log.setMeta("chat_file", "1")
	}

	/** Records this room's identity when another room of the same user made it. */
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

	/** Never holds up a delivery: a failed seed is logged, and the next flush tries again. */
	private async trySeedChatFile(home: { userId: string; roomId: RoomId }, title: string): Promise<void> {
		await this.seedChatFile(home, title).catch((e: unknown) => console.error(`chat.md seed failed: ${e instanceof Error ? e.message : String(e)}`))
	}

	/**
	 * A group starts with /chat.md (section 7.10): the goal, who does what, and decisions. The lead
	 * fills it in and the team keeps it current. Written once, when the room first has two agents;
	 * a failed write is tried again at the next flush, and a file the human deleted stays deleted.
	 */
	private async seedChatFile(home: { userId: string; roomId: RoomId }, title: string): Promise<void> {
		if (this.log.meta("chat_file") !== null) return
		const members = this.members.list()
		if (members.length < 2) return
		if (this.files.stat(CHAT_PATH)) return this.log.setMeta("chat_file", "1")
		const team = members.map((m) => `- @${m.slug}: ${[m.lead ? "leads" : "", m.role ?? ""].filter(Boolean).join(". ")}`.trimEnd()).join("\n")
		const lead = members.find((m) => m.lead) ?? members[0]!
		await this.writeChatFile(lead.slug, `# ${title || "this chat"}\n\ngoal:\n\n## who does what\n${team}\n\n## decisions\n`, "none")
		this.log.setMeta("chat_file", "1")
	}

	/** Architecture sections 6.1 and 7.2. The burst wakeup fired: deliver the pending human messages to their recipients. */
	async alarm(): Promise<void> {
		const due = await this.alarms.dueWakeups(Date.now())
		await runDue(this.alarms, due, {
			[HELLO_WAKEUP]: () => enforceHello(this.ctx, this.alarms),
			[BURST_WAKEUP]: () => this.flush(),
			[WAKES_WAKEUP]: () => this.deliverWakes(),
			[MAIL_WAKEUP]: () => this.drainMail(),
			[MEMORY_WAKEUP]: () => this.naps(),
			[QUIET_WAKEUP]: () => this.rollupQuiet(),
			[APPROVALS_WAKEUP]: async () => {
				this.publish(this.approvals.expire())
				await this.deliverApprovals()
				await this.armApprovals()
			},
		}, { retryMs: { [BURST_WAKEUP]: 2_000, [WAKES_WAKEUP]: 2_000, [MAIL_WAKEUP]: 2_000 } })
	}

	private async flush(): Promise<void> {
		const home = this.home()
		if (!home) return
		// One more than a delivery takes, so `envelopes.length < pending.length` still says more remain.
		const pending = this.burst.envelopes(home.roomId, MAX_DELIVERY_ENVELOPES + 1)
		const envelopes = deliverable(pending)
		if (!envelopes.length) return
		try {
			const chat = await this.chat(home)
			// ASSUMPTION: a room that is not in the user's chat list (never created, or deleted) wakes no
			// agent. Its messages stay in the log and are dropped from the burst.
			if (!chat) return this.burst.clear()
			// P9-01: one turn per burst, counted in UserDO against the plan record. A refused burst starts
			// no run; the room says when the count resets.
			// Once per burst: a retry after a failed delivery must not count the burst again.
			const burstId = envelopes[0]!.id
			const turn = this.log.meta("turn_taken") === burstId ? ({ ok: true } as const) : await userStub(this.env.USER, home.userId).takeTurn()
			if (turn.ok) this.log.setMeta("turn_taken", burstId)
			if (!turn.ok) {
				const at = new Date(turn.resetAt).toISOString().slice(11, 16)
				const { event } = this.log.addMessage({ from: { kind: "system", reason: "limit" }, text: `you've used today's ${turn.limit} replies. they come back at ${at} utc.` })
				if (event) this.publish([event])
				return this.burst.delivered(envelopes)
			}
			await this.seedMembers(home, chat)
			const members = this.members.list()
			const replyAuthor = (id: string) => {
				const from = this.log.message(id)?.from
				return from?.kind === "agent" ? from.slug : undefined
			}
			const routes = route(envelopes, members, replyAuthor)
			// Every brief is read in this one synchronous stretch, so `seq` is what they all cover. A
			// member's brief leaves out only its own envelopes, so a burst message addressed to someone
			// else shows up in it. Reactions on the member's own messages come from reactions.ts (section 6.5).
			const seq = this.log.lastSeq()
			const deliveries = [...routes].map(([slug, mine]) => this.delivery(members.find((m) => m.slug === slug)!, members, chat.title, mine))
			// receive() only stores and returns, so these waits are short and cannot deadlock. A repeat
			// after a partial failure or a full inbox is harmless: the agent's inbox ignores envelope ids it has.
			const results = await Promise.allSettled(
				deliveries.map(async ({ member, envelopes: mine, brief, reactionsUpTo }) => {
					const agent = agentStub(this.env.AGENT, home.userId, home.roomId, member.slug)
					const { refused } = await agent.receive(mine, brief, this.agentHome(home, member.slug, member))
					// ASSUMPTION (P1-13): a full inbox is backpressure, so the burst waits and tries again. An entry past
					// the size cap can never fit, so it is dropped. The messages stay in the log either way.
					if (refused === "full") return "full"
					if (refused) console.error(`burst delivery to ${member.slug} refused: ${refused}`)
					this.members.markDelivered(member.slug, seq)
					this.mail.delivered(member.slug, mine)
					markReactionsBriefed(this.log, member.slug, reactionsUpTo)
					return "admitted"
				}),
			)
			const failed = results.find((r) => r.status === "rejected")
			if (failed) throw failed.reason
			if (results.some((r) => r.status === "fulfilled" && r.value === "full")) return await this.burst.retry(DELIVERY_RETRY_MS)
			this.burst.delivered(envelopes)
			// The rest of a burst too big for one delivery goes next, at once.
			if (envelopes.length < pending.length) return await this.burst.retry(0)
			await this.drainMail()
		} catch (error) {
			console.error(`burst delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.burst.retry(DELIVERY_RETRY_MS)
		}
	}

	/** True once this process looked for runs a restart may have left waiting. */
	#woke = false

	/**
	 * The first socket of a new process wakes every agent the room last saw working. After a restart the
	 * agent's run would otherwise wait for its heartbeat, up to 30 seconds, while the human watches. The
	 * marker of an agent with no live run is dropped. Never awaited, so the socket opens at once.
	 */
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

	/** One member's envelopes with its brief (section 7.4). Reactions on the member's own messages come from reactions.ts. */
	private delivery(member: MemberRow, members: readonly MemberRow[], goal: string, raw: Envelope[]) {
		const envelopes = raw.map((e) => this.withContext(e))
		const reactions = reactionBrief(this.log, this.ctx.storage.sql, member.slug)
		const now = Date.now()
		const team = Object.fromEntries(members.map((m) => [m.slug, { doing: this.team.now(m.slug), holds: this.team.held(m.slug, now) }]))
		const human = this.log.meta(HUMAN_HANDLE) ?? undefined
		const proposal = member.slug === CHIEF ? this.openProposal() : null
		const view = { ...readBriefView(this.ctx.storage.sql, member, members, goal, reactions.text), team, ...(human ? { human } : {}), ...(proposal ? { proposal } : {}) }
		return { member, envelopes, brief: buildBrief(member, view), reactionsUpTo: reactions.upTo }
	}

	/**
	 * RPC for an agent's `send_message`, to one agent or to all (sections 7.5 and 7.7). Stores the message with
	 * its addressee, then hands each recipient its envelope. `receive()` only stores, so this wait is
	 * short and cannot deadlock. A repeated `send.id` stores nothing and delivers the same envelope ids,
	 * which the inboxes ignore. A tripped limit returns the error the tool shows the agent.
	 */
	async agentMessage(slug: AgentSlug, send: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }> {
		const home = this.home()
		const members = this.members.list()
		if (!home || !members.some((m) => m.slug === slug)) return { ok: false, error: "not sent: you are not a member of this room." }
		// Files are handed over by reference: every agent in the room reads the same file space.
		const files = send.files?.length ? this.files.refs(send.files.map((p) => p.replace(/^\/+|\/+$/g, "")), MAX_SENT_FILES) : []
		if (!Array.isArray(files)) return { ok: false, error: `not sent: ${files.message}` }
		const out = this.mail.send(slug, send, members, files)
		if (out.ok) this.team.doing(slug, `messaging ${send.to === "all" ? "everyone" : `@${send.to}`}`, Date.now())
		this.publish(out.events)
		if (!out.ok) return out
		// The answer to a teammate's open ask is read by its waiting tool, not delivered as a new run.
		if (send.to !== "all" && this.asks.answer(slug, send.to, send.text)) return { ok: true, to: out.send.recipients }
		// The mail is queued before any delivery, so a crash mid-broadcast leaves it to the next drain. A
		// repeat delivers the same envelope ids, which the inboxes ignore.
		const queue = JSON.parse(this.log.meta(MAIL_KEY) ?? "[]") as HeldMail[]
		queue.push({ from: slug, send: out.send })
		this.log.setMeta(MAIL_KEY, JSON.stringify(queue))
		await this.drainMail()
		return { ok: true, to: out.send.recipients }
	}

	/**
	 * RPC for an agent's `ask` (section 7.5): a message to one teammate whose answer the asking tool
	 * waits for. The ask opens before the delivery, so even a fast answer is matched.
	 */
	async ask(slug: AgentSlug, send: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }> {
		if (send.to === "all") return { ok: false, error: "not sent: ask one agent at a time" }
		if (send.to === slug) return { ok: false, error: "not sent: you cannot ask yourself" }
		this.asks.open(send.id, slug, send.to, Date.now())
		const out = await this.agentMessage(slug, send)
		if (!out.ok) this.asks.close(send.id)
		return out
	}

	/** RPC for the asking tool: the ask's state and answer. */
	async askState(id: string): Promise<AskState | null> {
		return this.asks.get(id)
	}

	/** RPC for the asking tool when it stops waiting. A later reply is delivered as a message. */
	async closeAsk(id: string): Promise<AskState | null> {
		return this.asks.close(id)
	}

	#draining = false

	/**
	 * Delivers queued agent mail in order. The human outranks every agent (section 7.8): while a human
	 * message waits for its burst to close, nothing goes out, and the flush drains right after the
	 * burst. A failed delivery stays at the head and the alarm tries again. One drain at a time; a send
	 * during a drain is picked up by it.
	 */
	private async drainMail(): Promise<void> {
		const home = this.home()
		if (!home || this.#draining || this.burst.pending()) return
		this.#draining = true
		try {
			for (;;) {
				const head = (JSON.parse(this.log.meta(MAIL_KEY) ?? "[]") as HeldMail[])[0]
				if (!head) return
				try {
					await this.deliverMail(home, head.from, head.send)
				} catch (error) {
					console.error(`agent mail delivery failed: ${error instanceof Error ? error.message : String(error)}`)
					await this.alarms.setWakeup(MAIL_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
					return
				}
				const rest = (JSON.parse(this.log.meta(MAIL_KEY) ?? "[]") as HeldMail[]).slice(1)
				if (rest.length) this.log.setMeta(MAIL_KEY, JSON.stringify(rest))
				else this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", MAIL_KEY)
			}
		} finally {
			this.#draining = false
		}
	}

	private async warnBusyAgents(): Promise<void> {
		const home = this.home()
		if (!home) return
		const busy = this.members.list().filter((m) => m.status !== "idle")
		await Promise.allSettled(busy.map((m) => agentStub(this.env.AGENT, home.userId, home.roomId, m.slug).humanComing()))
	}

	/**
	 * What the agent needs to read a human message the way the human sees it: the bubble it replies
	 * to, and the files it carries (each one opens with read). Added after routing, so a quoted
	 * "@ada" never addresses ada. The envelope id is unchanged, so a repeat is still ignored.
	 */
	private withContext(e: Envelope): Envelope {
		if (e.from.kind !== "human") return e
		const message = this.log.message(e.rootId)
		if (!message) return e
		const lines: string[] = []
		const quoted = message.replyTo ? this.log.message(message.replyTo) : null
		if (quoted) {
			const by = quoted.from.kind === "agent" ? `@${quoted.from.slug}` : quoted.from.kind === "human" ? "the human" : "the room"
			// A quote names the exact words the human answers; without one, the start of the whole message.
			lines.push(
				message.quote
					? `(replying to ${by}, about this part: "${message.quote.replace(/\s+/g, " ").slice(0, 600)}")`
					: `(replying to ${by}: "${quoted.text.replace(/\s+/g, " ").slice(0, 400)}")`,
			)
		}
		if (e.body.trim()) lines.push(e.body)
		if (message.files?.length) lines.push(attachedLine(message.files))
		return lines.length ? { ...e, body: lines.join("\n") } : e
	}

	private async deliverMail(home: { userId: string; roomId: RoomId }, slug: AgentSlug, send: SentMail): Promise<void> {
		const members = this.members.list()
		const goal = (await this.chat(home))?.title ?? ""
		const seq = this.log.lastSeq()
		const out = { send }
		for (const to of out.send.recipients) {
			const member = members.find((m) => m.slug === to)
			// The human pressed stop while this send was delivering (section 7.8).
			if (!member || this.mail.stopped(out.send.rootId)) continue
			const d = this.delivery(member, members, goal, [this.mail.envelope(home.roomId, slug, out.send, to)])
			const agent = agentStub(this.env.AGENT, home.userId, home.roomId, to)
			const { refused } = await agent.receive(d.envelopes, d.brief, this.agentHome(home, to, member))
			// A full inbox is backpressure: the drain tries again. A message past the size cap never fits, so it
			// is dropped; it stays in the log, and the next brief shows it.
			if (refused === "full") throw new Error(`${to}'s inbox is full`)
			if (refused) {
				console.error(`agent message to ${to} refused: ${refused}`)
				continue
			}
			this.members.markDelivered(to, seq)
			this.mail.delivered(to, d.envelopes)
			markReactionsBriefed(this.log, to, d.reactionsUpTo)
		}
	}

	// Log memory (architecture section 13). The logic is in memory.ts and lib/optmem.ts.

	/**
	 * RPC for an agent starting a run: this chat as its <memory> block shows it, older turns compressed,
	 * without the messages `seqs` that the run receives on their own. Never waits on a summary.
	 */
	async memoryView(seqs: number[]): Promise<string> {
		const view = this.memory.view(Date.now(), new Set(seqs))
		await this.armMemory()
		return view
	}

	/** RPC for an agent's `recall`: this chat's messages that match. */
	async memoryRecall(query: string): Promise<string[]> {
		return this.memory.recall(query.slice(0, 200), Date.now())
	}

	/** RPC for an agent's `zoom` on a chat id: `12` for one turn, `0-63` for a summary. */
	async memoryZoom(id: string): Promise<string | null> {
		return this.memory.zoom(id, Date.now())
	}

	/** Sets the summary pass when there is work, and pushes the quiet rollup back. */
	private async armMemory(): Promise<void> {
		if (this.memory.pending(1).length) await this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 2_000)
		if (this.log.meta("private") !== "1") await this.alarms.setWakeup(QUIET_WAKEUP, Date.now() + QUIET_MS)
	}

	#napping = false

	/**
	 * The background pass. It never holds the alarm: a summary waits seconds on a model, and the burst
	 * and mail wakeups share this alarm, so the pass runs beside it. Summaries are idempotent, so a pass
	 * cut short by eviction loses nothing; the next one finds the same work.
	 */
	private async naps(): Promise<void> {
		const home = this.home()
		if (!home || this.#napping) return
		this.#napping = true
		// A pass that dies with its process (an eviction, a deploy) would leave the work until the room's
		// next run. This wakeup brings it back; the pass moves or clears it when it ends.
		await this.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 120_000)
		const user = userStub(this.env.USER, home.userId)
		const rollup = this.log.meta("private") === "1" ? null : (text: string, tainted: boolean, at: number) => user.lifeRollup(home.roomId, text, tainted, at)
		const pass = async () => {
			// Up to the most `compress` runs at once for one user; a refusal says when to try again.
			for (let done = 0; done < NAPS_PER_PASS; done += NAPS_AT_ONCE) {
				const spans = this.memory.pending(NAPS_AT_ONCE)
				if (!spans.length) return void (await this.alarms.clearWakeup(MEMORY_WAKEUP))
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

	/** The chat went quiet: its new turns become one line of the user's life. Private chats never roll up. */
	private async rollupQuiet(): Promise<void> {
		const home = this.home()
		if (!home || this.log.meta("private") === "1") return
		const user = userStub(this.env.USER, home.userId)
		const out = await this.memory.rollupQuiet((prompt) => user.compress(prompt), (text, tainted, at) => user.lifeRollup(home.roomId, text, tainted, at))
		if (out.retryAt) await this.alarms.setWakeup(QUIET_WAKEUP, out.retryAt)
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return new Response("expected a websocket upgrade", { status: 426 })
		}
		// The Worker sets both headers from the session. Later tasks need them to reach the user and the agents.
		const userId = request.headers.get(USER_ID_HEADER)
		const roomId = request.headers.get(ROOM_ID_HEADER)
		if (!userId || !roomId) return new Response("missing room identity", { status: 400 })
		if (this.#closed || this.#wiped) return new Response("account deleted", { status: 410 })
		if (this.log.meta("user_id") === null) {
			// The first socket records the room in the user's ledger, so account deletion finds a room that
			// never became a chat. Once, not on every upgrade: later sockets save the Worker a hop to UserDO.
			// A test worker without a user object has no ledger to write.
			const recorded = this.env.USER ? await userStub(this.env.USER, userId).recordRoom(roomId as RoomId) : true
			if (!recorded) return new Response("account deleted", { status: 410 })
			this.log.setMeta("user_id", userId)
			this.log.setMeta("room_id", roomId)
		}
		// The human's handle follows the account's name, so agents can @ them (section 7.2).
		const handle = request.headers.get(HANDLE_HEADER)
		if (handle && handle !== this.log.meta(HUMAN_HANDLE)) this.log.setMeta(HUMAN_HANDLE, handle)
		const home = this.home()
		if (home && !this.members.seeded()) {
			// The chat may not be in the list yet. The first burst seeds the members then.
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

	/** Sends stored events to every socket that has said hello. `previews: false` reads only links a human sent. */
	publish(events: readonly RoomEvent[], { previews = true }: { previews?: boolean } = {}): void {
		if (!events.length) return
		this.broadcast({ t: "events", events })
		if (events.some((e) => ROW_EVENTS.has(e.t))) this.touchSoon()
		// Every stored human message passes here once, so this is where a burst grows.
		for (const e of events) if (e.t === "message" && e.from.kind === "human") this.ctx.waitUntil(this.burst.add(e))
		// Section 7.8: a busy agent learns at once that a human message is coming, so it keeps holding
		// agent mail until the burst closes and the human's message arrives first.
		if (events.some((e) => e.t === "message" && e.from.kind === "human")) this.ctx.waitUntil(this.warnBusyAgents())
		// The card for a message's first link follows the message, in its own event.
		for (const e of events) {
			const target = previewTarget(e)
			if (target && !previews && !humanWrote(this.ctx.storage.sql, target.url)) continue
			if (target) this.ctx.waitUntil(attachPreview(this.log, this.env, target, (w) => this.ctx.waitUntil(w), (out) => this.publish(out)))
		}
	}

	#touching = false

	/**
	 * Sends the chat list row to the user once the current step is done, so a burst of events in one
	 * step costs one touch. A failed touch is logged; the next change sends the row again.
	 */
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

	/** Sends a frame that is not stored (typing, draft, status) to every ready socket. */
	broadcast(frame: RoomToClient): void {
		for (const ws of this.ctx.getWebSockets()) if (attachment(ws).ready) send(ws, frame)
	}

	/** The socket's search, and RPC for the Worker's search across chats (`room/search-route.ts`). */
	search(query: string, options?: SearchOptions) {
		return searchMessages(this.ctx.storage.sql, query, options)
	}

	catalog(kind: "links" | "media", before?: number, limit?: number) {
		return listCatalog(this.ctx.storage.sql, kind, before, limit)
	}

	/** RPC for the user's `UserDO`. Returns false when `id` was delivered before. */
	async deliverReminder(id: string, reminder: ReminderDelivery): Promise<boolean> {
		const event = this.deliveries.reminder(id, reminder)
		if (event) this.publish([event])
		// A reminder for an agent also wakes it (P5-06): a system envelope, reason `reminder`, hop 0. The
		// envelope id is the delivery id, so a repeat is ignored by the inbox.
		const home = this.home()
		const member = this.members.list().find((m) => m.slug === reminder.target)
		if (event && home && member && event.t === "message") {
			const envelope: Envelope = {
				id: `reminder:${id}`,
				roomId: home.roomId,
				from: { kind: "system", reason: "reminder" },
				body: `reminder: ${reminder.text}`,
				hop: 0,
				rootId: `reminder:${id}`,
				tainted: false,
				seq: event.seq,
			}
			const goal = (await this.chat(home))?.title ?? ""
			const d = this.delivery(member, this.members.list(), goal, [envelope])
			const { refused } = await agentStub(this.env.AGENT, home.userId, home.roomId, member.slug).receive(d.envelopes, d.brief, this.agentHome(home, member.slug, member))
			if (!refused) this.members.markDelivered(member.slug, event.seq)
		}
		return event !== null
	}

	/** RPC for the Worker's upload route and file tools. Indexes a stored object and broadcasts the change. */
	async putFile(input: NewFile): Promise<Omit<PutResult, "events"> & { fresh: boolean; entry: FsEntry | null }> {
		// An agent writes only where no teammate is working (section 7.12). The human is never refused.
		const by = input.author.kind === "agent" ? input.author.slug : null
		if (by) {
			const held = this.held(by, [input.path])
			if (held) return { file: null, drop: input.r2Key, refused: held, fresh: false, entry: null }
		}
		const { events, ...result } = this.files.put(input)
		if (by && result.file && !result.conflict && !result.refused) this.working(by, [input.path], `editing /${input.path}`)
		if (events.length) this.publish(events)
		const fresh = events.some((e) => e.t === "file")
		return { ...result, fresh, entry: result.file && !result.conflict ? this.files.stat(input.path) : null }
	}

	/** RPC for the attachment job. */
	async fileMeta(id: string): Promise<FileMeta | null> {
		return this.files.meta(id)
	}

	/** RPC for the attachment job. Fills empty fields only, so a second call returns false and stores nothing. */
	async setFileMeta(id: string, patch: FileMetaPatch): Promise<boolean> {
		const event = this.files.fillMeta(id, patch)
		if (event) this.publish([event])
		return event !== null
	}

	/** RPC for the agent file system. A file, a folder, or null. */
	async fsStat(path: string): Promise<FsEntry | null> {
		return this.files.stat(path)
	}

	/** RPC for the agent file system. What a folder holds; everything below it with `recursive`. */
	async fsList(dir: string, recursive = false): Promise<FsEntry[] | FsFail> {
		return this.files.list(dir, recursive)
	}

	/** RPC for the agent file system: `mv`. */
	async fsMove(slug: AgentSlug, from: string, to: string): Promise<FsChange<RoomEvent> | FsFail> {
		return this.guarded(slug, [from, to], `moving /${from}`, () => this.files.move(from, to, { kind: "agent", slug }))
	}

	/** RPC for the agent file system: `rm`. */
	async fsRemove(slug: AgentSlug, paths: readonly string[], recursive: boolean): Promise<FsChange<RoomEvent> | FsFail> {
		// A file on a message stays: the bubble would point at nothing. The human can still delete it.
		return this.guarded(slug, paths, `deleting /${paths[0]}`, () => this.files.remove(paths, recursive, { kind: "agent", slug }, (ids) => this.attachedRefusal(ids)))
	}

	/** RPC for an agent that changed the user's drive (section 18.3): one line in the chat says what. */
	async homeNotice(slug: AgentSlug, text: string): Promise<void> {
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "files" }, text: `@${slug} ${text}`.slice(0, 300) })
		if (event) this.publish([event])
	}

	/** RPC for the agent file system: `mkdir -p`. */
	async fsMkdir(slug: AgentSlug, path: string): Promise<FsChange<RoomEvent> | FsFail> {
		return this.guarded(slug, [path], `setting up /${path}`, () => this.files.mkdir(path, { kind: "agent", slug }))
	}

	// The team board and leases (section 7.12). Every act an agent makes through the room says what it
	// is doing and holds the paths it changed until its run ends; a teammate's act there is refused.

	/** The refusal for `slug` touching `paths` a teammate holds, or null. */
	private held(slug: AgentSlug, paths: readonly string[]): FsFail | null {
		const h = this.team.holder(slug, paths, Date.now())
		return h ? { ok: false, code: "invalid", message: Team.refusal(h) } : null
	}

	/** Records what `slug` is doing and the paths it now holds, and tells the human. */
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

	/** RPC from an agent's presence hook: what its current tool call is about. Holds nothing. */
	async reportDoing(slug: AgentSlug, doing: string): Promise<void> {
		if (this.members.list().some((m) => m.slug === slug)) this.working(slug, [], doing.slice(0, 120))
	}

	/** RPC for an agent's `team` tool: what everyone is doing now, and what they hold. */
	async teamNow(): Promise<{ slug: AgentSlug; name: string; status: AgentState; doing: string | null; holds: string[] }[]> {
		const now = Date.now()
		return this.members.list().map((m) => ({ slug: m.slug, name: m.name, status: m.status, doing: this.team.now(m.slug), holds: this.team.held(m.slug, now) }))
	}

	/** Why an agent may not delete these files: some sit on a live message. */
	private attachedRefusal(ids: readonly string[]): string | null {
		if (!ids.length) return null
		// One JSON value, not one bound value per id: a query binds at most 100 (Durable Objects SQL
		// limits), and `rm -r` can name many more files.
		const hit = this.ctx.storage.sql
			.exec<{ id: string }>(
				`SELECT DISTINCT json_extract(f.value, '$.id') AS id FROM messages m, json_each(m.files) f
				 WHERE m.deleted_at IS NULL AND m.files IS NOT NULL AND json_extract(f.value, '$.id') IN (SELECT value FROM json_each(?))`,
				JSON.stringify(ids),
			)
			.toArray()
		if (!hit.length) return null
		const names = this.files.all().filter((f) => hit.some((h) => h.id === f.id)).map((f) => `/${f.name}`)
		return `${names.join(", ")} ${names.length === 1 ? "is" : "are"} attached to a message in the chat, so it stays. move it instead, or ask the human to delete it.`
	}

	/** A human's `files` frame. Returns the refusal for the socket, or null. */
	fileOp(op: FileOp): string | null {
		const human = { kind: "human" } as const
		const paths = op.op === "rm" ? op.paths : op.op === "mv" ? [op.from, op.to] : [op.path]
		if (paths.some((p) => cleanPath(p) === null)) return "that is not a path in this chat's files"
		const out = this.applyFs(
			op.op === "rm" ? this.files.remove(op.paths, op.recursive ?? false, human) : op.op === "mv" ? this.files.move(op.from, op.to, human) : this.files.mkdir(op.path, human),
		)
		return out.ok ? null : out.message
	}

	/** Publishes a change and deletes the R2 objects nothing points to any more. */
	private applyFs<T extends FsChange<RoomEvent> | FsFail>(out: T): T {
		if (!out.ok) return out
		if (out.events.length) this.publish(out.events)
		if (out.drop.length) this.ctx.waitUntil(deleteFiles(this.env.FILES, out.drop).catch((e: unknown) => console.error(`r2 delete failed: ${e instanceof Error ? e.message : String(e)}`)))
		return out
	}

	/**
	 * The human pressed stop (section 6.2). The pending burst is dropped, so nothing sent before the
	 * stop starts a run, and the agent aborts its run and discards what waits in its inbox. The
	 * messages stay in the log. The agent's `stop` only stores and returns, so this never waits on a run.
	 * ASSUMPTION: a failed stop call is not retried. The human can press stop again.
	 */
	stop(): void {
		const home = this.home()
		if (!home) return
		this.burst.clear()
		this.mail.stop()
		for (const member of this.members.list()) this.stopAgent(home, member.slug)
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

	/**
	 * A human's `member` frame (sections 7.2 and 7.7). Returns the refusal for the socket, or null.
	 * A removed member's run is stopped. Its object keeps its storage until account deletion.
	 */
	memberOp(op: MemberOp): MemberRefusal | null {
		const name = op.op === "remove" ? this.members.get(op.slug)?.name : undefined
		const result = this.members.apply(op)
		if (!result.ok) return result.reason
		// A newcomer sees every file the chat already has. The human is told, once, at the moment it happens.
		const notice: RoomEvent[] = []
		if (op.op === "add") {
			const count = this.files.stat("")
			const n = count?.kind === "directory" ? count.files : 0
			if (n) {
				const { event } = this.log.addMessage({ from: { kind: "system", reason: "files" }, text: `@${op.slug} can now see this chat's ${n} file${n === 1 ? "" : "s"}` })
				if (event) notice.push(event)
			}
		}
		// The chat list says who joined or left. The files notice is part of the join, so the join stays the row's line.
		if (op.op !== "rename" && result.events.length) {
			const activity: MemberActivity = { seq: this.log.lastSeq(), at: result.events[0]!.at, kind: op.op === "add" ? "joined" : "left", name: op.op === "add" ? op.name : (name ?? op.slug) }
			this.log.setMeta(MEMBER_ACTIVITY, JSON.stringify(activity))
		}
		this.publish([...result.events, ...notice])
		const home = this.home()
		if (op.op === "remove" && home) this.stopAgent(home, op.slug)
		return null
	}

	/**
	 * RPC for the lead's `spawn_agent` (section 7.5). Adds a member, gives it a first task on the board,
	 * and sends it that task as an agent message, so it wakes and starts. Lead rights come from the
	 * member row. A replayed call finds the member and the task already there and sends nothing twice.
	 */
	async spawnAgent(by: AgentSlug, input: SpawnInput): Promise<{ ok: true; slug: AgentSlug } | { ok: false; error: string }> {
		const members = this.members.list()
		const me = members.find((m) => m.slug === by)
		if (!me?.lead) return { ok: false, error: "only the lead can add an agent to this room." }
		const slug = input.slug.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32)
		if (!isAgentSlug(slug)) return { ok: false, error: `"${input.slug}" is not a usable handle. use lowercase letters, digits, and dashes.` }
		const home = this.home()
		// A spawned agent is a real agent of the user's, with a soul made from the role the lead gave it.
		if (home) await userStub(this.env.USER, home.userId).seedSoul(slug, input.name?.trim() || slug, input.role)
		if (!members.some((m) => m.slug === slug)) {
			const refused = this.memberOp({ op: "add", slug, name: input.name?.trim() || slug, role: input.role, ...(me.model ? { model: me.model } : {}) })
			if (refused) return { ok: false, error: SPAWN_REFUSAL[refused] }
		}
		await this.workspaceCall(by, { op: "create_task", id: `spawn-${input.id}`.slice(0, 64), title: input.task.slice(0, 140), owner: slug })
		const sent = await this.agentMessage(by, { id: `spawn:${input.id}`, to: slug, text: input.task, tainted: input.tainted })
		return sent.ok ? { ok: true, slug } : sent
	}

	/** A human's `model` frame: the agents of this room use `ref` (provider/model) from their next run. */
	setModel(ref: string, slug?: AgentSlug): void {
		const home = this.home()
		const at = ref.indexOf("/")
		if (!home || at <= 0) return
		const model = { provider: ref.slice(0, at), modelId: ref.slice(at + 1) }
		const targets = this.members.list().filter((m) => !slug || m.slug === slug)
		for (const m of targets) this.ctx.waitUntil(agentStub(this.env.AGENT, home.userId, home.roomId, m.slug).setModel(model).then(() => undefined))
	}

	/** A human's `task` frame (section 7.6). A refused op stores nothing; the client's patch expires. */
	taskOp(op: TaskOp): void {
		this.publish(applyTaskOp(this.workspace, op, this.members.list().map((m) => m.slug)))
		this.ctx.waitUntil(this.deliverWakes())
	}

	/** RPC for an agent's workspace tools (section 7.5). Lead rights come from the member row, never from the agent. */
	async workspaceCall(slug: AgentSlug, call: WorkspaceCall): Promise<WorkspaceAnswer> {
		const members = this.members.list()
		const member = members.find((m) => m.slug === slug)
		if (!member) return { ok: false, error: "you are not a member of this room" }
		const { answer, events } = runCall(this.workspace, slug, member.lead, call, members.map((m) => m.slug))
		this.publish(events)
		this.ctx.waitUntil(this.deliverWakes())
		return answer
	}

	/**
	 * Section 7.6. Delivers one `task_unblocked` envelope, id `unblocked:<taskId>`, to the owner of each
	 * task a finished dependency unblocked. A wake is recorded once the agent admits it, and the agent's
	 * inbox ignores an id it has, so a repeat after a crash delivers nothing twice. A failure retries
	 * from the alarm. `receive()` only stores, so this wait cannot deadlock.
	 */
	private async deliverWakes(): Promise<void> {
		const home = this.home()
		const wakes = this.workspace.pendingWakes()
		if (!home || !wakes.length) return
		try {
			const chat = await this.chat(home)
			if (!chat) return
			for (const wake of wakes) {
				const members = this.members.list()
				const member = members.find((m) => m.slug === wake.owner)
				if (!member) continue
				const seq = this.log.lastSeq()
				const brief = buildBrief(member, readBriefView(this.ctx.storage.sql, member, members, chat.title, null))
				const agent = agentStub(this.env.AGENT, home.userId, home.roomId, member.slug)
				const { refused } = await agent.receive([wakeEnvelope(home.roomId, wake)], brief, this.agentHome(home, member.slug, member))
				if (refused === "full") throw new Error("inbox full")
				if (refused) console.error(`task_unblocked delivery to ${member.slug} refused: ${refused}`)
				this.members.markDelivered(member.slug, seq)
				this.workspace.markWoken(wake.taskId)
			}
		} catch (error) {
			console.error(`task_unblocked delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.alarms.setWakeup(WAKES_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
		}
	}

	/**
	 * RPC for an agent's trust gate (P7-02, section 16.3). A tainted run wants to call `external` tool
	 * `req.tool`. Returns the accepted approval's id, or the text that ends the call while a card waits
	 * for the human. It never decides a card: only the human's socket does.
	 */
	async requestApproval(slug: AgentSlug, req: ApprovalRequest): Promise<ApprovalAnswer> {
		if (!this.members.list().some((m) => m.slug === slug)) return { refused: "not run: you are not a member of this room." }
		const { answer, event } = this.approvals.request(slug, req)
		if (event) {
			this.publish([event])
			await this.armApprovals()
		}
		return answer
	}

	/** A human's `approve` frame. A card that is not pending changes nothing. */
	approve(id: string, action: "accept" | "decline"): void {
		const event = this.approvals.decide(id, action)
		if (!event) return
		this.publish([event])
		this.ctx.waitUntil(this.deliverApprovals())
	}

	/** Sets the approvals wakeup to the next expiry, or clears it. */
	private async armApprovals(): Promise<void> {
		const at = this.approvals.nextExpiry()
		if (at === null) await this.alarms.clearWakeup(APPROVALS_WAKEUP)
		else await this.alarms.setWakeup(APPROVALS_WAKEUP, at)
	}

	/**
	 * Delivers each decided card's `approval_result` envelope (id `approval:<id>`) to its agent. The
	 * inbox ignores an id it has, so a repeat delivers nothing twice. A failure retries from the alarm.
	 */
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
				this.approvals.markDelivered(id)
			}
		} catch (error) {
			console.error(`approval_result delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.alarms.setWakeup(APPROVALS_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
		}
	}

	/** Extends a pending burst (section 6.1). Nothing is sent. */
	humanTyping(): void {
		this.ctx.waitUntil(this.burst.typing())
	}

	/**
	 * RPC for an agent in this room (section 6.3). Stores one closed block of a run's answer. A repeated
	 * `(runId, attempt, index)` stores nothing. A higher attempt deletes the bubbles of earlier attempts.
	 * Returns true when this call stored the bubble. A bubble of a `tainted` run gets a link card only
	 * for a link a human message holds: any other link may carry what outside content made the run
	 * write, so the room never fetches it (section 16.4).
	 */
	async post(slug: AgentSlug, runId: string, attempt: number, index: number, block: string, tainted = false): Promise<boolean> {
		const events = this.bubbles.post(slug, { runId, attempt, index }, block, tainted)
		this.publish(events, { previews: !tainted })
		return events.some((e) => e.t === "message")
	}

	/**
	 * RPC for an agent (section 6.5). Stores the agent's reaction on `messageId`, or on the last human
	 * message handed to the agents. An emoji off the allowlist is dropped. Starts no run. Returns
	 * true when this call changed the reaction.
	 */
	async react(slug: AgentSlug, emoji: string, messageId?: string): Promise<boolean> {
		const event = agentReact(this.log, this.ctx.storage.sql, slug, emoji, messageId)
		if (event) this.publish([event])
		return event !== null
	}

	/**
	 * RPC for an agent (section 11.3). The agent's run could not start because the user has no
	 * credential for `provider`. Stores one `no_provider` event per agent and input, so a repeated
	 * call after a crash stores nothing. The human's messages stay in the log for a resend.
	 */
	async noProvider(slug: AgentSlug, provider: string, requestId: string): Promise<boolean> {
		const key = `no_provider:${slug}:${requestId}`
		const event = this.ctx.storage.transactionSync(() => {
			if (this.log.meta(key) !== null) return null
			this.log.setMeta(key, "1")
			return this.log.append(`agent:${slug}`, { t: "no_provider", slug, provider })
		})
		if (event) this.publish([event])
		return event !== null
	}

	/**
	 * RPC for an agent whose run kept killing its process and was dropped (the host's breaker). The
	 * human sees why the agent went quiet, and the agent shows idle.
	 */
	async runDropped(slug: AgentSlug): Promise<void> {
		const { event } = this.log.addMessage({ from: { kind: "system", reason: "run_budget" }, text: `@${slug} stopped: its reply kept crashing, so it was dropped. send a message to try again.` })
		if (event) this.publish([event])
		await this.setStatus(slug, "idle")
	}

	/** RPC for an agent. A growing block past the draft threshold. Sent, never stored. */
	async draft(slug: AgentSlug, runId: string, index: number, text: string): Promise<void> {
		this.broadcast({ t: "draft", slug, runId, index, text: replyTag(text).text })
	}

	/**
	 * RPC for an agent. Stores the member's latest state (only the latest) and sends the change, and
	 * the typing set with it. A slug that is not a member stores and sends nothing.
	 */
	async setStatus(slug: AgentSlug, state: AgentState): Promise<void> {
		// A run that ended lets go of everything it held (section 7.12), whatever the member row says.
		if (state === "idle") this.team.clear(slug)
		if (!this.members.setStatus(slug, state)) return
		if (state === "typing" && !this.team.now(slug)) this.team.doing(slug, "writing a reply", Date.now())
		this.broadcast({ t: "status", slug, state, ...(state === "idle" ? {} : { doing: this.team.now(slug) ?? undefined }) })
		await this.setTyping(slug, state === "typing")
		// A marker that outlives the process, so a room that starts after a restart knows a run was live.
		// Written once per run, not on every typing and working change.
		if (state === "idle") this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", `live:${slug}`)
		else if (this.log.meta(`live:${slug}`) === null) this.log.setMeta(`live:${slug}`, "1")
	}

	/**
	 * RPC for an agent. The run answered or failed. Touches the user's chat list once per run: a repeat
	 * after a crash finds the run ended, and `touchChat` ignores a `lastSeq` it already has.
	 */
	async endRun(slug: AgentSlug, runId: string): Promise<void> {
		const home = this.home()
		if (home && !this.bubbles.ended(runId)) this.memory.trace(slug, runId, Date.now())
		await this.setStatus(slug, "idle")
		if (!home || this.bubbles.ended(runId)) return
		await this.armMemory()
		await userStub(this.env.USER, home.userId).touchChat(home.roomId, chatTouch(this.ctx.storage.sql, this.log))
		this.bubbles.markEnded(runId)
	}

	/** RPC for an agent in this room. Broadcasts who is typing, without storing it. */
	async setTyping(slug: AgentSlug, typing: boolean): Promise<void> {
		const had = this.typing.has(slug)
		if (typing === had) return
		if (typing) this.typing.add(slug)
		else this.typing.delete(slug)
		this.broadcast({ t: "typing", who: [...this.typing] })
		// The chat list shows who is typing in a chat that is not open. Once per change, never per keystroke.
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

	// Account deletion (P9-02). The job in jobs/delete-account.ts calls these.
	#wiped = false

	/**
	 * Closes every socket and refuses new ones until the object is evicted. After that the
	 * Worker's tombstone check keeps the deleted user out.
	 */
	async close(): Promise<void> {
		this.#closed = true
		closeSockets(this.ctx)
	}
	#closed = false

	/** Every agent that was ever a member of this room, removed ones included, and the R2 keys its file index holds. */
	async inventory(): Promise<{ agents: AgentSlug[]; keys: string[] }> {
		if (this.#wiped) return { agents: [], keys: [] }
		const sql = this.ctx.storage.sql
		const agents = this.members.everyone()
		const keys = sql.exec<{ r2_key: string }>("SELECT r2_key FROM ws_files").toArray().map((r) => r.r2_key)
		return { agents, keys }
	}

	/** Deletes all of the room's storage. Returns the rows that held data, 0 on a repeat. */
	async deleteAll(): Promise<number> {
		if (this.#wiped) return 0
		const rows = await wipeStorage(this.ctx)
		this.#wiped = true
		return rows
	}

	async storedRows(): Promise<number> {
		return this.#wiped ? 0 : storedRows(this.ctx.storage)
	}

	/** Development only. Writes `turns` into the log with no burst and no run (`verify memory-eval`). Returns the turn count. */
	async devSeed(turns: { from: string; text: string }[]): Promise<number> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		for (const [i, t] of turns.entries()) {
			const from: Sender = t.from === "human" ? { kind: "human" } : { kind: "agent", slug: t.from as AgentSlug }
			this.log.addMessage({ from, text: t.text, ...(from.kind === "agent" ? { run: { runId: `seed:${i}`, attempt: 0, index: 0 } } : {}) })
		}
		const count = this.memory.sync()
		await this.armMemory()
		return count
	}

	/** Development only. The room's log memory: turns, summaries still to make, and the view. */
	async devMemory(): Promise<{ turns: number; pending: number; view: string }> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		const view = this.memory.view(Date.now())
		const pending = this.memory.pending(1_000).length
		if (pending) await this.armMemory()
		return { turns: this.memory.count(), pending, view }
	}

	/** Development only. Makes `slug` a member and stores one message from it, for the deletion check. */
	async devAgentMessage(slug: AgentSlug, text: string): Promise<void> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		const added = this.members.apply({ op: "add", slug, name: slug })
		if (added.ok) this.publish(added.events)
		const { event } = this.log.addMessage({ from: { kind: "agent", slug }, text })
		if (event) this.publish([event])
	}
}
