
import type {
	Actor,
	AgentSlug,
	FileRef,
	Message,
	MessageId,
	Reaction,
	ReplyPreview,
	RichText,
	RoomEvent,
	RoomSnapshot,
	RunRef,
	RunStep,
	Sender,
	SystemEvent,
	RoomId } from "@kiko/protocol"
import { listSpace, ROOM_TABLES } from "../files/file-index"
import { listMembers } from "./members"
import { listAsks } from "./human-asks"
import { agentStatuses } from "./status"
import { type HeardStep, RunSteps } from "./steps"
import { listTasks } from "./workspace"

export const REPLAY_LIMIT = 500
export const KEEP_EVENTS = 2 * REPLAY_LIMIT
const TRIM_EVERY = 100
export const SNAPSHOT_MESSAGES = 200
// The meta key of the kept unread count (see RoomLog.unread).
const UNREAD = "unread"

// A private event is for the owner's transcript only: no agent, memory pass, search or chat preview reads it.
const PUBLIC_MESSAGE = "(event IS NULL OR json_extract(event, '$.private') IS NOT 1)"

// Mail between agents sits behind a divider in the transcript, so a preview or a search result does not quote it either.
export const LISTED_MESSAGE = `${PUBLIC_MESSAGE} AND addressed IS NULL`

const PREVIEW_CHARS = 140

/** What a reply's quote shows for a message: its words cut short, or what its files are. */
export function previewText(text: string, files: readonly Pick<FileRef, "name" | "type">[] = []): string {
	const body = text.replace(/\s+/g, " ").trim()
	if (body) return body.length > PREVIEW_CHARS ? `${Array.from(body).slice(0, PREVIEW_CHARS - 1).join("")}…` : body
	const images = files.filter((f) => f.type.startsWith("image/")).length
	const others = files.filter((f) => !f.type.startsWith("image/"))
	if (!files.length) return ""
	if (!others.length) return images > 1 ? `${images} photos` : "Photo"
	const rest = files.length - 1
	return rest > 0 ? `${others[0]!.name} and ${rest} more` : others[0]!.name
}

export const isPrivate = (m: { event?: { kind: string } }): boolean => (m.event as { private?: boolean } | undefined)?.private === true

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
	goto: string | null
	quote: string | null
	addressed: string | null
	initiative: string | null
	steps: number | null
	step_after: number | null
	event: string | null
}

export type NewMessage = {
	from: Sender
	text: string
	rich?: RichText
	replyTo?: MessageId
	files?: readonly FileRef[]
	run?: RunRef
	clientId?: string
	goto?: RoomId
	quote?: string
	to?: AgentSlug | "all"
	initiative?: { reason: string }
	event?: SystemEvent
}

export function actorKey(who: Sender): string {
	if (who.kind === "human") return "human"
	return who.kind === "agent" ? `agent:${who.slug}` : `system:${who.reason}`
}

function actorFromKey(key: string): Actor {
	return key === "human" ? { kind: "human" } : ({ kind: "agent", slug: key.slice("agent:".length) } as Actor)
}

