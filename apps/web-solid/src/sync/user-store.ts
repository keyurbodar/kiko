// The user's own data: for now, the chat list. Architecture section 9.1.
//
// Same shape as the room store, smaller. It paints the chat list from
// IndexedDB, connects with `hello {lastSeq}`, applies events in `seq` order,
// and lays pending chat edits over the server's list. Pending edits are kept
// in IndexedDB and go out again after a reload or a reconnect. Each carries a
// stable id (a create names its room), so a replay changes nothing twice.

import type { Agent, AgentModel, AgentSlug, Chat, ChatOp, FileOp, FileRef, KikoError, RoomId, ThinkingLevel, UserEvent, UserSnapshot, UserToClient } from "@kiko/protocol"
import { batch } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { allAgentModels, allAgents, allChats, getHome, getPendingChats, getUserSeq, putAgentModels, putAgents, putChats, putHome, putPendingChats, removeChat, replaceChats, setUserSeq } from "../warm/chats"
import type { Warm } from "../warm/db"
import { expire, overlayChats, overlayFiles, overlayFolders, PATCH_TTL_MS, type RoomPatch, roomConfirmedBy, settleUser, type UserPatch } from "./patches"
import { type Backoff, type Connect, createSyncSocket, type SocketStatus, type SyncSocket } from "./socket"
import { type UserChannelHost, userChannel } from "./user-channel"
import { kikoPlaceholder } from "../lib/chats"
import { setFileToken } from "../lib/file-token"
import { APP_VERSION, backendSkew, type Skew } from "../lib/version-skew"

/** The user's drive, /home (architecture section 18.3). */
export type Home = { files: FileRef[]; folders: string[] }
export type UserData = { seq: number; chats: Chat[]; agents: Agent[]; home: Home }

