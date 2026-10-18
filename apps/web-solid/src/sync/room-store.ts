import { humanAnswerText, type HumanAnswers, type KikoError } from "@kiko/protocol"
// The open room.
//
// It holds the visible message window in a Solid store, keeps the warm tier in
// step, and talks to the room over one reconnecting socket.
//
// Boot: read the newest messages, the room's state, `lastSeq`, and the outbox
// from IndexedDB, then connect with `hello {lastSeq}`.
//
// Events are queued and applied in `seq` order in slices of at most `budgetMs`,
// with a yield between slices, so a long replay never holds the main thread
// for a frame.
//
// Every action applies a patch at once and returns. A send goes to the outbox
// before the socket. Every pending frame goes out again after a reconnect. The
// room drops a repeated `clientId`, so a resend never makes a second message.
//
// `messages()` and the other views are plain functions over the store. They
// are reactive where they are read. Wrap one in `createMemo` to share it.

import type { LocalAttachment } from "./patches"
import type {
	Actor,
	FileOp,
	AgentSlug,
	AgentState,
	AgentStatus,
	ClientToRoom,
	FileRef,
	HumanAsk,
	PendingAttachment,
	Member,
	MemberOp,
	MemberRefusal,
	Message,
	MessageId,
	RoomEvent,
	RoomId,
	RoomSnapshot,
	RoomToClient,
	RunStep,
	SearchHit,
	Task,
	TaskOp,
} from "@kiko/protocol"
import { batch } from "solid-js"
import { $RAW, createStore, produce } from "solid-js/store"
import type { Warm } from "../warm/db"
import { clearRoom, deleteMessages, getLastSeq, KEEP_ON_DISK, messagesBefore, newestMessages, putMessages, setLastSeq, storedMessages, dropBefore } from "../warm/messages"
import { addToOutbox, outbox, removeFromOutbox } from "../warm/outbox"
import {
	expire,
	overlayFiles,
	overlayFolders,
	overlayMembers,
	overlayMessages,
	overlayReadSeq,
	overlayTasks,
	PATCH_TTL_MS,
	type RoomPatch,
	type RoomPatchFrame,
	settleRoom,
	type ViewMessage,
} from "./patches"
import { upsertStep, windowKey } from "../chat/run/run-log"
import { type Backoff, type Connect, createSyncSocket, type SocketStatus, type SyncSocket } from "./socket"
import { retryFailedUploads } from "./uploads"

// The room's durable state and the one reducer for it. The mock room uses the
// same reducer, so the client and the fake server cannot drift apart.

export type RoomData = {
	/** The newest `seq` applied. */
	seq: number
	readSeq: number
	members: Member[]
	/** Oldest first. The window, not the whole history. */
	messages: Message[]
	tasks: Task[]
	files: FileRef[]
	/** Every folder, empty ones included. */
	folders: string[]
	agents: AgentStatus[]
	asks: HumanAsk[]
}

/**
 * The most messages the open room holds in memory while the reader follows the end. Older ones
 * stay in IndexedDB and come back a page at a time when the reader scrolls up (`loadOlder`).
 * The window is cut back only once it is `WINDOW_SLACK` over, so most new messages cost no cut.
 */
export const MAX_MESSAGES_IN_MEMORY = 200
export const WINDOW_SLACK = 50

export const emptyRoom = (): RoomData => ({
	seq: 0,
	readSeq: 0,
	members: [],
	messages: [],
	tasks: [],
	files: [],
	folders: [],
	agents: [],
	asks: [],
})

export function fromSnapshot(s: RoomSnapshot): RoomData {
	return {
		seq: s.seq,
		readSeq: s.readSeq,
		members: [...s.members],
		messages: [...s.messages],
		tasks: [...s.tasks],
		files: [...s.files],
		folders: [...s.folders],
		agents: [...(s.agents ?? [])],
		asks: [...(s.asks ?? [])],
	}
}

/** A `message` event without its frame fields. */
export function toMessage(e: Extract<RoomEvent, { t: "message" }>): Message {
	const { t: _, clientId: __, ...m } = e
	return m
}

/**
 * The object under a store proxy, or the object itself. Unlike `unwrap`, it
 * never walks a plain object, so it costs nothing per call.
 */
const raw = <T>(value: T): T => ((value as { [$RAW]?: T })[$RAW] ?? value)

/** Searches the raw array. Reading through a store proxy would wrap every item on the way. */
const findMessage = (messages: readonly Message[], id: MessageId) => {
	const list = raw(messages)
	for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id) return i
	return -1
}

const sameActor = (a: Actor, b: Actor) =>
	a.kind === "human" ? b.kind === "human" : b.kind === "agent" && a.slug === b.slug

const upsert = <T>(list: T[], item: T, same: (x: T) => boolean) => {
	const i = list.findIndex(same)
	if (i === -1) list.push(item)
	else list[i] = item
}

const removeWhere = <T>(list: T[], match: (x: T) => boolean) => {
	for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) list.splice(i, 1)
}

/** What an event did to the message window, for the warm tier. */
export type Change = { put?: Message; deleted?: Message[]; meta?: true }

/**
 * Applies one event to `data` in place. Works on a plain object and inside
 * Solid's `produce`. An event at or below `data.seq` is skipped.
 */
