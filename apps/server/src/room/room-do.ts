import type { AgentSlug, AgentState, Chat, FileRef, MemberOp, MemberRefusal, RoomEvent, RoomId, RoomToClient, TaskOp } from "@kiko/protocol"
import { DurableObject } from "cloudflare:workers"
import { instrument } from "../lib/dev-stats"
import type { Env } from "../index"
import { type Alarms, createAlarms } from "../lib/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "../lib/hello-deadline"
import { agentStub, ROOM_ID_HEADER, USER_ID_HEADER, userStub } from "../lib/names"
import { closeSockets, storedRows, wipeStorage } from "../lib/wipe"
import { BURST_WAKEUP, Burst } from "./burst"
import { buildBrief, readBriefView } from "./brief"
import { Bubbles, Deliveries, type ReminderDelivery, route } from "./deliver"
import { type FileMeta, type FileMetaPatch, listFiles, type NewFile, type PutResult, RoomFiles } from "./files"
import { RoomLog } from "./log"
import { Members, type NewMember } from "./members"
import { agentReact, markReactionsBriefed, reactionBrief } from "./reactions"
import { migrate } from "./schema"
import { listCatalog } from "./catalog"
import { searchMessages } from "./search"
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

/**
 * Who an agent is and where it lives. The room passes it with every delivery so the agent can reach
 * back. `role` and `lead` are the member row at that delivery; the agent builds its prompt from them.
 */
export type AgentHome = { userId: string; roomId: RoomId; slug: AgentSlug; role?: string; lead?: boolean }