export class RoomLog {
	/** The tool calls of agents. The log stamps them as it hears them and counts each agent's since its last message. */
	readonly steps: RunSteps
	/** Each agent's open window: the seq of its last message to the human, and how many steps it made since. Read once per wake. */
	private readonly windows = new Map<string, { after: number; count: number }>()

	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly now: () => number = Date.now,
	) {
		this.steps = new RunSteps(storage, now)
	}

	private get sql() {
		return this.storage.sql
	}

	private window(slug: string): { after: number; count: number } {
		let open = this.windows.get(slug)
		if (!open) {
			const after =
				this.sql
					.exec<{ seq: number }>(
						"SELECT seq FROM messages WHERE json_extract(sender, '$.kind') = 'agent' AND json_extract(sender, '$.slug') = ? AND addressed IS NULL ORDER BY seq DESC LIMIT 1",
						slug,
					)
					.toArray()[0]?.seq ?? 0
			open = { after, count: this.steps.count(slug, after) }
			this.windows.set(slug, open)
		}
		return open
	}

	/** A step began or ended. Stamps it with its agent's open window and returns it when the panel should hear of it. */
	hearStep(heard: HeardStep): RunStep | null {
		const open = this.window(heard.slug)
		if (heard.status === "running") {
			const step = this.steps.start(heard, open.after)
			if (step) open.count++
			return step
		}
		const ended = this.steps.finish(heard, open.after)
		if (ended?.fresh) open.count++
		return ended?.step ?? null
	}

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

	since(seq: number): RoomEvent[] {
		return this.sql
			.exec<{ seq: number; at: number; payload: string }>(
				"SELECT seq, at, payload FROM events WHERE seq > ? ORDER BY seq",
				seq,
			)
			.toArray()
			.map((r) => ({ ...(JSON.parse(r.payload) as Body), seq: r.seq, at: r.at }) as RoomEvent)
	}

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
		const members = listMembers(this.storage)
		// Only an agent with steps since its last message has a tail to send.
		const open = new Map(members.map((m) => [m.slug as string, this.window(m.slug)] as const))
		const pending = new Map([...open].flatMap(([slug, w]) => (w.count ? [[slug, w.after] as const] : [])))
		const steps = this.steps.tails(pending)
		return {
			seq: this.lastSeq(),
			readSeq: this.readSeq(),
			members,
			messages: this.withReactions(rows),
			tasks: listTasks(this.storage),
			...listSpace(this.storage, ROOM_TABLES),
			agents: agentStatuses(this.storage.sql),
			asks: listAsks(this.storage.sql),
			...(steps.length ? { steps } : {}),
		}
	}

	/**
	 * Live messages around `seq`, oldest first: up to `before` older than `seq`, then up to `after`
	 * at or after it. Both ends read the seq index, so the cost is the window, not the room.
	 */
	around(seq: number, before: number, after: number): Message[] {
		const older = before
			? this.sql
					.exec<MessageRow>("SELECT * FROM messages WHERE seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?", seq, before)
					.toArray()
					.reverse()
			: []
		const newer = after
			? this.sql.exec<MessageRow>("SELECT * FROM messages WHERE seq >= ? AND deleted_at IS NULL ORDER BY seq LIMIT ?", seq, after).toArray()
			: []
		return this.withReactions([...older, ...newer])
	}

	/** What each message in `ids` says now, deleted or not, so a reply to it can quote it. Another kind of sender has no quote. */
	private previews(ids: readonly string[]): Map<string, ReplyPreview> {
		const out = new Map<string, ReplyPreview>()
		if (!ids.length) return out
		for (const r of this.sql
			.exec<MessageRow>("SELECT * FROM messages WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(ids))
			.toArray()) {
			const from = JSON.parse(r.sender) as Sender
			if (from.kind === "system") continue
			out.set(
				r.id,
				r.deleted_at !== null
					? { seq: r.seq, from, text: "", gone: true }
					: { seq: r.seq, from, text: previewText(r.text, r.files ? (JSON.parse(r.files) as FileRef[]) : undefined) },
			)
		}
		return out
	}

	/** Messages for rows, with the reactions of every row read in one query, not one per message. */
	private withReactions(rows: MessageRow[]): Message[] {
		if (!rows.length) return []
		const replies = this.previews([...new Set(rows.flatMap((r) => (r.reply_to ? [r.reply_to] : [])))])
		const reactions = new Map<string, Reaction[]>()
		for (const x of this.sql
			.exec<{ message_id: string; actor: string; emoji: string }>(
				`SELECT message_id, actor, emoji FROM reactions WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY at`,
				JSON.stringify(rows.map((r) => r.id)),
			)
			.toArray()) {
			const list = reactions.get(x.message_id) ?? []
			list.push({ by: actorFromKey(x.actor), emoji: x.emoji })
			reactions.set(x.message_id, list)
		}
		return rows.map((r) => this.toMessage(r, reactions.get(r.id) ?? [], replies))
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

	/** Live message ids of a run from attempts before `attempt`, at `fromIndex` or later. */
	earlierAttempts(runId: string, attempt: number, fromIndex = 0): MessageId[] {
		return this.sql
			.exec<{ id: string }>(
				"SELECT id FROM messages WHERE run_id = ? AND run_attempt < ? AND run_index >= ? AND deleted_at IS NULL ORDER BY seq",
				runId,
				attempt,
				fromIndex,
			)
			.toArray()
			.map((r) => r.id as MessageId)
	}

	/**
	 * Moves a live bubble of an earlier attempt to `run`'s attempt when it holds the same text at the
	 * same index, so a restarted run that writes it again keeps the bubble where it was. True when moved.
	 */
	adoptBubble(run: RunRef, text: string, replyTo: string | null): boolean {
		const row = this.sql
			.exec<{ id: string }>(
				"SELECT id FROM messages WHERE run_id = ? AND run_attempt < ? AND run_index = ? AND text = ? AND reply_to IS ? AND deleted_at IS NULL",
				run.runId,
				run.attempt,
				run.index,
				text,
				replyTo,
			)
			.toArray()[0]
		if (!row) return false
		this.sql.exec("UPDATE messages SET run_attempt = ? WHERE id = ?", run.attempt, row.id)
		return true
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
			// Counted once, when the message is posted, and kept: the agent's steps the room has heard of since its last message.
			// Mail to another agent is not one: the human reads it behind a divider, so the steps wait for the next message.
			const open = input.from.kind === "agent" && !input.to ? this.window(input.from.slug) : null
			const steps = open?.count ?? 0
			const reply = input.replyTo ? this.previews([input.replyTo]).get(input.replyTo) : undefined
			const message: Omit<Message, "seq" | "at"> = {
				id,
				from: input.from,
				text: input.text,
				...(input.rich ? { rich: input.rich } : {}),
				...(input.replyTo ? { replyTo: input.replyTo } : {}),
				...(reply ? { reply } : {}),
				...(input.files?.length ? { files: input.files } : {}),
				...(input.run ? { run: input.run } : {}),
				...(open && steps ? { steps, stepAfter: open.after } : {}),
				...(input.goto ? { goto: input.goto } : {}),
				...(input.quote ? { quote: input.quote } : {}),
				...(input.to ? { to: input.to } : {}),
				...(input.initiative ? { initiative: input.initiative } : {}),
				...(input.event ? { event: input.event } : {}),
			}
			const event = this.append(actorKey(input.from), {
				t: "message",
				...(input.clientId ? { clientId: input.clientId } : {}),
				...message,
			} as Body)
			this.sql.exec(
				`INSERT INTO messages (id, seq, at, sender, text, rich, reply_to, files, run_id, run_attempt, run_index, goto, quote, addressed, initiative, event, steps, step_after)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				input.goto ?? null,
				input.quote ?? null,
				input.to ?? null,
				input.initiative?.reason ?? null,
				input.event ? JSON.stringify(input.event) : null,
				steps || null,
				open && steps ? open.after : null,
			)
			if (open && input.from.kind === "agent") this.windows.set(input.from.slug, { after: event.seq, count: 0 })
			if (input.clientId) {
				this.sql.exec("INSERT INTO clients (client_id, message_id, seq) VALUES (?, ?, ?)", input.clientId, id, event.seq)
			}
			// A new message is past the read mark, so it is unread unless the human wrote it.
			if (input.from.kind !== "human" && !isPrivate(input)) this.adjustUnread(1)
			return { id, seq: event.seq, event }
		})
	}

	editMessage(id: MessageId, text: string, rich?: RichText): RoomEvent | null {
		return this.storage.transactionSync(() => {
			const current = this.message(id)
			if (!current || current.text === text) return null
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

	deleteMessages(ids: readonly MessageId[], by: Actor): RoomEvent | null {
		return this.storage.transactionSync(() => {
			const live = ids.flatMap((id) => {
				const m = this.message(id)
				return m ? [m] : []
			})
			if (!live.length) return null
			const event = this.append(actorKey(by), { t: "delete", messageIds: live.map((m) => m.id) })
			const read = this.readSeq()
			let unread = 0
			for (const m of live) {
				this.sql.exec("UPDATE messages SET deleted_at = ? WHERE id = ?", event.at, m.id)
				this.sql.exec("DELETE FROM reactions WHERE message_id = ?", m.id)
				if (m.from.kind !== "human" && !isPrivate(m) && m.seq > read) unread++
			}
			this.adjustUnread(-unread)
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
			const from = this.readSeq()
			const upTo = Math.min(seq, this.lastSeq())
			if (upTo <= from) return null
			// The read event itself is after upTo, so it never counts as unread.
			const event = this.append("human", { t: "read", upTo })
			this.setMeta("read_seq", String(upTo))
			this.adjustUnread(-this.countNonHuman(from, upTo))
			return event
		})
	}

	/**
	 * Live messages from anyone but the human, after the read mark: the chat's unread count. It is kept in
	 * meta once counted, so a send does not count the chat again. The first call counts it.
	 */
	unread(): number {
		const kept = this.meta(UNREAD)
		if (kept !== null) return Number(kept)
		const n = this.countNonHuman(this.readSeq(), Number.MAX_SAFE_INTEGER)
		this.setMeta(UNREAD, String(n))
		return n
	}

	/** Moves the kept count, if one is kept. When none is, the next unread() counts the chat from the rows. */
	private adjustUnread(by: number): void {
		const kept = this.meta(UNREAD)
		if (kept !== null && by !== 0) this.setMeta(UNREAD, String(Number(kept) + by))
	}

	/** Live messages from anyone but the human with seq in (after, upTo]. */
	private countNonHuman(after: number, upTo: number): number {
		return this.sql
			.exec<{ n: number }>(
				`SELECT count(*) AS n FROM messages WHERE deleted_at IS NULL AND seq > ? AND seq <= ? AND json_extract(sender, '$.kind') != 'human' AND ${PUBLIC_MESSAGE}`,
				after,
				upTo,
			)
			.one().n
	}

	/** Stores one event and returns it with its seq. Call inside a transaction with the state change. */
	/** The newest message `slug` posted after `after`, or null. */
	lastAgentMessage(slug: string, after: number): { seq: number; text: string } | null {
		return (
			this.sql
				.exec<{ seq: number; text: string }>("SELECT seq, text FROM messages WHERE seq > ? AND json_extract(sender, '$.kind') = 'agent' AND json_extract(sender, '$.slug') = ? ORDER BY seq DESC LIMIT 1", after, slug)
				.toArray()[0] ?? null
		)
	}

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
		if (seq % TRIM_EVERY === 0) this.sql.exec("DELETE FROM events WHERE seq <= ?", seq - KEEP_EVENTS)
		return { ...body, seq, at } as RoomEvent
	}

	/** `reactions` are the message's, when the caller loaded them for many rows at once. */
	private toMessage(r: MessageRow, preloaded?: Reaction[], replies?: ReadonlyMap<string, ReplyPreview>): Message {
		const reply = r.reply_to ? (replies ?? this.previews([r.reply_to])).get(r.reply_to) : undefined
		const reactions: Reaction[] =
			preloaded ??
			this.sql
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
			...(reply ? { reply } : {}),
			...(r.files ? { files: JSON.parse(r.files) as FileRef[] } : {}),
			...(r.run_id !== null
				? { run: { runId: r.run_id, attempt: r.run_attempt ?? 0, index: r.run_index ?? 0 } }
				: {}),
			...(r.steps ? { steps: r.steps, stepAfter: r.step_after ?? 0 } : {}),
			...(r.edited_at !== null ? { editedAt: r.edited_at } : {}),
			...(r.goto ? { goto: r.goto as RoomId } : {}),
			...(r.quote ? { quote: r.quote } : {}),
			...(r.addressed ? { to: r.addressed as AgentSlug | "all" } : {}),
			...(r.initiative ? { initiative: { reason: r.initiative } } : {}),
			...(r.event ? { event: JSON.parse(r.event) as SystemEvent } : {}),
			...(reactions.length ? { reactions } : {}),
		}
	}
}
