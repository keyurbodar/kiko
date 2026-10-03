// The open room. Architecture sections 9.2, 9.3, and 19.2.
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
	Approval,
	CatalogItem,
	FileRef,
	Member,
	MemberOp,
	MemberRefusal,
	Message,
	MessageId,
	RoomEvent,
	RoomId,
	RoomSnapshot,
	RoomToClient,
	Task,
	TaskOp,
} from "@kiko/protocol"
import { batch } from "solid-js"
import { $RAW, createStore, produce } from "solid-js/store"
import type { Warm } from "../warm/db"
import { clearRoom, deleteMessages, getLastSeq, messagesBefore, newestMessages, putMessages, setLastSeq } from "../warm/messages"
import { addToOutbox, outbox, removeFromOutbox } from "../warm/outbox"
import {
	expire,
	overlayApprovals,
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
import { type Backoff, type Connect, createSyncSocket, type SocketStatus, type SyncSocket } from "./socket"

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
	approvals: Approval[]
	files: FileRef[]
	/** Every folder, empty ones included. */
	folders: string[]
	/** The newest "no provider" refusal (P4-02), until an agent next speaks. The chat shows a connect notice. */
	noProvider?: { slug: AgentSlug; provider: string } | null
	/** Who joined and left, oldest first, for the transcript's system lines. The newest `ROSTER_LIMIT`. */
	roster: MemberNotice[]
}

/** One member joining or leaving, as the transcript shows it: "kiko joined". */
export type MemberNotice = { seq: number; at: number; slug: AgentSlug; name: string; kind: "joined" | "left" }

export const ROSTER_LIMIT = 100

export const emptyRoom = (): RoomData => ({
	seq: 0,
	readSeq: 0,
	members: [],
	messages: [],
	tasks: [],
	approvals: [],
	files: [],
	folders: [],
	roster: [],
})

export function fromSnapshot(s: RoomSnapshot): RoomData {
	return {
		seq: s.seq,
		readSeq: s.readSeq,
		members: [...s.members],
		messages: [...s.messages],
		tasks: [...s.tasks],
		approvals: [...s.approvals],
		files: [...s.files],
		folders: [...s.folders],
		// A snapshot carries members, not their history. `reset` keeps the lines it already had.
		roster: [],
	}
}

function notice(data: RoomData, n: MemberNotice) {
	data.roster.push(n)
	if (data.roster.length > ROSTER_LIMIT) data.roster.splice(0, data.roster.length - ROSTER_LIMIT)
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
			if (e.from.kind === "agent" && data.noProvider) data.noProvider = null
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
			// A change to a current member (a rename, a new lead) is not news. An arrival is.
			if (!data.members.some((x) => x.slug === e.member.slug))
				notice(data, { seq: e.seq, at: e.at, slug: e.member.slug, name: e.member.name, kind: "joined" })
			upsert(data.members, e.member, (x) => x.slug === e.member.slug)
			return { meta: true }
		case "member_removed": {
			const gone = data.members.find((x) => x.slug === e.slug)
			if (gone) notice(data, { seq: e.seq, at: e.at, slug: e.slug, name: gone.name, kind: "left" })
			removeWhere(data.members, (x) => x.slug === e.slug)
			return { meta: true }
		}
		case "task":
			upsert(data.tasks, e.task, (x) => x.id === e.task.id)
			return { meta: true }
		case "task_removed":
			removeWhere(data.tasks, (x) => x.id === e.id)
			return { meta: true }
		case "approval":
			upsert(data.approvals, e.approval, (x) => x.id === e.approval.id)
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
		case "no_provider":
			// The full connect card is P4-06. Until then the chat shows a one-line notice from this.
			data.noProvider = { slug: e.slug, provider: e.provider }
			return { meta: true }
	}
}

// The store.

export type Draft = { slug: AgentSlug; runId: string; index: number; text: string }

export type RoomState = RoomData & {
	/** What each agent is doing now, from status frames. Not stored. */
	doing: Record<string, string | undefined>
	roomId: RoomId
	/** False until the warm tier has painted. */
	loaded: boolean
	connection: SocketStatus
	patches: RoomPatch[]
	/** Not stored. Cleared when the socket drops. */
	typing: AgentSlug[]
	status: Record<string, AgentState>
	/** Growing blocks, keyed by `runId:index`. A message from the same run and index replaces one. */
	drafts: Record<string, Draft>
}