export class RoomDO extends DurableObject<Env> implements SocketRoom {
	// Set in the constructor's `blockConcurrencyWhile`, which ends before any request or alarm runs.
	log!: RoomLog
	private deliveries!: Deliveries
	private alarms!: Alarms
	private burst!: Burst
	private bubbles!: Bubbles
	members!: Members
	files!: RoomFiles
	workspace!: RoomWorkspace
	// ASSUMPTION: which agents are typing is kept in memory only, so a typing
	// change costs no write. Hibernation forgets it, and the next setTyping call
	// sends the set as it is then.
	private readonly typing = new Set<AgentSlug>()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		instrument(ctx, "room")
		// Architecture section 23: the schema migration runs before any other work on every start.
		void ctx.blockConcurrencyWhile(async () => {
			migrate(ctx.storage)
			this.log = new RoomLog(ctx.storage)
			this.deliveries = new Deliveries(ctx.storage, this.log)
			this.files = new RoomFiles(ctx.storage, this.log)
			this.alarms = createAlarms(ctx)
			this.burst = new Burst(ctx.storage, this.alarms)
			this.bubbles = new Bubbles(ctx.storage, this.log)
			this.members = new Members(ctx.storage, this.log)
			this.workspace = new RoomWorkspace(ctx.storage, this.log)
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
		return userStub(this.env.USER, home.userId).getChat(home.roomId)
	}

	/**
	 * Gives a new room its first members: the agents the chat was created with, the first as lead, or
	 * `DEFAULT_AGENT` for a chat made without any. Runs once; a room that has had members is left alone.
	 * ASSUMPTION: an agent id the user's list no longer has is skipped.
	 */
	private async seedMembers(home: { userId: string; roomId: RoomId }, chat: Chat): Promise<void> {
		if (this.members.seeded()) return
		let agents: NewMember[] = []
		if (chat.agents?.length) {
			const mine = await userStub(this.env.USER, home.userId).listAgents()
			agents = chat.agents.flatMap((id) => {
				// The built-in agent is not stored in the user's list. The client names it by its slug.
				if (id === DEFAULT_AGENT) return [{ slug: DEFAULT_AGENT, name: DEFAULT_AGENT }]
				const a = mine.find((x) => x.id === id)
				return a ? [{ slug: a.slug, name: a.name, role: a.prompt, model: a.model }] : []
			})
		}
		if (!agents.length) agents = [{ slug: DEFAULT_AGENT, name: DEFAULT_AGENT }]
		this.publish(this.members.seed(agents))
	}

	/** Architecture sections 6.1 and 7.2. The burst wakeup fired: deliver the pending human messages to their recipients. */
	async alarm(): Promise<void> {
		const due = await this.alarms.dueWakeups(Date.now())
		if (due.includes(HELLO_WAKEUP)) await enforceHello(this.ctx, this.alarms)
		if (due.includes(BURST_WAKEUP)) await this.flush()
		if (due.includes(WAKES_WAKEUP)) await this.deliverWakes()
	}

	private async flush(): Promise<void> {
		const home = this.home()
		if (!home) return
		const envelopes = this.burst.envelopes(home.roomId)
		if (!envelopes.length) return
		try {
			const chat = await this.chat(home)
			// ASSUMPTION: a room that is not in the user's chat list (never created, or deleted) wakes no
			// agent. Its messages stay in the log and are dropped from the burst.
			if (!chat) return this.burst.delivered(envelopes)
			await this.seedMembers(home, chat)
			const members = this.members.list()
			const routes = route(envelopes, members, (id) => {
				const from = this.log.message(id)?.from
				return from?.kind === "agent" ? from.slug : undefined
			})
			// Every brief is read in this one synchronous stretch, so `seq` is what they all cover. A
			// member's brief leaves out only its own envelopes, so a burst message addressed to someone
			// else shows up in it. Reactions on the member's own messages come from reactions.ts (section 6.5).
			const seq = this.log.lastSeq()
			const deliveries = [...routes].map(([slug, mine]) => {
				const member = members.find((m) => m.slug === slug)!
				const reactions = reactionBrief(this.log, this.ctx.storage.sql, slug)
				const view = readBriefView(this.ctx.storage.sql, member, members, chat.title, new Set(mine.map((e) => e.seq)), reactions.text)
				return { member, envelopes: mine, brief: buildBrief(member, view), reactionsUpTo: reactions.upTo }
			})
			// receive() only stores and returns, so these waits are short and cannot deadlock. A repeat
			// after a partial failure or a full inbox is harmless: the agent's inbox ignores envelope ids it has.
			const results = await Promise.allSettled(
				deliveries.map(async ({ member, envelopes: mine, brief, reactionsUpTo }) => {
					const agent = agentStub(this.env.AGENT, home.userId, home.roomId, member.slug)
					const { refused } = await agent.receive(mine, brief, { ...home, slug: member.slug, role: member.role, lead: member.lead })
					// ASSUMPTION (P1-13): a full inbox is backpressure, so the burst waits and tries again. An entry past
					// the size cap can never fit, so it is dropped. The messages stay in the log either way.
					if (refused === "full") return "full"
					if (refused) console.error(`burst delivery to ${member.slug} refused: ${refused}`)
					this.members.markDelivered(member.slug, seq)
					markReactionsBriefed(this.log, member.slug, reactionsUpTo)
					return "admitted"
				}),
			)
			const failed = results.find((r) => r.status === "rejected")
			if (failed) throw failed.reason
			if (results.some((r) => r.status === "fulfilled" && r.value === "full")) return await this.burst.retry(DELIVERY_RETRY_MS)
			this.burst.delivered(envelopes)
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
			this.log.setMeta("user_id", userId)
			this.log.setMeta("room_id", roomId)
		}
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

	/** Sends stored events to every socket that has said hello. */
	publish(events: readonly RoomEvent[]): void {
		if (!events.length) return
		this.broadcast({ t: "events", events })
		// Every stored human message passes here once, so this is where a burst grows.
		for (const e of events) if (e.t === "message" && e.from.kind === "human") this.ctx.waitUntil(this.burst.add(e))
	}

	/** Sends a frame that is not stored (typing, draft, status) to every ready socket. */
	broadcast(frame: RoomToClient): void {
		for (const ws of this.ctx.getWebSockets()) if (attachment(ws).ready) send(ws, frame)
	}

	search(query: string, before?: number, limit?: number) {
		return searchMessages(this.ctx.storage.sql, query, before, limit)
	}

	catalog(kind: "links" | "media", before?: number, limit?: number) {
		return listCatalog(this.ctx.storage.sql, kind, before, limit)
	}

	/** RPC for the user's `UserDO`. Returns false when `id` was delivered before. */
	async deliverReminder(id: string, reminder: ReminderDelivery): Promise<boolean> {
		const event = this.deliveries.reminder(id, reminder)
		if (event) this.publish([event])
		return event !== null
	}

	/** RPC for the Worker's upload route and file tools. Indexes a stored object and broadcasts the change. */
	async putFile(input: NewFile): Promise<Omit<PutResult, "event"> & { fresh: boolean }> {
		const { event, ...result } = this.files.put(input)
		if (event) this.publish([event])
		return { ...result, fresh: event !== null }
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

	/** RPC for the agent file tools (P8-05). Where the file at `path` lives, or null. */
	async fileAt(path: string): Promise<{ r2Key: string; size: number; type: string } | null> {
		const row = this.ctx.storage.sql.exec<{ r2_key: string; size: number; type: string }>("SELECT r2_key, size, type FROM ws_files WHERE path = ?", path).toArray()[0]
		return row ? { r2Key: row.r2_key, size: row.size, type: row.type } : null
	}

	/** RPC for the agent file tools (P8-05). Every file whose path starts with `prefix`, by path. */
	async filesUnder(prefix: string): Promise<FileRef[]> {
		return listFiles(this.ctx.storage).filter((f) => f.name.startsWith(prefix))
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
		this.burst.delivered(this.burst.envelopes(home.roomId))
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
		const result = this.members.apply(op)
		if (!result.ok) return result.reason
		this.publish(result.events)
		const home = this.home()
		if (op.op === "remove" && home) this.stopAgent(home, op.slug)
		return null
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
				const brief = buildBrief(member, readBriefView(this.ctx.storage.sql, member, members, chat.title, new Set(), null))
				const agent = agentStub(this.env.AGENT, home.userId, home.roomId, member.slug)
				const { refused } = await agent.receive([wakeEnvelope(home.roomId, wake)], brief, { ...home, slug: member.slug, role: member.role, lead: member.lead })
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

	/** Extends a pending burst (section 6.1). Nothing is sent. */
	humanTyping(): void {
		this.ctx.waitUntil(this.burst.typing())
	}

	/**
	 * RPC for an agent in this room (section 6.3). Stores one closed block of a run's answer. A repeated
	 * `(runId, attempt, index)` stores nothing. A higher attempt deletes the bubbles of earlier attempts.
	 * Returns true when this call stored the bubble.
	 */
	async post(slug: AgentSlug, runId: string, attempt: number, index: number, block: string): Promise<boolean> {
		const events = this.bubbles.post(slug, { runId, attempt, index }, block)
		this.publish(events)
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

	/** RPC for an agent. A growing block past the draft threshold. Sent, never stored. */
	async draft(slug: AgentSlug, runId: string, index: number, text: string): Promise<void> {
		this.broadcast({ t: "draft", slug, runId, index, text })
	}

	/**
	 * RPC for an agent. Stores the member's latest state (only the latest) and sends the change, and
	 * the typing set with it. A slug that is not a member stores and sends nothing.
	 */
	async setStatus(slug: AgentSlug, state: AgentState): Promise<void> {
		if (!this.members.setStatus(slug, state)) return
		this.broadcast({ t: "status", slug, state })
		await this.setTyping(slug, state === "typing")
		// A marker that outlives the process, so a room that starts after a restart knows a run was live.
		if (state === "idle") this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", `live:${slug}`)
		else this.log.setMeta(`live:${slug}`, "1")
	}

	/**
	 * RPC for an agent. The run answered or failed. Touches the user's chat list once per run: a repeat
	 * after a crash finds the run ended, and `touchChat` ignores a `lastSeq` it already has.
	 */
	async endRun(slug: AgentSlug, runId: string): Promise<void> {
		await this.setStatus(slug, "idle")
		const home = this.home()
		if (!home || this.bubbles.ended(runId)) return
		await userStub(this.env.USER, home.userId).touchChat(home.roomId, this.bubbles.touch())
		this.bubbles.markEnded(runId)
	}

	/** RPC for an agent in this room. Broadcasts who is typing, without storing it. */
	async setTyping(slug: AgentSlug, typing: boolean): Promise<void> {
		const had = this.typing.has(slug)
		if (typing === had) return
		if (typing) this.typing.add(slug)
		else this.typing.delete(slug)
		this.broadcast({ t: "typing", who: [...this.typing] })
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

	/** Development only. Makes `slug` a member and stores one message from it, for the deletion check. */
	async devAgentMessage(slug: AgentSlug, text: string): Promise<void> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		const added = this.members.apply({ op: "add", slug, name: slug })
		if (added.ok) this.publish(added.events)
		const { event } = this.log.addMessage({ from: { kind: "agent", slug }, text })
		if (event) this.publish([event])
	}
}