/** Applies one event in place. An event at or below `data.seq` is skipped. Returns false then. */
export function applyUserEvent(data: UserData, e: UserEvent): boolean {
	if (e.seq <= data.seq) return false
	data.seq = e.seq
	if (e.t === "theme" || e.t === "agent_model") return true // the theme client and the agent models read these. The chat list has nothing to change.
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

import { clampThinking, defaultThinking, newRoomId, PROTOCOL, sameAgentChat } from "@kiko/protocol"
export { newRoomId }

// The app's own build. The backend's answer is checked against it.
const clientBuild = () => ({ version: APP_VERSION, protocol: PROTOCOL })


export type UserState = UserData & {
	loaded: boolean
	connection: SocketStatus
	patches: UserPatch[]
	/** Drive changes the server has not confirmed yet, laid over `home`. */
	pendingHome: RoomPatch[]
	/** Every agent's model and reasoning level, Kiko included, as the server last said. One entry per agent, whatever chat is open. */
	agentModels: Record<string, AgentModel>
	/** Model picks the server has not confirmed yet, laid over `agentModels`. */
	pendingModels: Record<string, AgentModel>
	/** The saved look as the server last said it, as JSON text. Undefined until it says. `theme/live.ts` applies it. */
	theme?: string | null
	/** True once the server has answered `hello`: the list is the server's, not only this device's. */
	synced: boolean
	/** The chat the server says the user was last in, from the last snapshot. */
	lastChat: RoomId | null
	/** Second direct chats the server refused, each with the chat that agent already has. */
	refused: Record<string, RoomId>
	/** The display names typing in each chat, from the `typing` frame. Memory only. */
	typing: Record<string, readonly string[]>
	/** Whether the backend can serve this build. Set from the first `hello` reply. Undefined until then. */
	skew?: Skew
	/** The backend's version as its `hello` reply said it. Undefined from an older backend. */
	backendVersion?: string
}

export type UserStoreOptions = {
	warm: Warm
	url: string
	connect?: Connect
	backoff?: Backoff
	now?: () => number
	newId?: () => string
	ttlMs?: number
	/** Where the socket is shared with the look, memory, and Composio. The app's channel by default. */
	channel?: UserChannelHost
	/** Something the human must know about, from the server. */
	/** `roomId` is the chat the error belongs to, when it has one. */
	onError?: (error: KikoError, roomId?: RoomId) => void
}

export type UserStore = {
	readonly state: UserState
	/** Pinned first, then the most recently updated, with pending edits applied. */
	chats(): Chat[]
	readonly ready: Promise<void>
	/** The user's agents. */
	agents(): Agent[]
	/** The agent's model and level, with a pending pick applied. Undefined until the server has said. */
	agentModel(slug: string): AgentModel | undefined
	/** Sets an agent's model, its level, or both, for every chat. Shown at once; the server confirms it. `levels` are the new model's supported levels. */
	setAgentModel(slug: AgentSlug, pick: { ref?: string; thinking?: ThinkingLevel; levels?: readonly ThinkingLevel[]; roomId?: RoomId }): void
	/**
	 * The room that holds exactly these agents: the one already there, else a new one, shown at
	 * once. The server decides the same way, so a refusal only follows a race with another device.
	 */
	createChat(title: string, agents?: readonly string[]): RoomId
	/** Tells the server the user is in this chat, at most once every `OPEN_DEBOUNCE_MS`. */
	open(roomId: RoomId): void

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

/** How long the user stays in a chat before the server hears of it. A quick tab switch sends one frame. */
export const OPEN_DEBOUNCE_MS = 2_000

export function createUserStore(options: UserStoreOptions): UserStore {
	const { warm } = options
	const channel = options.channel ?? userChannel
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
		pendingHome: [],
		agentModels: {},
		pendingModels: {},
		synced: false,
		lastChat: null,
		refused: {},
		typing: {},
	})
	const homeRefusals = new Set<(op: FileOp, reason: string) => void>()
	let opening: ReturnType<typeof setTimeout> | undefined
	let socket: SyncSocket | null = null
	let closed = false
	let detach = () => {}
	let expiry: ReturnType<typeof setTimeout> | undefined
	// True from each `hello` until the first events or reset that answers it. That answer carries the backend's build.
	let awaitingHello = false

	function setPatches(next: UserPatch[] | ((list: UserPatch[]) => UserPatch[])) {
		setState("patches", next)
		putPendingChats(warm, unwrap(state.patches).map(({ clientId, op, at }) => ({ clientId, op, at })))
	}

	function transmit(p: UserPatch) {
		if (!socket?.send({ t: "chat", op: p.op })) return
		const sentAt = now()
		setState("patches", (list) => list.map((x) => (x.clientId === p.clientId ? { ...x, sentAt } : x)))
		if (expiry === undefined)
			expiry = setTimeout(() => {
				expiry = undefined
				setPatches((list) => expire(list, now(), ttl))
			}, ttl)
	}

	function act(op: ChatOp) {
		const p: UserPatch = { clientId: newId(), op, at: now() }
		setPatches((list) => [...list, p])
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
			if (next.length !== state.patches.length) setPatches(next)
			for (const e of applied) {
				if (e.t === "theme") setState("theme", e.theme)
				else if (e.t === "agent_model") {
					setState("agentModels", e.slug, { model: e.model, thinking: e.thinking, thinkingLevels: e.thinkingLevels })
					setState("pendingModels", e.slug, undefined!)
				}
			}
			const home = state.pendingHome.filter((p) => !applied.some((e) => roomConfirmedBy(p, e as never)))
			if (home.length !== state.pendingHome.length) setState("pendingHome", home)
		})
		for (const e of applied) {
			if (e.t === "chat") putChats(warm, [e.chat])
			else if (e.t === "chat_removed") removeChat(warm, e.roomId)
		}
		if (applied.some((e) => e.t === "agent")) putAgents(warm, unwrap(state.agents))
		if (applied.some((e) => e.t === "agent_model")) putAgentModels(warm, unwrap(state.agentModels))
		if (applied.some((e) => e.t === "file" || e.t === "file_removed" || e.t === "folders")) putHome(warm, unwrap(state.home))
		if (applied.length) setUserSeq(warm, state.seq)
	}

	function reset(snapshot: UserSnapshot) {
		const agents = [...(snapshot.agents ?? [])]
		const home = { files: [...snapshot.home.files], folders: [...snapshot.home.folders] }
		setState({ seq: snapshot.seq, chats: [...snapshot.chats], agents, home, lastChat: snapshot.lastChat ?? null })
		if (snapshot.theme !== undefined) setState("theme", snapshot.theme)
		const agentModels = { ...snapshot.agentModels }
		setState({ agentModels, pendingModels: {} })
		putAgentModels(warm, agentModels)
		replaceChats(warm, snapshot.chats, snapshot.seq)
		putAgents(warm, agents)
		putHome(warm, home)
	}

	function onFrame(frame: UserToClient) {
		channel.deliver(frame)
		if (frame.t === "events" || frame.t === "reset") {
			if (frame.fileToken) setFileToken(frame.fileToken)
			if (awaitingHello) {
				awaitingHello = false
				setState({ skew: backendSkew(clientBuild(), frame), backendVersion: frame.version })
			}
			if (frame.t === "events") applyEvents(frame.events)
			else reset(frame.snapshot)
			if (!state.synced) setState("synced", true)
		} else if (frame.t === "chat_refused") {
			// Nothing was made. The create is dropped, and a reader in it is sent to the agent's one chat.
			batch(() => {
				setState("refused", frame.roomId, frame.existing)
				setPatches((list) => list.filter((p) => p.op.roomId !== frame.roomId))
			})
		} else if (frame.t === "error") options.onError?.(frame.error, frame.roomId)
		else if (frame.t === "typing") setState("typing", frame.roomId, frame.names.length ? [...frame.names] : undefined!)
		else if (frame.t === "home_refused") {
			const same = JSON.stringify(frame.op)
			setState("pendingHome", (list) => list.filter((p) => p.frame.t !== "files" || JSON.stringify(p.frame.op) !== same))
			for (const listener of homeRefusals) listener(frame.op, frame.reason)
		}
	}

	async function boot() {
		const [chats, seq, agents, home, pending, agentModels] = await Promise.all([allChats(warm), getUserSeq(warm), allAgents(warm), getHome(warm), getPendingChats(warm), allAgentModels(warm)])
		if (closed) return
		// A cache with no drive predates the drive cache. Ask for a snapshot, not the events after `seq`.
		const first = chats.length ? chats : [kikoPlaceholder(now())]
		setState({ chats: first, seq: home ? seq : 0, agents, agentModels, home: home ?? { files: [], folders: [] }, patches: [...pending, ...state.patches], loaded: true })
		socket = createSyncSocket<UserToClient>({
			url: options.url,
			connect: options.connect,
			backoff: options.backoff,
			hello: () => {
				awaitingHello = true
				return { t: "hello", lastSeq: state.seq }
			},
			onOpen: () => {
				for (const p of [...unwrap(state.patches)]) transmit(p)
				channel.opened()
			},
			onFrame,
			// A socket that drops misses the frame that ends the typing, so it forgets who was.
			onStatus: (c) => setState(c === "open" ? { connection: c } : { connection: c, typing: {} }),
		})
		const own = socket
		detach = channel.attach((frame) => own.send(frame))
	}

	const ready = boot()

	return {
		state,
		chats: () => overlayChats(state.chats, state.patches),
		ready,
		agents: () => state.agents,
		agentModel: (slug) => state.pendingModels[slug] ?? state.agentModels[slug],
		setAgentModel(slug, { ref, thinking, levels, roomId }) {
			const current = state.pendingModels[slug] ?? state.agentModels[slug]
			const nextLevels = levels ?? current?.thinkingLevels
			const model = ref ?? current?.model
			if (model && nextLevels) setState("pendingModels", slug, { model, thinking: clampThinking(nextLevels, thinking ?? current?.thinking ?? defaultThinking(nextLevels)), thinkingLevels: nextLevels })
			socket?.send({ t: "agent_model", slug, ...(ref ? { ref } : {}), ...(thinking ? { thinking } : {}), ...(roomId ? { roomId } : {}) })
		},
		createChat(title, agents) {
			const existing = agents?.length ? sameAgentChat(overlayChats(state.chats, state.patches), agents) : null
			if (existing) return existing.roomId
			const roomId = newRoomId()
			act({ op: "create", roomId, title, ...(agents?.length ? { agents } : {}) })
			return roomId
		},
		open(roomId) {
			if (opening !== undefined) clearTimeout(opening)
			opening = setTimeout(() => {
				opening = undefined
				socket?.send({ t: "open", roomId })
			}, OPEN_DEBOUNCE_MS)
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
			detach()
			if (opening !== undefined) clearTimeout(opening)
			socket?.close()
		},
	}
}