export function applyRoomEvent(data: RoomData, e: RoomEvent): Change | null {
	if (e.seq <= data.seq) return null
	data.seq = e.seq
	switch (e.t) {
		case "message": {
			const m = toMessage(e)
			const i = findMessage(data.messages, m.id)
			if (i === -1) data.messages.push(m)
			else data.messages[i] = m
			return { put: m }
		}
		case "edit": {
			const i = findMessage(data.messages, e.messageId)
			if (i === -1) return {}
			const m = data.messages[i]
			m.text = e.text
			m.editedAt = e.at
			if (e.rich) m.rich = e.rich
			else delete m.rich
			return { put: raw(m) }
		}
		case "delete": {
			const deleted: Message[] = []
			for (const id of e.messageIds) {
				const i = findMessage(data.messages, id)
				if (i !== -1) deleted.push(raw(data.messages[i]))
				if (i !== -1) data.messages.splice(i, 1)
			}
			// A reply to a deleted message keeps its place and quotes "Deleted message", not the words.
			for (const m of data.messages) if (m.replyTo && m.reply && e.messageIds.includes(m.replyTo)) m.reply = { seq: m.reply.seq, from: m.reply.from, text: "", gone: true }
			return { deleted }
		}
		case "react": {
			const i = findMessage(data.messages, e.messageId)
			if (i === -1) return {}
			const m = data.messages[i]
			const reactions = (m.reactions ?? []).filter((r) => !sameActor(r.by, e.by))
			if (e.emoji !== null) reactions.push({ by: e.by, emoji: e.emoji })
			if (reactions.length) m.reactions = reactions
			else delete m.reactions
			return { put: raw(m) }
		}
		case "read":
			data.readSeq = Math.max(data.readSeq, e.upTo)
			return { meta: true }
		case "member":
			upsert(data.members, e.member, (x) => x.slug === e.member.slug)
			return { meta: true }
		case "member_removed":
			removeWhere(data.members, (x) => x.slug === e.slug)
			return { meta: true }
		case "task":
			upsert(data.tasks, e.task, (x) => x.id === e.task.id)
			return { meta: true }
		case "task_removed":
			removeWhere(data.tasks, (x) => x.id === e.id)
			return { meta: true }
		case "file":
			// New bytes at a path replace the old row on the server, so the path is the identity too. A move keeps the id.
			removeWhere(data.files, (x) => x.name === e.file.name && x.id !== e.file.id)
			upsert(data.files, e.file, (x) => x.id === e.file.id)
			return { meta: true }
		case "file_removed":
			removeWhere(data.files, (x) => e.ids.includes(x.id))
			return { meta: true }
		case "folders":
			data.folders = [...e.folders]
			return { meta: true }
		case "ask": {
			const { t: _, seq: __, at: ___, ...ask } = e
			upsert(data.asks, ask, (x) => x.id === ask.id)
			return { meta: true }
		}
		case "ask_resolved":
			removeWhere(data.asks, (x) => x.id === e.id)
			return { meta: true }
		default:
			// A tag this client does not know, such as a link preview an older room logged. It changes nothing.
			return {}
	}
}

export function applyStatus(data: RoomData, status: AgentStatus): void {
	if (status.state === "idle") removeWhere(data.agents, (x) => x.slug === status.slug)
	else upsert(data.agents, status, (x) => x.slug === status.slug)
}

/** Two oldest-first lists as one, oldest first, one message per seq; `b` wins a tie. */
export function mergeBySeq(a: readonly Message[], b: readonly Message[]): Message[] {
	const out: Message[] = []
	let i = 0
	let j = 0
	while (i < a.length || j < b.length) {
		const x = a[i]
		const y = b[j]
		if (y === undefined || (x !== undefined && x.seq < y.seq)) out.push(a[i++]!)
		else {
			if (x !== undefined && x.seq === y.seq) i++
			out.push(b[j++]!)
		}
	}
	return out
}

/**
 * Applies a live event to a jumped-to window: an edit, reaction, or delete of a message it
 * holds, and a newer version of one. A new message is not added: it belongs to the live end.
 */
export function applyToHistory(history: Message[], e: RoomEvent): void {
	if (e.t === "message") {
		const i = findMessage(history, e.id)
		if (i !== -1) history[i] = toMessage(e)
		return
	}
	if (e.t !== "edit" && e.t !== "react" && e.t !== "delete") return
	applyRoomEvent({ ...emptyRoom(), seq: e.seq - 1, messages: history }, e)
}

// The store.


export type RoomState = RoomData & {
	/** What each agent is doing now, from status frames. Not stored. */
	doing: Record<string, string | undefined>
	roomId: RoomId
	/** False until the warm tier has painted. */
	loaded: boolean
	/**
	 * False until the stored state, including the read marker, has been applied. A window seeded from
	 * an earlier visit paints with `loaded` true before this, so anything that reads the marker (the
	 * unread divider) waits for `booted`.
	 */
	booted: boolean
	connection: SocketStatus
	patches: RoomPatch[]
	/** Not stored. Cleared when the socket drops. */
	typing: AgentSlug[]
	status: Record<string, AgentState>
	/** Every run step this client has, by run id, in start order. Not stored. */
	/** Each agent's steps this client holds, by slug, in start order. */
	steps: Record<string, RunStep[]>
	/** The agents mid-run, by slug, from their steps. Cleared when the agent goes idle. */
	live: Record<string, boolean | undefined>
	/** The windows whose steps were asked for and have not come yet, by window key. */
	fetching: Record<string, boolean | undefined>
	/** Growing blocks, keyed by `runId:index`. A message from the same run and index replaces one. */
	/**
	 * A window of older messages the reader jumped to, oldest first, that does not reach the live
	 * window. While it is set the transcript shows it instead of `messages`, which keeps following the
	 * room. Paging newer joins it to the live window. Null at the live end. Memory only.
	 */
	history: Message[] | null
}

