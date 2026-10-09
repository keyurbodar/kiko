// An in-memory room and user server that speak the protocol, for tests and the
// dev harness. It starts from the shared fixtures in `@kiko/protocol/fixtures`.
// Its `connect` stands in for `WebSocket`. Frames cross it as JSON strings, one
// macrotask later, the way a network delivers them.
//
// It does what the real room promises: `hello` replays the events after
// `lastSeq` or sends `reset` when the gap is too large, a repeated `clientId`
// is acknowledged again and stored once, and every stored change gets the next
// `seq`. Production code must not import this file.

import type {
	Chat,
	ClientToRoom,
	ClientToUser,
	FileOp,
	FileRef,
	Message,
	MessageId,
	RoomEvent,
	RoomSnapshot,
	RoomToClient,
	UserEvent,
	UserToClient,
} from "@kiko/protocol"
import { duplicateDm, SNIPPET_CLOSE, SNIPPET_OPEN } from "@kiko/protocol"
import * as fixtures from "@kiko/protocol/fixtures"
import { applyRoomEvent, emptyRoom, type RoomData } from "./room-store"
import { overlayFiles, overlayFolders } from "./patches"
import { type Connect, PING, PONG, type SocketLike } from "./socket"
import { applyUserEvent, type UserData } from "./user-store"

/** Distributes `Omit` over a union, so each event keeps its own fields. */
type WithoutStored<E> = E extends unknown ? Omit<E, "seq" | "at"> : never

type Schedule = (run: () => void) => void

const later: Schedule = (run) => void setTimeout(run, 0)

/** The server side of a fake socket. */
type Peer<Out> = { push(frame: Out): void; close(): void }

type FakeServer<In, Out> = {
	online: boolean
	open(peer: Peer<Out>): void
	receive(peer: Peer<Out>, frame: In): void
	closed(peer: Peer<Out>): void
}

function fakeConnect<In, Out>(server: FakeServer<In, Out>, schedule: Schedule): Connect {
	return () => {
		let open = false
		let gone = false
		const socket: SocketLike = {
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
			send(data) {
				if (!open) throw new Error("socket is not open")
				// The runtime's auto-response, as the Durable Objects set it.
				if (data === PING) return schedule(() => open && socket.onmessage?.({ data: PONG }))
				const frame = JSON.parse(data) as In
				schedule(() => open && server.receive(peer, frame))
			},
			close() {
				shut()
			},
		}
		const shut = () => {
			if (gone) return
			gone = true
			const wasOpen = open
			open = false
			if (wasOpen) server.closed(peer)
			schedule(() => socket.onclose?.({ code: 1006 }))
		}
		const peer: Peer<Out> = {
			push(frame) {
				const data = JSON.stringify(frame)
				schedule(() => open && socket.onmessage?.({ data }))
			},
			close: shut,
		}
		schedule(() => {
			if (gone) return
			if (!server.online) {
				socket.onerror?.({})
				return shut()
			}
			open = true
			server.open(peer)
			socket.onopen?.({})
		})
		return socket
	}
}

export type MockRoomOptions = {
	/** The stored log to start from. Defaults to the fixture events. */
	events?: readonly RoomEvent[]
	/** A `hello` further behind than this gets `reset`. Defaults to 500, as in architecture section 9.2. */
	resetAfter?: number
	schedule?: Schedule
	now?: () => number
}

export type MockRoom = {
	connect: Connect
	/** While false, every connect fails. */
	online: boolean
	/** Closes every open socket, as a lost network does. */
	drop(): void
	/** Every frame received, in order. */
	readonly received: ClientToRoom[]
	/** The stored log. */
	readonly log: readonly RoomEvent[]
	/** How many sockets are open. */
	readonly peers: number
	snapshot(): RoomSnapshot
	/** Stores events, as an agent's work does, and sends them to every socket. */
	store(...events: WithoutStored<RoomEvent>[]): RoomEvent[]
	/** Sends a frame that is not stored, such as `typing` or `draft`. */
	broadcast(frame: RoomToClient): void
	/** When set, the next send is stored and then the socket drops before the `ack`. */
	loseNextAck: boolean
}

