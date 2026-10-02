// The room's event log. Architecture section 9.2. Every change a human can see
// is one row in `events` with a seq that only increases, plus the current state
// in `messages` and `reactions`. Each write method stores the event and the state
// in one transaction and returns the event. It never sends anything: the caller
// broadcasts what it gets back.

import type {
	Actor,
	FileRef,
	Message,
	MessageId,
	Reaction,
	RichText,
	RoomEvent,
	RoomSnapshot,
	RunRef,
	Sender,
} from "@kiko/protocol"
import { listFiles } from "./files"
import { listMembers } from "./members"

/** A `hello` further behind than this gets a `reset` instead of events. */
export const REPLAY_LIMIT = 500
/** The newest messages a `reset` snapshot carries. ASSUMPTION: the number. */
export const SNAPSHOT_MESSAGES = 200

type Body = RoomEvent extends infer E ? (E extends unknown ? Omit<E, "seq" | "at"> : never) : never

type MessageRow = {
	id: string
	seq: number
	at: number
	sender: string
	text: string
	rich: string | null
	reply_to: string | null
	files: string | null
	run_id: string | null
	run_attempt: number | null
	run_index: number | null
	edited_at: number | null
	deleted_at: number | null
}

export type NewMessage = {
	from: Sender
	text: string
	rich?: RichText
	replyTo?: MessageId
	files?: readonly FileRef[]
	run?: RunRef
	/** Set on human sends. A repeated clientId stores nothing. */
	clientId?: string
}

/** The stored form of an actor or sender: "human", "agent:<slug>", or "system:<reason>". */
export function actorKey(who: Sender): string {
	if (who.kind === "human") return "human"
	return who.kind === "agent" ? `agent:${who.slug}` : `system:${who.reason}`
}

function actorFromKey(key: string): Actor {
	return key === "human" ? { kind: "human" } : ({ kind: "agent", slug: key.slice("agent:".length) } as Actor)
}