export type RoomStoreOptions = {
	roomId: RoomId
	warm: Warm
	/** The room socket's URL. */
	url: string
	connect?: Connect
	backoff?: Backoff
	/**
	 * A window this client already had in memory, from an earlier visit. It paints on the first
	 * frame, before IndexedDB answers, and the socket's replay covers everything after its `seq`.
	 */
	seed?: RoomSeed
	/** Something the human must know about, from the server. */
	onError?: (error: KikoError) => void
	/** The warm tier could not be read. The room still opens and the socket's replay fills it. */
	onBootFailed?: (error: unknown) => void
	/** Runs the next slice of work. Defaults to a macrotask. */
	schedule?: (run: () => void) => void
	/** Longest slice of event work. Defaults to 3 ms, which leaves room for the slice's warm writes in an 8 ms frame. */
	budgetMs?: number
	/** How many messages to paint from IndexedDB. Defaults to 50. */
	bootWindow?: number
	now?: () => number
	newId?: () => string
	ttlMs?: number
}

/** A whole room as this client last painted it, for an instant re-open. */
export type RoomSeed = Pick<RoomData, "messages" | "seq" | "readSeq" | "members" | "tasks" | "files" | "folders" | "asks">

export type SearchPage = { results: readonly SearchHit[]; next: number | null }

/** How long a question to the room (search, history) waits for its answer. */
const ASK_TIMEOUT_MS = 8000
/** Messages on each side of a jump target, and in each page past what the disk holds. */
export const HISTORY_PAGE = 30
/** The composer's `typing` frames are spaced at least this far apart. */
export const TYPING_EVERY_MS = 2000

export type SendOptions = {
	replyTo?: MessageId
	/** The words of `replyTo` this message answers. */
	quote?: string
	/** Uploads the room claims as it stores the message. Each was uploaded when it was picked. */
	attachments?: readonly PendingAttachment[]
	/** The same files from their blob URLs, so the message shows them until the room's copy arrives. */
	local?: readonly LocalAttachment[]
}

export type RoomStore = {
	readonly state: RoomState
	/** The window with every pending patch applied. */
	messages(): ViewMessage[]
	tasks(): Task[]
	asks(): HumanAsk[]
	answer(id: string, value: string | HumanAnswers): void
	skip(id: string): void
	/** The members with every pending add, rename, and remove applied. */
	members(): Member[]
	/** The room's files with pending `rm` and `mv` applied. */
	files(): FileRef[]
	/** The room's folders with pending `mkdir`, `rm`, and `mv` applied. */
	folders(): string[]
	readSeq(): number
	/** Resolves once the warm tier has painted and the socket has started. */
	readonly ready: Promise<void>
	/** Returns the send's `clientId`. */
	send(text: string, options?: SendOptions): string
	react(messageId: MessageId, emoji: string | null): void
	edit(messageId: MessageId, text: string): void
	remove(messageId: MessageId): void
	markRead(seq: number): void
	typing(): void
	/** Asks the room for one agent's steps in a window. The answer lands in `state.steps`. */
	requestSteps(slug: string, after: number): void
	/** Closes the socket and keeps the store. Pings are dropped, sends wait in the outbox. Section 19.6. */
	suspend(): void
	/** Reconnects with `hello {lastSeq}` and sends every pending frame again. */
	resume(): void
	/** The model this chat's agents use from their next run, as `provider/model`. Not stored here. */
	model(ref: string): void
	task(op: TaskOp): void
	/** Adds, renames, or removes an agent. A refusal drops the patch and calls every `onMemberRefused` listener. */
	member(op: MemberOp): void
	/** Calls `listener` for each refused member change. Returns the unsubscribe. */
	onMemberRefused(listener: (op: MemberOp, reason: MemberRefusal) => void): () => void
	/** `rm` or `mv` on the room's files, applied at once. A refusal drops the patch and calls every `onFilesRefused` listener. */
	fileOp(op: FileOp): void
	onTaskRefused(listener: (reason: string) => void): () => void
	onFilesRefused(listener: (op: FileOp, reason: string) => void): () => void
	/** Calls `listener` when the room refuses a send, such as one whose attachments expired. The message stays, marked failed. */
	onSendRefused(listener: (reason: string) => void): () => void
	/** Runs the input again that a failed run's error line (`messageId`) reports. Nothing is sent again. */
	retry(messageId: MessageId): void
	/** Searches the room's messages, newest first. `before` is the `next` of the previous page. Null when the room does not answer. */
	search(query: string, before?: number, limit?: number): Promise<SearchPage | null>
	/**
	 * Makes the message at `seq` part of what the transcript shows: at once when it is held, else from
	 * the room, as a `history` window around it. Resolves to false when the room has no such message.
	 */
	jumpTo(seq: number): Promise<boolean>
	/** Drops a jumped-to window and shows the live end again. */
	live(): void
	/**
	 * Prepends up to `limit` older messages, from IndexedDB and then from the room once the disk has
	 * none, and stops cutting the window. Resolves to how many.
	 */
	loadOlder(limit?: number): Promise<number>
	/**
	 * The reader is at the end of what is shown. At the live end: cut the window to
	 * `MAX_MESSAGES_IN_MEMORY` again, now and on every new message. In a jumped-to window: page newer
	 * messages in, and join the live window once they reach it.
	 */
	follow(): void
	/** Resolves when every queued event is applied. */
	settled(): Promise<void>
	close(): void
}