export function createMockRoom(options: MockRoomOptions = {}): MockRoom {
	const schedule = options.schedule ?? later
	const now = options.now ?? Date.now
	const resetAfter = options.resetAfter ?? 500
	const log: RoomEvent[] = []
	const data: RoomData = { ...emptyRoom(), members: [...fixtures.members] }
	const peers = new Set<Peer<RoomToClient>>()
	const received: ClientToRoom[] = []
	const byClientId = new Map<string, { id: MessageId; seq: number }>()

	const append = (e: RoomEvent) => {
		log.push(e)
		applyRoomEvent(data, structuredClone(e))
		if (e.t === "message" && e.clientId) byClientId.set(e.clientId, { id: e.id, seq: e.seq })
	}
	for (const e of options.events ?? fixtures.roomEvents) append(e)

	const nextSeq = () => (log[log.length - 1]?.seq ?? 0) + 1
	const stamp = (e: WithoutStored<RoomEvent>): RoomEvent => {
		const seq = nextSeq()
		return { ...e, seq, at: now() } as RoomEvent
	}

	function store(...events: WithoutStored<RoomEvent>[]): RoomEvent[] {
		const stored = events.map((e) => {
			const s = stamp(e)
			append(s)
			return s
		})
		for (const p of peers) p.push({ t: "events", events: stored })
		return stored
	}

	const message = (m: Omit<Message, "seq" | "at">, clientId?: string): WithoutStored<RoomEvent> =>
		({ t: "message", ...(clientId ? { clientId } : {}), ...m }) as WithoutStored<RoomEvent>

	function snapshot(): RoomSnapshot {
		return structuredClone({ ...data })
	}

	const has = (id: MessageId) => data.messages.some((m) => m.id === id)

	const handlers: { [K in ClientToRoom["t"]]: (peer: Peer<RoomToClient>, f: Extract<ClientToRoom, { t: K }>) => void } = {
		// The mock has no agents to run a model, so the choice is dropped.
		model() {},
		hello(peer, f) {
			const last = log[log.length - 1]?.seq ?? 0
			if (f.lastSeq > last || last - f.lastSeq > resetAfter) return peer.push({ t: "reset", snapshot: snapshot() })
			peer.push({ t: "events", events: log.filter((e) => e.seq > f.lastSeq) })
		},
		send(peer, f) {
			const seen = byClientId.get(f.clientId)
			if (seen) return peer.push({ t: "ack", clientId: f.clientId, ...seen })
			const seq = nextSeq()
			const m: Omit<Message, "seq" | "at"> = { id: `m${seq}` as MessageId, from: { kind: "human" }, text: f.text }
			if (f.replyTo) m.replyTo = f.replyTo
			if (f.files?.length) m.files = f.files
			if (mock.loseNextAck) {
				mock.loseNextAck = false
				append(stamp(message(m, f.clientId)))
				return peer.close()
			}
			const [stored] = store(message(m, f.clientId))
			peer.push({ t: "ack", clientId: f.clientId, id: m.id, seq: stored.seq })
		},
		react(_, f) {
			if (has(f.messageId)) store({ t: "react", messageId: f.messageId, by: { kind: "human" }, emoji: f.emoji })
		},
		edit(_, f) {
			if (has(f.messageId)) store({ t: "edit", messageId: f.messageId, text: f.text })
		},
		delete(_, f) {
			if (has(f.messageId)) store({ t: "delete", messageIds: [f.messageId] })
		},
		read(_, f) {
			if (f.seq > data.readSeq) store({ t: "read", upTo: f.seq })
		},
		typing() {},
		stop() {},
		approve(_, f) {
			const a = data.approvals.find((x) => x.id === f.approvalId)
			if (a?.state === "pending")
				store({ t: "approval", approval: { ...a, state: f.action === "accept" ? "accepted" : "declined" } })
		},
		// A plain substring match stands in for the room's index. Every word must appear.
		search(peer, f) {
			const words = f.query.toLowerCase().split(/\s+/).filter(Boolean)
			const size = Math.min(f.limit || 20, 50)
			const hits = data.messages
				.filter((m) => m.seq < (f.before ?? Infinity) && words.length > 0 && words.every((w) => m.text.toLowerCase().includes(w)))
				.sort((a, b) => b.seq - a.seq)
			const page = hits.slice(0, size)
			const mark = (text: string) => text.replace(new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi"), (x) => `${SNIPPET_OPEN}${x}${SNIPPET_CLOSE}`)
			peer.push({
				t: "search",
				query: f.query,
				...(f.before !== undefined ? { before: f.before } : {}),
				results: page.map((m) => ({ id: m.id, seq: m.seq, at: m.at, from: m.from, snippet: mark(m.text) })),
				next: hits.length > size ? page[page.length - 1]!.seq : null,
			})
		},
		history(peer, f) {
			const sorted = [...data.messages].sort((a, b) => a.seq - b.seq)
			const older = f.before ? sorted.filter((m) => m.seq < f.seq).slice(-f.before) : []
			const newer = sorted.filter((m) => m.seq >= f.seq).slice(0, f.after)
			peer.push({ t: "history", seq: f.seq, before: f.before, after: f.after, messages: structuredClone([...older, ...newer]) })
		},
		// The server's rules in files/file-index.ts, through the same overlay the client draws with.
		files(peer, f) {
			const out = fileOpEvents(data.files, data.folders, f.op)
			if ("refused" in out) return peer.push({ t: "files_refused", op: f.op, reason: out.refused })
			if (out.events.length) store(...(out.events as WithoutStored<RoomEvent>[]))
		},
		member(peer, f) {
			const op = f.op
			const current = data.members.find((m) => m.slug === op.slug)
			if (op.op === "add") {
				if (current || data.members.length >= 8) return peer.push({ t: "member_refused", op, reason: current ? "exists" : "limit" })
				const { op: _, ...member } = op
				return void store({ t: "member", member: { ...member, lead: data.members.length === 0 } })
			}
			if (!current) return peer.push({ t: "member_refused", op, reason: "unknown" })
			if (op.op === "rename") return void store({ t: "member", member: { ...current, name: op.name } })
			if (op.slug === "kiko") return peer.push({ t: "member_refused", op, reason: "chief" })
			if (data.members.length === 1) return peer.push({ t: "member_refused", op, reason: "last" })
			store({ t: "member_removed", slug: op.slug })
		},
		task(_, f) {
			const op = f.op
			if (op.op === "delete") return void store({ t: "task_removed", id: op.id })
			const old = data.tasks.find((x) => x.id === op.id)
			if (op.op === "create") {
				if (old) return
				store({
					t: "task",
					task: { id: op.id, title: op.title, status: "todo", dependsOn: op.dependsOn ?? [], ...(op.owner ? { owner: op.owner } : {}) },
				})
				return
			}
			if (!old) return
			const { owner, ...rest } = old
			const newOwner = op.owner === undefined ? owner : (op.owner ?? undefined)
			store({
				t: "task",
				task: {
					...rest,
					...(op.title !== undefined ? { title: op.title } : {}),
					...(op.status !== undefined ? { status: op.status } : {}),
					...(op.note !== undefined ? { note: op.note } : {}),
					...(newOwner ? { owner: newOwner } : {}),
				},
			})
		},
	}

	const server: FakeServer<ClientToRoom, RoomToClient> = {
		online: true,
		open: (peer) => void peers.add(peer),
		closed: (peer) => void peers.delete(peer),
		receive(peer, frame) {
			received.push(frame)
			const handle = handlers[frame.t] as (p: Peer<RoomToClient>, f: ClientToRoom) => void
			handle(peer, frame)
		},
	}

	const mock: MockRoom = {
		connect: fakeConnect(server, schedule),
		get online() {
			return server.online
		},
		set online(value) {
			server.online = value
		},
		drop() {
			for (const p of [...peers]) p.close()
		},
		received,
		log,
		get peers() {
			return peers.size
		},
		snapshot,
		store,
		broadcast(frame) {
			for (const p of peers) p.push(frame)
		},
		loseNextAck: false,
	}
	return mock
}

export type MockUserOptions = {
	chats?: readonly Chat[]
	resetAfter?: number
	schedule?: Schedule
	now?: () => number
}

export type MockUser = {
	connect: Connect
	online: boolean
	drop(): void
	readonly received: ClientToUser[]
	readonly log: readonly UserEvent[]
	store(...events: WithoutStored<UserEvent>[]): UserEvent[]
}

type FileEventBody = { t: "file"; file: FileRef } | { t: "file_removed"; ids: string[] } | { t: "folders"; folders: string[] }

/** The events one `rm`, `mv`, or `mkdir` makes in a file space, or why it changes nothing. Room and drive share it. */
function fileOpEvents(files: readonly FileRef[], folders: readonly string[], op: FileOp): { events: FileEventBody[] } | { refused: string } {
	const under = (name: string, path: string) => name === path || name.startsWith(`${path}/`)
	const frame = { clientId: "", at: 0, frame: { t: "files" as const, op } }
	const nextFolders = overlayFolders(folders, [frame])
	const folderEvent: FileEventBody[] = nextFolders.join() !== folders.join() ? [{ t: "folders", folders: nextFolders }] : []
	if (op.op === "mkdir") return files.some((x) => x.name === op.path) ? { refused: "that is a file" } : { events: folderEvent }
	if (op.op === "rm") {
		const exists = (p: string) => files.some((x) => under(x.name, p)) || folders.some((x) => under(x, p))
		if (!op.paths.every(exists)) return { refused: "no such file or folder" }
		const full = (p: string) => files.some((x) => x.name.startsWith(`${p}/`)) || folders.some((x) => x.startsWith(`${p}/`))
		if (!op.recursive && op.paths.some(full)) return { refused: "that folder has things in it" }
		const gone = files.filter((x) => op.paths.some((p) => under(x.name, p))).map((x) => x.id)
		return { events: [...(gone.length ? [{ t: "file_removed" as const, ids: gone }] : []), ...folderEvent] }
	}
	const before = new Map(files.map((x) => [x.id, x.name]))
	const after = overlayFiles(files, [frame], folders)
	const kept = new Set(after.map((x) => x.id))
	const replaced = files.filter((x) => !kept.has(x.id)).map((x) => x.id)
	const moved = after.filter((x) => before.get(x.id) !== x.name).map((file): FileEventBody => ({ t: "file", file }))
	if (!moved.length && !folderEvent.length) return { refused: "nothing moved" }
	return { events: [...(replaced.length ? [{ t: "file_removed" as const, ids: replaced }] : []), ...moved, ...folderEvent] }
}

export function createMockUser(options: MockUserOptions = {}): MockUser {
	const schedule = options.schedule ?? later
	const now = options.now ?? Date.now
	const resetAfter = options.resetAfter ?? 500
	const log: UserEvent[] = []
	const data: UserData = { seq: 0, chats: [], agents: [], home: { files: [], folders: [] }, extensions: [], proposals: [] }
	const peers = new Set<Peer<UserToClient>>()
	const received: ClientToUser[] = []

	function store(...events: WithoutStored<UserEvent>[]): UserEvent[] {
		const stored = events.map((e) => {
			const s = { ...e, seq: (log[log.length - 1]?.seq ?? 0) + 1, at: now() } as UserEvent
			log.push(s)
			applyUserEvent(data, structuredClone(s))
			return s
		})
		for (const p of peers) p.push({ t: "events", events: stored })
		return stored
	}
	for (const chat of options.chats ?? [fixtures.chat]) store({ t: "chat", chat })

	const find = (roomId: string) => data.chats.find((c) => c.roomId === roomId)

	const server: FakeServer<ClientToUser, UserToClient> = {
		online: true,
		open: (peer) => void peers.add(peer),
		closed: (peer) => void peers.delete(peer),
		receive(peer, frame) {
			received.push(frame)
			if (frame.t === "hello") {
				const last = log[log.length - 1]?.seq ?? 0
				if (frame.lastSeq > last || last - frame.lastSeq > resetAfter)
					return peer.push({ t: "reset", snapshot: structuredClone({ seq: data.seq, chats: data.chats, agents: data.agents, home: data.home }) })
				return peer.push({ t: "events", events: log.filter((e) => e.seq > frame.lastSeq) })
			}
			if (frame.t === "agent") {
				if (!data.agents.some((a) => a.id === frame.op.agent.id || a.slug === frame.op.agent.slug)) store({ t: "agent", agent: frame.op.agent })
				return
			}
			if (frame.t === "home") {
				const out = fileOpEvents(data.home.files, data.home.folders, frame.op)
				if ("refused" in out) return peer.push({ t: "home_refused", op: frame.op, reason: out.refused })
				if (out.events.length) store(...(out.events as WithoutStored<UserEvent>[]))
				return
			}
			if (frame.t === "extension") return peer.push({ t: "extension_result", reqId: frame.reqId, result: { ok: false, error: "the mock server runs no extensions" } })
			if (frame.t !== "chat") return // the mock has no memory, search, executor, sign-in, or theme store
			const op = frame.op
			const chat = find(op.roomId)
			if (op.op === "create") {
				if (chat) return
				// One direct chat per agent, as the server keeps it.
				const existing = duplicateDm(data.chats, op)
				if (existing) return peer.push({ t: "chat_refused", roomId: op.roomId, existing })
				store({
					t: "chat",
					chat: { roomId: op.roomId, title: op.title, pinned: false, muted: false, lastSeq: 0, lastPreview: "", unread: 0, updatedAt: now(), ...(op.agents?.length ? { agents: op.agents } : {}), ...(op.temp ? { temp: true as const } : {}) },
				})
			} else if (!chat) return
			else if (op.op === "keep") {
				if (!chat.temp) return
				const { temp: _, ...kept } = chat
				store({ t: "chat", chat: { ...kept, title: op.title, agents: op.agents } })
			}
			else if (op.op === "delete") store({ t: "chat_removed", roomId: op.roomId })
			else if (op.op === "rename") store({ t: "chat", chat: { ...chat, title: op.title } })
			else if (op.op === "pin") store({ t: "chat", chat: { ...chat, pinned: op.pinned } })
			else if (op.op === "private") store({ t: "chat", chat: { ...chat, private: op.private } })
			else store({ t: "chat", chat: { ...chat, muted: op.muted } })
		},
	}

	return {
		connect: fakeConnect(server, schedule),
		get online() {
			return server.online
		},
		set online(value) {
			server.online = value
		},
		drop() {
			for (const p of [...peers]) p.close()
		},
		received,
		log,
		store,
	}
}
