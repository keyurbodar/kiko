// The user's own data: for now, the chat list. Architecture section 9.1.
//
// Same shape as the room store, smaller. It paints the chat list from
// IndexedDB, connects with `hello {lastSeq}`, applies events in `seq` order,
// and lays pending chat edits over the server's list. Pending edits go out
// again after a reconnect.
//
// ASSUMPTION: chat edits are not written to the outbox, which holds sends
// only. A chat edit made offline is lost on reload.

import type { Agent, Chat, ChatOp, FileOp, FileRef, RoomId, UserEvent, UserSnapshot, UserToClient } from "@kiko/protocol"
import { batch } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { allAgents, allChats, getUserSeq, putAgents, putChats, removeChat, replaceChats, setUserSeq } from "../warm/chats"
import type { Warm } from "../warm/db"
import { expire, overlayChats, overlayFiles, overlayFolders, PATCH_TTL_MS, type RoomPatch, roomConfirmedBy, settleUser, type UserPatch } from "./patches"
import { type Backoff, type Connect, createSyncSocket, type SocketStatus, type SyncSocket } from "./socket"

/** The user's drive, /home (architecture section 18.4). */
export type Home = { files: FileRef[]; folders: string[] }
export type UserData = { seq: number; chats: Chat[]; agents: Agent[]; home: Home }

