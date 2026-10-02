import type { AgentSlug, RoomEvent, RoomToClient } from "@kiko/protocol"
import { DurableObject } from "cloudflare:workers"
import type { Env } from "../index"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../lib/names"
import { storedRows, wipeStorage } from "../lib/wipe"
import { Deliveries, type ReminderDelivery } from "./deliver"
import { type NewFile, type PutResult, RoomFiles } from "./files"
import { RoomLog } from "./log"
import { migrate } from "./schema"
import { searchMessages } from "./search"
import { type Attachment, attachment, handleFrame, send, type SocketRoom } from "./socket"

declare const process: { env: { NODE_ENV?: string } }

// Architecture sections 4.1 and 9. One room per chat. This file holds the
// socket entry points and the broadcast. The log is in log.ts, frames in socket.ts.

export class RoomDO extends DurableObject<Env> implements SocketRoom {
	readonly log: RoomLog
	private readonly deliveries: Deliveries
	readonly files: RoomFiles
	// ASSUMPTION: which agents are typing is kept in memory only, so a typing
	// change costs no write. Hibernation forgets it, and the next setTyping call
	// sends the set as it is then.
	private readonly typing = new Set<AgentSlug>()

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
		migrate(ctx.storage)
		this.log = new RoomLog(ctx.storage)
		this.deliveries = new Deliveries(ctx.storage, this.log)
		this.files = new RoomFiles(ctx.storage, this.log)
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return new Response("expected a websocket upgrade", { status: 426 })
		}
		// The Worker sets both headers from the session. Later tasks need them to reach the user and the agents.
		const userId = request.headers.get(USER_ID_HEADER)
		const roomId = request.headers.get(ROOM_ID_HEADER)
		if (!userId || !roomId) return new Response("missing room identity", { status: 400 })
		if (this.log.meta("user_id") === null) {
			this.log.setMeta("user_id", userId)
			this.log.setMeta("room_id", roomId)
		}
		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
		this.ctx.acceptWebSocket(server)
		server.serializeAttachment({ ready: false } satisfies Attachment)
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
		if (events.length) this.broadcast({ t: "events", events })
	}

	/** Sends a frame that is not stored (typing, draft, status) to every ready socket. */
	broadcast(frame: RoomToClient): void {
		for (const ws of this.ctx.getWebSockets()) if (attachment(ws).ready) send(ws, frame)
	}

	search(query: string, before?: number, limit?: number) {
		return searchMessages(this.ctx.storage.sql, query, before, limit)
	}

	/** RPC for the user's `UserDO`. Returns false when `id` was delivered before. */
	async deliverReminder(id: string, reminder: ReminderDelivery): Promise<boolean> {
		const event = this.deliveries.reminder(id, reminder)
		if (event) this.publish([event])
		return event !== null
	}

	/** RPC for the Worker's upload route and file tools. Indexes a stored object and broadcasts the change. */
	async putFile(input: NewFile): Promise<Omit<PutResult, "event">> {
		const { event, ...result } = this.files.put(input)
		if (event) this.publish([event])
		return result
	}

	humanTyping(): void {
		// The burst task (P1-11) extends the debounce here. Nothing is stored or sent.
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

	/** The agents that have acted in this room and the R2 keys its file index holds. */
	async inventory(): Promise<{ agents: AgentSlug[]; keys: string[] }> {
		if (this.#wiped) return { agents: [], keys: [] }
		const sql = this.ctx.storage.sql
		// ASSUMPTION: until the members table exists (P1-06), an agent of the room is any agent actor that stored an event.
		const agents = sql
			.exec<{ actor: string }>("SELECT DISTINCT actor FROM events WHERE actor LIKE 'agent:%'")
			.toArray()
			.map((r) => r.actor.slice("agent:".length) as AgentSlug)
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

	/** Development only. Stores one message from `slug`, so the room lists an agent before agents exist (P1-06). */
	async devAgentMessage(slug: AgentSlug, text: string): Promise<void> {
		if (process.env.NODE_ENV !== "development") throw new Error("not found")
		const { event } = this.log.addMessage({ from: { kind: "agent", slug }, text })
		if (event) this.publish([event])
	}
}