type RoomMeta = Omit<RoomData, "messages" | "seq" | "agents">
const metaKey = (roomId: RoomId) => `room:${roomId}`

/**
 * Frees the object URLs a send drew its attachments from. Called once the room confirmed the send
 * and the message shows the room's files, and for every unconfirmed send when the room closes (the
 * outbox brings it back without them).
 */
export function freeLocal(local: readonly LocalAttachment[] | undefined): void {
	for (const f of local ?? []) if (f.src.startsWith("blob:")) URL.revokeObjectURL(f.src)
}

export function defaultSchedule(run: () => void) {
	const MC = (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel
	if (!MC) return void setTimeout(run, 0)
	// A message port is a macrotask without the 4 ms clamp of a nested timeout.
	const channel = new MC()
	channel.port1.onmessage = () => {
		channel.port1.close()
		run()
	}
	channel.port2.postMessage(null)
}

/** Runs work when the browser is idle, or soon, so it never competes with a frame the human waits on. */
function idle(run: () => void) {
	const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number }).requestIdleCallback
	if (ric) ric(run, { timeout: 2000 })
	else setTimeout(run, 0)
}

export function createRoomStore(options: RoomStoreOptions): RoomStore {
	const taskRefusalListeners = new Set<(reason: string) => void>()
	const { roomId, warm } = options
	const now = options.now ?? Date.now
	const newId = options.newId ?? (() => crypto.randomUUID())
	const schedule = options.schedule ?? defaultSchedule
	const budget = options.budgetMs ?? 3
	const ttl = options.ttlMs ?? PATCH_TTL_MS

	const [state, setState] = createStore<RoomState>({
		...(options.seed ? { ...emptyRoom(), ...options.seed } : emptyRoom()),
		roomId,
		// A seeded window is a paint already: the first frame shows it, and boot only fills the rest.
		loaded: options.seed !== undefined,
		booted: false,
		connection: "closed",
		patches: [],
		typing: [],
		status: {},
		steps: {},
		live: {},
		fetching: {},
		doing: {},
		history: null,
	})

	let socket: SyncSocket | null = null
	/** The windows whose steps were asked for. */
	const fetchedWindows = new Set<string>()
	/** Questions waiting for their answer (search, history), by a key the answer repeats. */
	const asked = new Map<string, ((answer: unknown) => void)[]>()
	const searchKey = (query: string, before: number | undefined) => `search:${before ?? ""}:${query}`
	const historyKey = (seq: number, before: number, after: number) => `history:${seq}:${before}:${after}`
	/** Resolved when the socket opens, for a question asked while it connects. */
	let openWaiters: (() => void)[] = []
	let newerBusy = false
	let closed = false
	let lastTypingAt: number | undefined
	let suspended = false
	let queue: RoomEvent[] = []
	let draining = false
	let waiters: (() => void)[] = []
	let expiry: ReturnType<typeof setTimeout> | undefined
	/** True while the reader is at the end, so the window may drop its oldest messages. */
	let following = true
	const refusalListeners = new Set<(op: MemberOp, reason: MemberRefusal) => void>()
	const fileRefusalListeners = new Set<(op: FileOp, reason: string) => void>()
	const sendRefusalListeners = new Set<(reason: string) => void>()

	// Patches.

	const setPatches = (fn: (p: RoomPatch[]) => RoomPatch[]) => setState("patches", (p) => fn(p))

	function transmit(p: RoomPatch) {
		// A refused send stays on screen, marked failed. Sending it again would be refused again.
		if (p.failed) return
		if (!socket?.send(p.frame)) return
		const sentAt = now()
		setPatches((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, sentAt } : x)))
		armExpiry()
	}

	function armExpiry() {
		if (expiry !== undefined) return
		expiry = setTimeout(() => {
			expiry = undefined
			// A patch may only expire after it went out on a socket that was up: the clock measures the
			// server's silence, not how long this client was offline.
			if (state.connection !== "open") return armExpiry()
			setPatches((list) => expire(list, now(), ttl))
			if (state.patches.some((p) => p.sentAt !== undefined && p.frame.t !== "send" && p.frame.t !== "read")) armExpiry()
		}, ttl)
	}

	function act(frame: RoomPatchFrame): string {
		const p: RoomPatch = { clientId: newId(), frame, at: now() }
		setPatches((list) => [...list, p])
		transmit(p)
		return p.clientId
	}

	function dropPatches(next: RoomPatch[]) {
		const kept = new Set(next.map((p) => p.clientId))
		for (const p of raw(state.patches)) {
			if (kept.has(p.clientId) || p.frame.t !== "send") continue
			void removeFromOutbox(warm, p.clientId)
			freeLocal(p.local)
		}
		if (next.length !== state.patches.length) setState("patches", next)
	}

	// Warm writes.

	function writeMeta() {
		const s = raw(state)
		const meta: RoomMeta = {
			readSeq: s.readSeq,
			members: s.members,
			tasks: s.tasks,
			files: s.files,
			folders: s.folders,
			asks: s.asks,
		}
		warm.put("meta", metaKey(roomId), meta)
	}

	/** Drops the oldest messages beyond the window. They are already on disk, or queued for it. */
	function trimWindow(force = false) {
		const n = state.messages.length
		if (!following || n <= MAX_MESSAGES_IN_MEMORY || (!force && n <= MAX_MESSAGES_IN_MEMORY + WINDOW_SLACK)) return
		setState("messages", (m) => m.slice(m.length - MAX_MESSAGES_IN_MEMORY))
	}

	/**
	 * Applies an edit, reaction, or delete to messages that are on disk but outside the window, so
	 * scrolling back up never shows the old version. Rare, so it reads the room's rows.
	 */
	async function patchDisk(events: readonly RoomEvent[]) {
		const rows = await storedMessages(warm, roomId)
		for (const e of events) {
			const ids: readonly string[] = e.t === "delete" ? e.messageIds : e.t === "edit" || e.t === "react" ? [e.messageId] : []
			for (const m of rows) {
				if (!ids.includes(m.id)) continue
				const change = applyRoomEvent({ ...emptyRoom(), seq: e.seq - 1, messages: [m] }, e)
				if (change?.put) putMessages(warm, roomId, [change.put])
				if (change?.deleted?.length) deleteMessages(warm, roomId, change.deleted.map((x) => x.seq))
			}
		}
	}

	// Applying frames.

	function drain() {
		draining = false
		if (closed) return
		const start = performance.now()
		const applied: RoomEvent[] = []
		const puts = new Map<MessageId, Message>()
		const deleted: number[] = []
		let meta = false
		const offWindow: RoomEvent[] = []
		batch(() => {
			setState(
				produce((s) => {
					while (queue.length > 0) {
						const e = queue.shift() as RoomEvent
						const change = applyRoomEvent(s, e)
						if (!change) continue
						applied.push(e)
						if (change.put) puts.set(change.put.id, change.put)
						for (const m of change.deleted ?? []) {
							puts.delete(m.id)
							deleted.push(m.seq)
						}
						if (change.meta) meta = true
						const missed =
							((e.t === "edit" || e.t === "react") && !change.put) ||
							(e.t === "delete" && (change.deleted?.length ?? 0) < e.messageIds.length)
						if (missed) offWindow.push(e)
						if (s.history) applyToHistory(s.history, e)
						if (performance.now() - start >= budget) break
					}
				}),
			)
			dropPatches(settleRoom(state.patches, applied, state.seq))
			trimWindow()
		})
		if (offWindow.length) void patchDisk(offWindow)
		if (applied.length > 0) {
			putMessages(warm, roomId, [...puts.values()])
			deleteMessages(warm, roomId, deleted)
			if (meta) writeMeta()
			setLastSeq(warm, roomId, state.seq)
		}
		if (queue.length > 0) return kick()
		const done = waiters
		waiters = []
		for (const w of done) w()
	}

	function kick() {
		if (draining || closed) return
		draining = true
		schedule(drain)
	}

	function enqueue(events: readonly RoomEvent[]) {
		if (events.length === 0) return
		queue.push(...events)
		// Frames arrive in order, but a batch that is not sorted is not safe to append: `applyRoomEvent`
		// skips anything at or below `seq`, so one low event would be lost for good. Sorting is cheap
		// because the queue is short.
		for (let i = 1; i < queue.length; i++) {
			if (queue[i].seq < queue[i - 1].seq) {
				queue.sort((a, b) => a.seq - b.seq)
				break
			}
		}
		kick()
	}

	/** Ask the room a question and wait for the answer frame with the same key. Null when it does not come. */
	async function ask<T>(key: string, frame: ClientToRoom): Promise<T | null> {
		if (state.connection !== "open" && !closed && !suspended) {
			// A question asked while the socket connects (a jump right after opening the chat) waits for it.
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, ASK_TIMEOUT_MS)
				openWaiters.push(() => (clearTimeout(timer), resolve()))
			})
		}
		return new Promise<T | null>((resolve) => {
			const timer = setTimeout(() => finish(null), ASK_TIMEOUT_MS)
			const finish = (answer: unknown) => {
				clearTimeout(timer)
				const list = asked.get(key)
				if (list) asked.set(key, list.filter((x) => x !== finish))
				resolve(answer as T | null)
			}
			if (!socket?.send(frame)) return finish(null)
			asked.set(key, [...(asked.get(key) ?? []), finish])
		})
	}

	function answer(key: string, value: unknown) {
		const waiting = asked.get(key)
		asked.delete(key)
		for (const done of waiting ?? []) done(value)
	}

	const history = (seq: number, before: number, after: number) =>
		ask<readonly Message[]>(historyKey(seq, before, after), { t: "history", seq, before, after })

	/** Files steps under their agents. A running step marks its agent mid-run; a stale one never undoes a finished step. */
	function takeSteps(incoming: readonly RunStep[], live: boolean) {
		if (incoming.length === 0) return
		batch(() => {
			setState(
				produce((s) => {
					for (const step of incoming) {
						s.steps[step.slug] = upsertStep(s.steps[step.slug] ? raw(s.steps[step.slug]) : [], step)
						if (live || step.status === "running") s.live[step.slug] = true
					}
				}),
			)
		})
	}

	function reset(snapshot: RoomSnapshot) {
		queue = queue.filter((e) => e.seq > snapshot.seq)
		const data = fromSnapshot(snapshot)
		following = true
		batch(() => {
			setState({ ...data, history: null })
			dropPatches(settleRoom(state.patches, [], snapshot.seq))
			trimWindow(true)
		})
		// The snapshot's steps are those no message opens yet, so their agents are mid-run.
		takeSteps(snapshot.steps ?? [], true)
		clearRoom(warm, roomId)
		putMessages(warm, roomId, data.messages)
		writeMeta()
		setLastSeq(warm, roomId, snapshot.seq)
		kick()
	}

	const handlers: { [K in RoomToClient["t"]]: (f: Extract<RoomToClient, { t: K }>) => void } = {
		events: (f) => enqueue(f.events),
		ack: (f) => {
			void removeFromOutbox(warm, f.clientId)
			batch(() => {
				setPatches((list) => list.map((p) => (p.clientId === f.clientId ? { ...p, ack: { id: f.id, seq: f.seq } } : p)))
				dropPatches(settleRoom(state.patches, [], state.seq))
			})
		},
		reset: (f) => reset(f.snapshot),
		typing: (f) => setState("typing", [...f.who]),
		status: ({ t: _, ...f }) =>
			batch(() => {
				setState("status", f.slug, f.state)
				// What the agent is doing now: shown in place of "typing".
				setState("doing", f.slug, f.state === "idle" ? undefined : f.doing)
				if (f.state === "idle") setState("live", f.slug, undefined)
				setState(produce((s) => applyStatus(s, f)))
			}),
		step: (f) => takeSteps([f.step], false),
		steps: (f) => {
			setState("fetching", windowKey(f.slug, f.after), undefined)
			takeSteps(f.steps, false)
		},
		// Answers to one socket's questions. Nothing stores them.
		search: (f) => answer(searchKey(f.query, f.before), { results: f.results, next: f.next }),
		history: (f) => answer(historyKey(f.seq, f.before, f.after), f.messages),
		// A reply lands as whole bubbles. While a long one grows, its agent shows as typing.
		draft: () => {},
		// The room refused a member change: the patch goes at once, so the list rolls back, and the UI says why.
		member_refused: (f) => {
			const refused = (p: RoomPatch) => p.frame.t === "member" && p.frame.op.op === f.op.op && p.frame.op.slug === f.op.slug
			dropPatches(raw(state.patches).filter((p) => !refused(p)))
			for (const listener of refusalListeners) listener(f.op, f.reason)
		},
		send_refused: (f) => {
			void removeFromOutbox(warm, f.clientId)
			setPatches((list) => list.map((p) => (p.clientId === f.clientId ? { ...p, failed: true, reason: f.reason } : p)))
			for (const listener of sendRefusalListeners) listener(f.reason)
		},
		error: (f) => options.onError?.(f.error),
		task_refused: (f) => {
			dropPatches(raw(state.patches).filter((p) => !(p.frame.t === "task" && p.frame.op.id === f.op.id)))
			for (const listener of taskRefusalListeners) listener(f.reason)
		},
		files_refused: (f) => {
			const same = (p: RoomPatch) => p.frame.t === "files" && JSON.stringify(p.frame.op) === JSON.stringify(f.op)
			dropPatches(raw(state.patches).filter((p) => !same(p)))
			for (const listener of fileRefusalListeners) listener(f.op, f.reason)
		},
	}

	function onFrame(frame: RoomToClient) {
		const handle = handlers[frame.t] as ((f: RoomToClient) => void) | undefined
		handle?.(frame)
	}

	function onOpen() {
		const waiting = openWaiters
		openWaiters = []
		for (const w of waiting) w()
		// Pending frames go out after `hello`, oldest first. Acknowledged sends are already stored.
		for (const p of [...raw(state.patches)]) if (!p.ack) transmit(p)
		// An attachment upload that failed while the room was unreachable goes again, as in t3code.
		retryFailedUploads()
	}

	function onStatus(connection: SocketStatus) {
		setState("connection", connection)
		if (connection !== "open") {
			// Presence and step requests belong to the socket that carried them. The windows asked for
			// are forgotten too, so the reconnect asks again instead of waiting for an answer that died.
			setState({ typing: [], status: {}, agents: [], live: {}, fetching: {}, doing: {} })
			fetchedWindows.clear()
		}
	}

	// Boot.

	async function boot() {
		const [messages, lastSeq, meta, pending] = await Promise.all([
			newestMessages(warm, roomId, options.bootWindow),
			getLastSeq(warm, roomId),
			warm.get<RoomMeta>("meta", metaKey(roomId)),
			outbox(warm, roomId),
		])
		if (closed) return
		// Without the room's state the cursor is useless, so start from nothing and take a full replay.
		const seq = meta ? lastSeq : 0
		batch(() => {
			setState(
				produce((s) => {
					// A seeded window is newer than the disk's paint by construction, so it keeps the screen.
					// The disk only wins when it holds messages the seed does not (another tab wrote them).
					const disk = seq > 0 && (!s.loaded || seq > s.seq)
					if (disk) {
						// The socket opens after this, so nothing live has landed yet.
						s.messages = messages
						s.seq = seq
					}
					// The room's small state is never windowed, so the disk is authoritative for it even
					// when a seeded window keeps the messages. This is the marker the chat opened with.
					if (meta) {
						s.readSeq = Math.max(s.readSeq, meta.readSeq)
						s.members = [...meta.members]
						s.tasks = [...meta.tasks]
						s.asks = [...meta.asks]
						s.files = [...meta.files]
						s.folders = [...meta.folders]
					}
					s.loaded = true
					s.booted = true
					const have = new Set(s.patches.map((p) => p.clientId))
					const restored = pending
						.filter((i) => !have.has(i.frame.clientId))
						.map((i): RoomPatch => ({ clientId: i.frame.clientId, frame: i.frame, at: i.createdAt }))
					s.patches = [...restored, ...s.patches]
				}),
			)
		})
		if (!suspended) openSocket()
	}

	/**
	 * A failed read must not cost the room its socket: the chat still opens, empty, and the replay
	 * fills it. Without this a rejected `Promise.all` left `loaded` false and no socket at all, so
	 * the chat sat still until a page refresh.
	 */
	async function bootSafely(): Promise<void> {
		try {
			await boot()
		} catch (error) {
			if (closed) return
			options.onBootFailed?.(error)
			setState({ loaded: true, booted: true })
			if (!suspended) openSocket()
		}
	}

	function openSocket() {
		socket = createSyncSocket<RoomToClient>({
			url: options.url,
			connect: options.connect,
			backoff: options.backoff,
			hello: () => ({ t: "hello", lastSeq: state.seq }),
			onOpen,
			onFrame,
			onStatus,
		})
	}

	const ready = bootSafely()

	/** Pages newer messages into a jumped-to window, and joins the live window once they reach it. */
	async function loadNewer() {
		const shown = state.history
		if (!shown || newerBusy) return
		newerBusy = true
		try {
			const from = (shown.at(-1)?.seq ?? 0) + 1
			const page = await history(from, 0, HISTORY_PAGE * 2)
			if (!page || closed || state.history !== shown) return
			const live = raw(state.messages)
			const reaches = page.length < HISTORY_PAGE * 2 || live.length === 0 || page.some((m) => m.seq >= live[0]!.seq)
			if (reaches) setState({ messages: mergeBySeq(mergeBySeq(raw(shown), page), live), history: null })
			else setState("history", mergeBySeq(raw(shown), page))
		} finally {
			newerBusy = false
		}
	}

	return {
		state,
		messages: () => overlayMessages(state.history ?? state.messages, state.history ? [] : state.patches),
		tasks: () => overlayTasks(state.tasks, state.patches),
		asks: () => state.asks.filter((a) => !state.patches.some((p) => (p.frame.t === "answer" || p.frame.t === "skip") && p.frame.id === a.id)),
		answer(id, value) {
			const ask = state.asks.find((a) => a.id === id)
			if (!ask || !humanAnswerText(ask, value) || state.patches.some((p) => (p.frame.t === "answer" || p.frame.t === "skip") && p.frame.id === id)) return
			if (state.history) setState("history", null)
			const p: RoomPatch = { clientId: `answer:${id}`, frame: { t: "answer", id, value: typeof value === "string" ? value.trim() : value }, at: now(), ask: { ...ask } }
			setPatches((list) => [...list, p])
			transmit(p)
		},
		skip(id) {
			if (state.asks.some((a) => a.id === id)) act({ t: "skip", id })
		},
		members: () => overlayMembers(state.members, state.patches),
		files: () => overlayFiles(state.files, state.patches, state.folders),
		folders: () => overlayFolders(state.folders, state.patches),
		readSeq: () => overlayReadSeq(state.readSeq, state.patches),
		ready,
		send(text, opts = {}) {
			// The next keystroke after a send must reach the room at once: it is what holds a burst open.
			lastTypingAt = Number.NEGATIVE_INFINITY
			// A send is shown where it lands: at the live end.
			if (state.history) setState("history", null)
			const clientId = newId()
			const frame: RoomPatchFrame = { t: "send", clientId, text }
			if (opts.replyTo) frame.replyTo = opts.replyTo
			if (opts.replyTo && opts.quote) frame.quote = opts.quote
			if (opts.attachments?.length) frame.attachments = opts.attachments
			const p: RoomPatch = { clientId, frame, at: now(), ...(opts.local?.length ? { local: opts.local } : {}) }
			// The outbox write is queued before the socket sees the frame. Its flush is not awaited.
			void addToOutbox(warm, { roomId, frame, createdAt: p.at })
			setPatches((list) => [...list, p])
			transmit(p)
			return clientId
		},
		model(ref) {
			socket?.send({ t: "model", ref })
		},
		react: (messageId, emoji) => void act({ t: "react", messageId, emoji }),
		edit: (messageId, text) => void act({ t: "edit", messageId, text }),
		remove: (messageId) => void act({ t: "delete", messageId }),
		markRead(seq) {
			if (seq <= overlayReadSeq(state.readSeq, state.patches)) return
			// One read patch at a time: a newer mark supersedes the older one, which the room has no
			// event to confirm. Keeping them all would leave a pile of marks nothing ever settles.
			setPatches((list) => list.filter((p) => p.frame.t !== "read"))
			act({ t: "read", seq })
		},
		typing() {
			// At most one frame every TYPING_EVERY_MS. The room only needs to know the human is still typing.
			const t = now()
			if (lastTypingAt !== undefined && t - lastTypingAt < TYPING_EVERY_MS) return
			if (socket?.send({ t: "typing" })) lastTypingAt = t
		},
		requestSteps(slug, after) {
			// Once per window and session: a fetched window is cached, and live steps keep it current.
			const key = windowKey(slug, after)
			if (state.fetching[key] || fetchedWindows.has(key) || !socket?.send({ t: "steps", slug: slug as AgentSlug, after })) return
			fetchedWindows.add(key)
			setState("fetching", key, true)
			// An answer that never comes must not leave "Loading output" up for good.
			setTimeout(() => setState("fetching", key, undefined), ASK_TIMEOUT_MS)
		},
		suspend() {
			suspended = true
			socket?.close()
			socket = null
		},
		resume() {
			if (!suspended) return
			suspended = false
			if (!closed && state.loaded && !socket) openSocket()
		},
		task: (op) => void act({ t: "task", op }),
		member: (op) => void act({ t: "member", op }),
		onMemberRefused(listener) {
			refusalListeners.add(listener)
			return () => refusalListeners.delete(listener)
		},
		fileOp: (op) => void act({ t: "files", op }),
		onTaskRefused(listener) {
			taskRefusalListeners.add(listener)
			return () => taskRefusalListeners.delete(listener)
		},
		onFilesRefused(listener) {
			fileRefusalListeners.add(listener)
			return () => fileRefusalListeners.delete(listener)
		},
		retry(messageId) {
			socket?.send({ t: "retry", messageId })
		},
		onSendRefused(listener) {
			sendRefusalListeners.add(listener)
			return () => sendRefusalListeners.delete(listener)
		},
		search(query, before, limit) {
			return ask<SearchPage>(searchKey(query, before), {
				t: "search",
				query,
				...(before !== undefined ? { before } : {}),
				...(limit !== undefined ? { limit } : {}),
			})
		},
		async jumpTo(seq) {
			const held = (list: readonly Message[] | null) => !!list && raw(list).some((m) => m.seq === seq)
			if (held(state.history)) return true
			if (held(state.messages)) {
				// A message held in the live window: show that window, already in memory.
				if (state.history) setState("history", null)
				return true
			}
			const page = await history(seq, HISTORY_PAGE, HISTORY_PAGE)
			if (!page || closed || !page.some((m) => m.seq === seq)) return false
			const live = raw(state.messages)
			following = false
			if (live.length === 0 || page.at(-1)!.seq >= live[0]!.seq) setState({ messages: mergeBySeq(page, live), history: null })
			else setState("history", [...page])
			return true
		},
		live() {
			if (state.history) setState("history", null)
		},
		async loadOlder(limit = 50) {
			const shown = state.history ?? state.messages
			const oldest = shown[0]?.seq ?? state.seq + 1
			// The disk is one contiguous run that ends at the live end, so it only continues the live window.
			const older = state.history ? [] : await messagesBefore(warm, roomId, oldest, limit)
			if (closed) return 0
			if (older.length) {
				following = false
				setState("messages", (m) => [...older.filter((o) => o.seq < (m[0]?.seq ?? Infinity)), ...m])
				return older.length
			}
			if (oldest <= 1) return 0
			const page = (await history(oldest, Math.min(limit, HISTORY_PAGE * 2), 0)) ?? []
			if (closed || !page.length || (state.history ?? state.messages)[0]?.seq !== oldest) return 0
			following = false
			if (state.history) setState("history", (h) => mergeBySeq(page, h ?? []))
			else setState("messages", (m) => mergeBySeq(page, m))
			return page.length
		},
		follow() {
			if (state.history) {
				void loadNewer()
				return
			}
			following = true
			trimWindow(true)
		},
		settled() {
			if (queue.length === 0 && !draining) return Promise.resolve()
			return new Promise((resolve) => waiters.push(resolve))
		},
		close() {
			closed = true
			for (const p of raw(state.patches)) freeLocal(p.local)
			// The disk keeps a long history, not every message the room ever had. The trim is a write, and
			// a write lands in the same transaction as the next chat's first read, so it waits for idle.
			const trimTo = state.seq - KEEP_ON_DISK
			idle(() => dropBefore(warm, roomId, trimTo))
			for (const waiting of asked.values()) for (const done of waiting) done(null)
			asked.clear()
			for (const w of openWaiters) w()
			openWaiters = []
			if (expiry !== undefined) clearTimeout(expiry)
			socket?.close()
			for (const w of waiters) w()
			waiters = []
		},
	}
}