/** Applies one event in place. An event at or below `data.seq` is skipped. Returns false then. */
export function applyUserEvent(data: UserData, e: UserEvent): boolean {
	if (e.seq <= data.seq) return false
	data.seq = e.seq
	if (e.t === "theme") return true // the theme client reads these. The chat list has nothing to change.
	// The drive's events, by the same rules as a room's files: a path holds one file, a move keeps the id.
	if (e.t === "file" || e.t === "file_removed" || e.t === "folders") {
		if (e.t === "file") {
			data.home.files = data.home.files.filter((x) => x.name !== e.file.name || x.id === e.file.id)
			const i = data.home.files.findIndex((x) => x.id === e.file.id)
			if (i === -1) data.home.files.push(e.file)
			else data.home.files[i] = e.file
		} else if (e.t === "file_removed") data.home.files = data.home.files.filter((x) => !e.ids.includes(x.id))
		else data.home.folders = [...e.folders]
		return true
	}
	if (e.t === "agent") {
		if (!data.agents.some((a) => a.id === e.agent.id)) data.agents.push(e.agent)
		return true
	}
	const i = data.chats.findIndex((c) => c.roomId === (e.t === "chat" ? e.chat.roomId : e.roomId))
	if (e.t === "chat") {
		if (i === -1) data.chats.push(e.chat)
		else data.chats[i] = e.chat
	} else if (i !== -1) data.chats.splice(i, 1)
	return true
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** A ULID, so a new chat has its room id before the server hears of it. */
export function newRoomId(now = Date.now(), random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): RoomId {
	let time = ""
	for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time
	const bytes = random(16)
	let rest = ""
	for (let i = 0; i < 16; i++) rest += CROCKFORD[bytes[i] % 32]
	return (time + rest) as RoomId
}

export type UserState = UserData & {
	loaded: boolean
	connection: SocketStatus
	patches: UserPatch[]
	/** Agents made here that the server has not confirmed yet. Sent again after a reconnect. */
	pendingAgents: Agent[]
	/** Drive changes the server has not confirmed yet, laid over `home`. */
	pendingHome: RoomPatch[]
}

export type UserStoreOptions = {
	warm: Warm
	url: string
	connect?: Connect
	backoff?: Backoff
	now?: () => number
	newId?: () => string
	ttlMs?: number
}

export type UserStore = {
	readonly state: UserState
	/** Pinned first, then the most recently updated, with pending edits applied. */
	chats(): Chat[]
	readonly ready: Promise<void>
	/** The user's agents, with the ones not yet confirmed. */
	agents(): Agent[]
	/** Adds an agent at once and sends it after. The caller makes the id and the unique handle. */
	createAgent(agent: Agent): void
	/** Returns the new room's id. `agents` are the ids of the agents it starts with. */
	createChat(title: string, agents?: readonly string[]): RoomId
	rename(roomId: RoomId, title: string): void
	pin(roomId: RoomId, pinned: boolean): void
	mute(roomId: RoomId, muted: boolean): void
	/** A private chat: its agents save no memory, change no soul, and write nothing to /home. */
	setPrivate(roomId: RoomId, value: boolean): void
	remove(roomId: RoomId): void
	/** The drive's files and folders, with pending changes applied. */
	homeFiles(): FileRef[]
	homeFolders(): string[]
	/** `rm`, `mv`, or `mkdir` on the drive, shown at once. A refusal rolls it back and calls `onHomeRefused`. */
	homeOp(op: FileOp): void
	onHomeRefused(listener: (op: FileOp, reason: string) => void): () => void
	close(): void
}

export function createUserStore(options: UserStoreOptions): UserStore {
	const { warm } = options
	const now = options.now ?? Date.now
	const newId = options.newId ?? (() => crypto.randomUUID())
	const ttl = options.ttlMs ?? PATCH_TTL_MS

	const [state, setState] = createStore<UserState>({
		seq: 0,
		chats: [],
		agents: [],
		home: { files: [], folders: [] },
		loaded: false,
		connection: "closed",
		patches: [],
		pendingAgents: [],
		pendingHome: [],
	})
	const homeRefusals = new Set<(op: FileOp, reason: string) => void>()
	let socket: SyncSocket | null = null
	let closed = false
	let expiry: ReturnType<typeof setTimeout> | undefined

	function transmit(p: UserPatch) {
		if (!socket?.send({ t: "chat", op: p.op })) return
		const sentAt = now()
		setState("patches", (list) => list.map((x) => (x.clientId === p.clientId ? { ...x, sentAt } : x)))
		if (expiry === undefined)
			expiry = setTimeout(() => {
				expiry = undefined
				setState("patches", (list) => expire(list, now(), ttl))
			}, ttl)
	}

	function act(op: ChatOp) {
		const p: UserPatch = { clientId: newId(), op, at: now() }
		setState("patches", (list) => [...list, p])
		transmit(p)
	}

	function applyEvents(events: readonly UserEvent[]) {
		const sorted = [...events].sort((a, b) => a.seq - b.seq)
		const applied: UserEvent[] = []
		batch(() => {
			setState(
				produce((s) => {
					for (const e of sorted) if (applyUserEvent(s, e)) applied.push(e)
				}),
			)
			const confirmed = applied.flatMap((e) => (e.t === "agent" ? [e.agent.id] : []))
			if (confirmed.length) setState("pendingAgents", (list) => list.filter((a) => !confirmed.includes(a.id)))
			const next = settleUser(state.patches, applied)
			if (next.length !== state.patches.length) setState("patches", next)
			const home = state.pendingHome.filter((p) => !applied.some((e) => roomConfirmedBy(p, e as never)))
			if (home.length !== state.pendingHome.length) setState("pendingHome", home)
		})
		for (const e of applied) {
			if (e.t === "chat") putChats(warm, [e.chat])
			else if (e.t === "chat_removed") removeChat(warm, e.roomId)
		}
		if (applied.some((e) => e.t === "agent")) putAgents(warm, unwrap(state.agents))
		if (applied.length) setUserSeq(warm, state.seq)
	}

	function reset(snapshot: UserSnapshot) {
		const agents = [...(snapshot.agents ?? [])]
		setState({ seq: snapshot.seq, chats: [...snapshot.chats], agents, home: { files: [...snapshot.home.files], folders: [...snapshot.home.folders] } })
		setState("pendingAgents", (list) => list.filter((a) => !agents.some((x) => x.id === a.id)))
		replaceChats(warm, snapshot.chats, snapshot.seq)
		putAgents(warm, agents)
	}

	function onFrame(frame: UserToClient) {
		if (frame.t === "events") applyEvents(frame.events)
		else if (frame.t === "reset") reset(frame.snapshot)
		else if (frame.t === "home_refused") {
			const same = JSON.stringify(frame.op)
			setState("pendingHome", (list) => list.filter((p) => p.frame.t !== "files" || JSON.stringify(p.frame.op) !== same))
			for (const listener of homeRefusals) listener(frame.op, frame.reason)
		}
	}

	async function boot() {
		const [chats, seq, agents] = await Promise.all([allChats(warm), getUserSeq(warm), allAgents(warm)])
		if (closed) return
		setState({ chats, seq, agents, loaded: true })
		socket = createSyncSocket<UserToClient>({
			url: options.url,
			connect: options.connect,
			backoff: options.backoff,
			hello: () => ({ t: "hello", lastSeq: state.seq }),
			onOpen: () => {
				for (const p of [...unwrap(state.patches)]) transmit(p)
				for (const agent of [...unwrap(state.pendingAgents)]) socket?.send({ t: "agent", op: { op: "create", agent } })
			},
			onFrame,
			onStatus: (c) => setState("connection", c),
		})
	}

	const ready = boot()

	return {
		state,
		chats: () => overlayChats(state.chats, state.patches),
		ready,
		agents: () => [...state.agents, ...state.pendingAgents.filter((p) => !state.agents.some((a) => a.id === p.id))],
		createAgent(agent) {
			setState("pendingAgents", (list) => [...list, agent])
			socket?.send({ t: "agent", op: { op: "create", agent } })
		},
		createChat(title, agents) {
			const roomId = newRoomId(now())
			act({ op: "create", roomId, title, ...(agents?.length ? { agents } : {}) })
			return roomId
		},
		rename: (roomId, title) => act({ op: "rename", roomId, title }),
		pin: (roomId, pinned) => act({ op: "pin", roomId, pinned }),
		mute: (roomId, muted) => act({ op: "mute", roomId, muted }),
		setPrivate: (roomId, value) => act({ op: "private", roomId, private: value }),
		remove: (roomId) => act({ op: "delete", roomId }),
		homeFiles: () => overlayFiles(state.home.files, state.pendingHome, state.home.folders),
		homeFolders: () => overlayFolders(state.home.folders, state.pendingHome),
		homeOp(op) {
			setState("pendingHome", (list) => [...list, { clientId: newId(), at: now(), frame: { t: "files", op } }])
			socket?.send({ t: "home", op })
		},
		onHomeRefused(listener) {
			homeRefusals.add(listener)
			return () => homeRefusals.delete(listener)
		},
		close() {
			closed = true
			if (expiry !== undefined) clearTimeout(expiry)
			socket?.close()
		},
	}
}