export type RoomStoreOptions = {
	roomId: RoomId
	warm: Warm
	/** The room socket's URL. */
	url: string
	connect?: Connect
	backoff?: Backoff
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

export type CatalogPage = { items: readonly CatalogItem[]; next: number | null }

const CATALOG_TIMEOUT_MS = 8000
/** The composer's `typing` frames are spaced at least this far apart. */
export const TYPING_EVERY_MS = 2000

export type SendOptions = {
	replyTo?: MessageId
	files?: readonly FileRef[]
	/** Attachments still uploading: the message shows them now and leaves when `uploads` resolves (P8-06). */
	local?: readonly LocalAttachment[]
	uploads?: Promise<readonly FileRef[]>
}

export type RoomStore = {
	readonly state: RoomState
	/** The window with every pending patch applied. */
	messages(): ViewMessage[]
	tasks(): Task[]
	approvals(): Approval[]
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
	stop(): void
	/** Closes the socket and keeps the store. Pings are dropped, sends wait in the outbox. Section 19.6. */
	suspend(): void
	/** Reconnects with `hello {lastSeq}` and sends every pending frame again. */
	resume(): void
	approve(approvalId: string, action: "accept" | "decline"): void
	/** The model this chat's agents use from their next run, as `provider/model`. Not stored here. */
	model(ref: string): void
	task(op: TaskOp): void
	/** Adds, renames, or removes an agent. A refusal drops the patch and calls every `onMemberRefused` listener. */
	member(op: MemberOp): void
	/** Calls `listener` for each refused member change. Returns the unsubscribe. */
	onMemberRefused(listener: (op: MemberOp, reason: MemberRefusal) => void): () => void
	/** `rm` or `mv` on the room's files, applied at once. A refusal drops the patch and calls every `onFilesRefused` listener. */
	fileOp(op: FileOp): void
	onFilesRefused(listener: (op: FileOp, reason: string) => void): () => void
	/**
	 * Asks the room for the links or the media sent in it, newest first. `before` is the `next` of the
	 * previous page. Resolves to null when the socket is down or the room does not answer.
	 */
	catalog(kind: "links" | "media", before?: number, limit?: number): Promise<CatalogPage | null>
	/** Prepends up to `limit` older messages from IndexedDB. Resolves to how many. */
	loadOlder(limit?: number): Promise<number>
	/** Resolves when every queued event is applied. */
	settled(): Promise<void>
	close(): void
}

type RoomMeta = Omit<RoomData, "messages" | "seq">
const metaKey = (roomId: RoomId) => `room:${roomId}`

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

export function createRoomStore(options: RoomStoreOptions): RoomStore {
	const { roomId, warm } = options
	const now = options.now ?? Date.now
	const newId = options.newId ?? (() => crypto.randomUUID())
	const schedule = options.schedule ?? defaultSchedule
	const budget = options.budgetMs ?? 3
	const ttl = options.ttlMs ?? PATCH_TTL_MS

	const [state, setState] = createStore<RoomState>({
		...emptyRoom(),
		roomId,
		loaded: false,
		connection: "closed",
		patches: [],
		typing: [],
		status: {},
		doing: {},
		drafts: {},
	})

	let socket: SyncSocket | null = null
	/** Catalog questions waiting for their answer, by kind and cursor. */
	const asked = new Map<string, ((page: CatalogPage | null) => void)[]>()
	const askKey = (kind: string, before: number | undefined) => `${kind}:${before ?? ""}`
	let closed = false
	let lastTypingAt: number | undefined
	let suspended = false
	let queue: RoomEvent[] = []
	let draining = false
	let waiters: (() => void)[] = []
	let expiry: ReturnType<typeof setTimeout> | undefined
	const refusalListeners = new Set<(op: MemberOp, reason: MemberRefusal) => void>()
	const fileRefusalListeners = new Set<(op: FileOp, reason: string) => void>()

	// Patches.

	const setPatches = (fn: (p: RoomPatch[]) => RoomPatch[]) => setState("patches", (p) => fn(p))

	function transmit(p: RoomPatch) {
		if (p.held) return
		if (!socket?.send(p.frame)) return
		const sentAt = now()
		setPatches((list) => list.map((x) => (x.clientId === p.clientId ? { ...x, sentAt } : x)))
		armExpiry()
	}

	function armExpiry() {
		if (expiry !== undefined) return
		expiry = setTimeout(() => {
			expiry = undefined
			setPatches((list) => expire(list, now(), ttl))
			if (state.patches.some((p) => p.sentAt !== undefined && p.frame.t !== "send")) armExpiry()
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
			if (!kept.has(p.clientId) && p.frame.t === "send") void removeFromOutbox(warm, p.clientId)
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
			approvals: s.approvals,
			files: s.files,
			folders: s.folders,
			roster: s.roster,
		}
		warm.put("meta", metaKey(roomId), meta)
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
						if (e.t === "message" && e.run) delete s.drafts[`${e.run.runId}:${e.run.index}`]
						if (performance.now() - start >= budget) break
					}
				}),
			)
			dropPatches(settleRoom(state.patches, applied, state.seq))
		})
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
		const tail = queue[queue.length - 1]
		queue.push(...events)
		if (tail && events[0].seq < tail.seq) queue.sort((a, b) => a.seq - b.seq)
		else if (!tail && events.some((e, i) => i > 0 && e.seq < events[i - 1].seq)) queue.sort((a, b) => a.seq - b.seq)
		kick()
	}

	function reset(snapshot: RoomSnapshot) {
		queue = queue.filter((e) => e.seq > snapshot.seq)
		const data = fromSnapshot(snapshot)
		data.roster = raw(state.roster).filter((n) => n.seq <= snapshot.seq)
		batch(() => {
			setState({ ...data, drafts: {} })
			dropPatches(settleRoom(state.patches, [], snapshot.seq))
		})
		clearRoom(warm, roomId)
		putMessages(warm, roomId, snapshot.messages)
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
		status: (f) =>
			batch(() => {
				setState("status", f.slug, f.state)
				// What the agent is doing now (section 7.12): shown in place of "typing".
				setState("doing", f.slug, f.state === "idle" ? undefined : f.doing)
				// A run that ended, or was restarted, leaves no draft behind.
				if (f.state === "idle")
					setState(
						"drafts",
						produce((d) => {
							for (const [key, x] of Object.entries(d)) if (x.slug === f.slug) delete d[key]
						}),
					)
			}),
		// The search UI (P3-13) reads these answers. Nothing stores them.
		search: () => {},
		catalog: (f) => {
			const key = askKey(f.kind, f.before)
			const waiting = asked.get(key)
			asked.delete(key)
			for (const done of waiting ?? []) done({ items: f.items, next: f.next })
		},
		draft: (f) => setState("drafts", `${f.runId}:${f.index}`, { slug: f.slug, runId: f.runId, index: f.index, text: f.text }),
		// The room refused a member change: the patch goes at once, so the list rolls back, and the UI says why.
		member_refused: (f) => {
			const refused = (p: RoomPatch) => p.frame.t === "member" && p.frame.op.op === f.op.op && p.frame.op.slug === f.op.slug
			dropPatches(raw(state.patches).filter((p) => !refused(p)))
			for (const listener of refusalListeners) listener(f.op, f.reason)
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
		// Pending frames go out after `hello`, oldest first. Acknowledged sends are already stored.
		for (const p of [...raw(state.patches)]) if (!p.ack) transmit(p)
	}

	function onStatus(connection: SocketStatus) {
		setState("connection", connection)
		if (connection !== "open") setState({ typing: [], status: {}, drafts: {} })
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
					if (seq > 0) {
						// The socket opens after this, so nothing live has landed yet.
						s.messages = messages
						s.readSeq = meta?.readSeq ?? 0
						s.members = [...(meta?.members ?? [])]
						s.tasks = [...(meta?.tasks ?? [])]
						s.approvals = [...(meta?.approvals ?? [])]
						s.files = [...(meta?.files ?? [])]
						s.folders = [...(meta?.folders ?? [])]
						s.roster = [...(meta?.roster ?? [])]
						s.seq = seq
					}
					s.loaded = true
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

	const ready = boot()

	return {
		state,
		messages: () => overlayMessages(state.messages, state.patches),
		tasks: () => overlayTasks(state.tasks, state.patches),
		approvals: () => overlayApprovals(state.approvals, state.patches),
		members: () => overlayMembers(state.members, state.patches),
		files: () => overlayFiles(state.files, state.patches, state.folders),
		folders: () => overlayFolders(state.folders, state.patches),
		readSeq: () => overlayReadSeq(state.readSeq, state.patches),
		ready,
		send(text, opts = {}) {
			// The next keystroke after a send must reach the room at once: it is what holds a burst open.
			lastTypingAt = Number.NEGATIVE_INFINITY
			const clientId = newId()
			const frame: RoomPatchFrame = { t: "send", clientId, text }
			if (opts.replyTo) frame.replyTo = opts.replyTo
			if (opts.files?.length) frame.files = opts.files
			const p: RoomPatch = { clientId, frame, at: now() }
			if (opts.uploads) {
				// Shown now from the local files. The frame leaves, and reaches the outbox, once every upload landed.
				p.local = opts.local
				p.held = true
				setPatches((list) => [...list, p])
				opts.uploads.then(
					(files) => {
						const sent = { ...frame, files } as Extract<RoomPatchFrame, { t: "send" }>
						const ready: RoomPatch = { ...p, held: false, frame: sent, local: undefined }
						void addToOutbox(warm, { roomId, frame: sent, createdAt: p.at })
						setPatches((list) => list.map((x) => (x.clientId === clientId ? ready : x)))
						transmit(ready)
					},
					() => setPatches((list) => list.map((x) => (x.clientId === clientId ? { ...x, failed: true } : x))),
				)
				return clientId
			}
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
			act({ t: "read", seq })
		},
		typing() {
			// At most one frame every TYPING_EVERY_MS. The room only needs to know the human is still typing.
			const t = now()
			if (lastTypingAt !== undefined && t - lastTypingAt < TYPING_EVERY_MS) return
			if (socket?.send({ t: "typing" })) lastTypingAt = t
		},
		stop: () => void socket?.send({ t: "stop" }),
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
		approve: (approvalId, action) => void act({ t: "approve", approvalId, action }),
		task: (op) => void act({ t: "task", op }),
		member: (op) => void act({ t: "member", op }),
		onMemberRefused(listener) {
			refusalListeners.add(listener)
			return () => refusalListeners.delete(listener)
		},
		fileOp: (op) => void act({ t: "files", op }),
		onFilesRefused(listener) {
			fileRefusalListeners.add(listener)
			return () => fileRefusalListeners.delete(listener)
		},
		catalog(kind, before, limit) {
			return new Promise<CatalogPage | null>((resolve) => {
				const key = askKey(kind, before)
				const timer = setTimeout(() => finish(null), CATALOG_TIMEOUT_MS)
				const finish = (page: CatalogPage | null) => {
					clearTimeout(timer)
					const list = asked.get(key)
					if (list) asked.set(key, list.filter((x) => x !== finish))
					resolve(page)
				}
				const sent = socket?.send({ t: "catalog", kind, ...(before !== undefined ? { before } : {}), ...(limit !== undefined ? { limit } : {}) })
				if (!sent) return finish(null)
				asked.set(key, [...(asked.get(key) ?? []), finish])
			})
		},
		async loadOlder(limit = 50) {
			const oldest = state.messages[0]?.seq ?? state.seq + 1
			const older = await messagesBefore(warm, roomId, oldest, limit)
			if (older.length === 0 || closed) return 0
			setState("messages", (m) => [...older.filter((o) => o.seq < (m[0]?.seq ?? Infinity)), ...m])
			return older.length
		},
		settled() {
			if (queue.length === 0 && !draining) return Promise.resolve()
			return new Promise((resolve) => waiters.push(resolve))
		},
		close() {
			closed = true
			for (const waiting of asked.values()) for (const done of waiting) done(null)
			asked.clear()
			if (expiry !== undefined) clearTimeout(expiry)
			socket?.close()
			for (const w of waiters) w()
			waiters = []
		},
	}
}