export class RoomLog {
	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly now: () => number = Date.now,
	) {}

	private get sql() {
		return this.storage.sql
	}

	/** The seq of the newest event, or 0 for an empty room. */
	lastSeq(): number {
		return this.sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM events").one().seq ?? 0
	}

	readSeq(): number {
		return Number(this.meta("read_seq") ?? 0)
	}

	meta(key: string): string | null {
		return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null
	}

	setMeta(key: string, value: string): void {
		this.sql.exec(
			"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			key,
			value,
		)
	}

	/** Events after `seq`, oldest first. */
	since(seq: number): RoomEvent[] {
		return this.sql
			.exec<{ seq: number; at: number; payload: string }>(
				"SELECT seq, at, payload FROM events WHERE seq > ? ORDER BY seq",
				seq,
			)
			.toArray()
			.map((r) => ({ ...(JSON.parse(r.payload) as Body), seq: r.seq, at: r.at }) as RoomEvent)
	}

	/** What a `hello` gets: the events after `lastSeq`, or a snapshot when they are too many or the client is ahead. */
	catchUp(lastSeq: number): { t: "events"; events: RoomEvent[] } | { t: "reset"; snapshot: RoomSnapshot } {
		const last = this.lastSeq()
		if (lastSeq > last || last - lastSeq > REPLAY_LIMIT) return { t: "reset", snapshot: this.snapshot() }
		return { t: "events", events: this.since(lastSeq) }
	}

	snapshot(): RoomSnapshot {
		const rows = this.sql
			.exec<MessageRow>(
				"SELECT * FROM (SELECT * FROM messages WHERE deleted_at IS NULL ORDER BY seq DESC LIMIT ?) ORDER BY seq",
				SNAPSHOT_MESSAGES,
			)
			.toArray()
		// ASSUMPTION: tasks and approvals are empty until the tasks that own those tables fill them in.
		return {
			seq: this.lastSeq(),
			readSeq: this.readSeq(),
			members: listMembers(this.storage),
			messages: rows.map((r) => this.toMessage(r)),
			tasks: [],
			approvals: [],
			files: listFiles(this.storage),
		}
	}

	/** A live (not deleted) message, or null. */
	message(id: string): Message | null {
		const row = this.sql
			.exec<MessageRow>("SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL", id)
			.toArray()[0]
		return row ? this.toMessage(row) : null
	}

	/** The first ack for a clientId that was already stored. */
	sentBefore(clientId: string): { id: MessageId; seq: number } | null {
		const row = this.sql
			.exec<{ message_id: string; seq: number }>("SELECT message_id, seq FROM clients WHERE client_id = ?", clientId)
			.toArray()[0]
		return row ? { id: row.message_id as MessageId, seq: row.seq } : null
	}

	/** The id of the message stored for one agent bubble, deleted or not. */
	messageForRun(run: RunRef): { id: MessageId; seq: number } | null {
		const row = this.sql
			.exec<{ id: string; seq: number }>(
				"SELECT id, seq FROM messages WHERE run_id = ? AND run_attempt = ? AND run_index = ?",
				run.runId,
				run.attempt,
				run.index,
			)
			.toArray()[0]
		return row ? { id: row.id as MessageId, seq: row.seq } : null
	}

	/** Live message ids of a run from attempts before `attempt`. */
	earlierAttempts(runId: string, attempt: number): MessageId[] {
		return this.sql
			.exec<{ id: string }>(
				"SELECT id FROM messages WHERE run_id = ? AND run_attempt < ? AND deleted_at IS NULL ORDER BY seq",
				runId,
				attempt,
			)
			.toArray()
			.map((r) => r.id as MessageId)
	}

	/**
	 * Stores a message. With a clientId that was stored before, or a run key that
	 * was stored before, it stores nothing and returns `event: null` with the first id and seq.
	 */
	addMessage(input: NewMessage): { id: MessageId; seq: number; event: RoomEvent | null } {
		return this.storage.transactionSync(() => {
			const earlier = input.clientId ? this.sentBefore(input.clientId) : input.run ? this.messageForRun(input.run) : null
			if (earlier) return { ...earlier, event: null }
			const id = crypto.randomUUID() as MessageId
			const message: Omit<Message, "seq" | "at"> = {
				id,
				from: input.from,
				text: input.text,
				...(input.rich ? { rich: input.rich } : {}),
				...(input.replyTo ? { replyTo: input.replyTo } : {}),
				...(input.files?.length ? { files: input.files } : {}),
				...(input.run ? { run: input.run } : {}),
			}
			const event = this.append(actorKey(input.from), {
				t: "message",
				...(input.clientId ? { clientId: input.clientId } : {}),
				...message,
			} as Body)
			this.sql.exec(
				`INSERT INTO messages (id, seq, at, sender, text, rich, reply_to, files, run_id, run_attempt, run_index)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				id,
				event.seq,
				event.at,
				JSON.stringify(input.from),
				input.text,
				input.rich ? JSON.stringify(input.rich) : null,
				input.replyTo ?? null,
				input.files?.length ? JSON.stringify(input.files) : null,
				input.run?.runId ?? null,
				input.run?.attempt ?? null,
				input.run?.index ?? null,
			)
			if (input.clientId) {
				this.sql.exec("INSERT INTO clients (client_id, message_id, seq) VALUES (?, ?, ?)", input.clientId, id, event.seq)
			}
			return { id, seq: event.seq, event }
		})
	}

	/** Replaces a live message's text. Returns null when the message is gone or the text is the same. */
	editMessage(id: MessageId, text: string, rich?: RichText): RoomEvent | null {
		return this.storage.transactionSync(() => {
			const current = this.message(id)
			if (!current || (current.text === text && !rich)) return null
			const event = this.append(actorKey(current.from), {
				t: "edit",
				messageId: id,
				text,
				...(rich ? { rich } : {}),
			})
			this.sql.exec(
				"UPDATE messages SET text = ?, rich = ?, edited_at = ? WHERE id = ?",
				text,
				rich ? JSON.stringify(rich) : current.rich ? JSON.stringify(current.rich) : null,
				event.at,
				id,
			)
			return event
		})
	}

	/** Deletes the live messages among `ids` as one event. Returns null when none is live. */
	deleteMessages(ids: readonly MessageId[], by: Actor): RoomEvent | null {
		return this.storage.transactionSync(() => {
			const live = ids.filter((id) => this.message(id))
			if (!live.length) return null
			const event = this.append(actorKey(by), { t: "delete", messageIds: live })
			for (const id of live) {
				this.sql.exec("UPDATE messages SET deleted_at = ? WHERE id = ?", event.at, id)
				this.sql.exec("DELETE FROM reactions WHERE message_id = ?", id)
			}
			return event
		})
	}

	/** Sets or removes `by`'s reaction. Returns null when nothing changes. */
	react(messageId: MessageId, by: Actor, emoji: string | null): RoomEvent | null {
		return this.storage.transactionSync(() => {
			if (!this.message(messageId)) return null
			const key = actorKey(by)
			const current = this.sql
				.exec<{ emoji: string }>("SELECT emoji FROM reactions WHERE message_id = ? AND actor = ?", messageId, key)
				.toArray()[0]?.emoji
			if ((current ?? null) === emoji) return null
			const event = this.append(key, { t: "react", messageId, by, emoji })
			if (emoji === null) this.sql.exec("DELETE FROM reactions WHERE message_id = ? AND actor = ?", messageId, key)
			else
				this.sql.exec(
					"INSERT INTO reactions (message_id, actor, emoji, at) VALUES (?, ?, ?, ?) ON CONFLICT(message_id, actor) DO UPDATE SET emoji = excluded.emoji, at = excluded.at",
					messageId,
					key,
					emoji,
					event.at,
				)
			return event
		})
	}

	/** Moves the human's read mark forward. It never moves back or past the log. */
	markRead(seq: number): RoomEvent | null {
		return this.storage.transactionSync(() => {
			const upTo = Math.min(seq, this.lastSeq())
			if (upTo <= this.readSeq()) return null
			// The read event itself is after upTo, so it never counts as unread.
			const event = this.append("human", { t: "read", upTo })
			this.setMeta("read_seq", String(upTo))
			return event
		})
	}

	/** Stores one event and returns it with its seq. Call inside a transaction with the state change. */
	append(actor: string, body: Body): RoomEvent {
		const at = this.now()
		const { seq } = this.sql
			.exec<{ seq: number }>(
				"INSERT INTO events (kind, at, actor, payload) VALUES (?, ?, ?, ?) RETURNING seq",
				body.t,
				at,
				actor,
				JSON.stringify(body),
			)
			.one()
		return { ...body, seq, at } as RoomEvent
	}

	private toMessage(r: MessageRow): Message {
		const reactions: Reaction[] = this.sql
			.exec<{ actor: string; emoji: string }>(
				"SELECT actor, emoji FROM reactions WHERE message_id = ? ORDER BY at",
				r.id,
			)
			.toArray()
			.map((x) => ({ by: actorFromKey(x.actor), emoji: x.emoji }))
		return {
			id: r.id as MessageId,
			seq: r.seq,
			at: r.at,
			from: JSON.parse(r.sender) as Sender,
			text: r.text,
			...(r.rich ? { rich: JSON.parse(r.rich) as RichText } : {}),
			...(r.reply_to ? { replyTo: r.reply_to as MessageId } : {}),
			...(r.files ? { files: JSON.parse(r.files) as FileRef[] } : {}),
			...(r.run_id !== null
				? { run: { runId: r.run_id, attempt: r.run_attempt ?? 0, index: r.run_index ?? 0 } }
				: {}),
			...(r.edited_at !== null ? { editedAt: r.edited_at } : {}),
			...(reactions.length ? { reactions } : {}),
		}
	}
}
