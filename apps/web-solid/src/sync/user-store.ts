// The user's own data: for now, the chat list. Architecture section 9.1.
//
// Same shape as the room store, smaller. It paints the chat list from
// IndexedDB, connects with `hello {lastSeq}`, applies events in `seq` order,
// and lays pending chat edits over the server's list. Pending edits go out
// again after a reconnect.
//
// ASSUMPTION: chat edits are not written to the outbox, which holds sends
// only. A chat edit made offline is lost on reload.

import type { Chat, ChatOp, RoomId, UserEvent, UserSnapshot, UserToClient } from "@kiko/protocol"
import { batch } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { allChats, getUserSeq, putChats, removeChat, replaceChats, setUserSeq } from "../warm/chats"
import type { Warm } from "../warm/db"
import { expire, overlayChats, PATCH_TTL_MS, settleUser, type UserPatch } from "./patches"
import { type Backoff, type Connect, createSyncSocket, type SocketStatus, type SyncSocket } from "./socket"

export type UserData = { seq: number; chats: Chat[] }

/** Applies one event in place. An event at or below `data.seq` is skipped. Returns false then. */
export function applyUserEvent(data: UserData, e: UserEvent): boolean {
	if (e.seq <= data.seq) return false
	data.seq = e.seq
	if (e.t === "theme") return true // the theme client reads these. The chat list has nothing to change.
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
	/** Returns the new room's id. */
	createChat(title: string): RoomId
	rename(roomId: RoomId, title: string): void
	pin(roomId: RoomId, pinned: boolean): void
	mute(roomId: RoomId, muted: boolean): void
	remove(roomId: RoomId): void
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
		loaded: false,
		connection: "closed",
		patches: [],
	})
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
			const next = settleUser(state.patches, applied)
			if (next.length !== state.patches.length) setState("patches", next)
		})
		for (const e of applied) {
			if (e.t === "chat") putChats(warm, [e.chat])
			else if (e.t === "chat_removed") removeChat(warm, e.roomId)
		}
		if (applied.length) setUserSeq(warm, state.seq)
	}

	function reset(snapshot: UserSnapshot) {
		setState({ seq: snapshot.seq, chats: [...snapshot.chats] })
		replaceChats(warm, snapshot.chats, snapshot.seq)
	}

	function onFrame(frame: UserToClient) {
		if (frame.t === "events") applyEvents(frame.events)
		else if (frame.t === "reset") reset(frame.snapshot)
	}

	async function boot() {
		const [chats, seq] = await Promise.all([allChats(warm), getUserSeq(warm)])
		if (closed) return
		setState({ chats, seq, loaded: true })
		socket = createSyncSocket<UserToClient>({
			url: options.url,
			connect: options.connect,
			backoff: options.backoff,
			hello: () => ({ t: "hello", lastSeq: state.seq }),
			onOpen: () => {
				for (const p of [...unwrap(state.patches)]) transmit(p)
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
		createChat(title) {
			const roomId = newRoomId(now())
			act({ op: "create", roomId, title })
			return roomId
		},
		rename: (roomId, title) => act({ op: "rename", roomId, title }),
		pin: (roomId, pinned) => act({ op: "pin", roomId, pinned }),
		mute: (roomId, muted) => act({ op: "mute", roomId, muted }),
		remove: (roomId) => act({ op: "delete", roomId }),
		close() {
			closed = true
			if (expiry !== undefined) clearTimeout(expiry)
			socket?.close()
		},
	}
}
