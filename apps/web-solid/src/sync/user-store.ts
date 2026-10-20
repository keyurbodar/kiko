import type { OwnerToClient, Agent, AgentModel, AgentSlug, Chat, ChatOp, ClientToUser, FileOp, FileRef, KikoError, RoomId, ThinkingLevel, UserEvent, UserSnapshot, UserToClient } from "@kiko/protocol"
import { batch } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { allAgentModels, allAgents, allChats, getHome, getPendingChats, getUserSeq, putAgentModels, putAgents, putChats, putHome, putPendingChats, removeChat, replaceChats, setUserSeq } from "../warm/chats"
import type { Warm } from "../warm/db"
import { expire, overlayChats, overlayFiles, overlayFolders, PATCH_TTL_MS, type RoomPatch, roomConfirmedBy, settleUser, type UserPatch } from "./patches"
import { type Backoff, type Connect, createSyncSocket, type SocketStatus, type SyncSocket } from "./socket"
import { type UserChannelHost, userChannel } from "./socket"
import { kikoPlaceholder } from "../lib/chats"

type AgentModelFrame = Extract<ClientToUser, { t: "agent_model" }>
import { setFileToken } from "../lib/file-token"
import { APP_VERSION, backendSkew, type Skew } from "../lib/version-skew"

export type Home = { files: FileRef[]; folders: string[] }
export type UserData = { seq: number; chats: Chat[]; agents: Agent[]; home: Home }

export function applyUserEvent(data: UserData, e: UserEvent): boolean {
	if (e.seq <= data.seq) return false
	data.seq = e.seq
	if (e.t === "theme" || e.t === "agent_model") return true
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
	if (e.t === "agent_removed") {
		data.agents = data.agents.filter((a) => a.id !== e.id)
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

const clientBuild = () => ({ version: APP_VERSION, protocol: PROTOCOL })


export type UserState = UserData & {
	loaded: boolean
	connection: SocketStatus
	patches: UserPatch[]
	pendingHome: RoomPatch[]
	agentModels: Record<string, AgentModel>
	pendingModels: Record<string, AgentModel>
	theme?: string | null
	synced: boolean
	lastChat: RoomId | null
	refused: Record<string, RoomId>
	typing: Record<string, readonly string[]>
	skew?: Skew
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
	channel?: UserChannelHost
	onError?: (error: KikoError, roomId?: RoomId) => void
}

export type UserStore = {
	readonly state: UserState
	chats(): Chat[]
	readonly ready: Promise<void>
	agents(): Agent[]
	agentModel(slug: string): AgentModel | undefined
	setAgentModel(slug: AgentSlug, pick: { ref?: string; thinking?: ThinkingLevel; levels?: readonly ThinkingLevel[]; roomId?: RoomId }): void
	createChat(title: string, agents?: readonly string[]): RoomId
	addAgentChat(agent: Agent, roomId: RoomId): () => void
	open(roomId: RoomId): void

	rename(roomId: RoomId, title: string): void
	pin(roomId: RoomId, pinned: boolean): void
	mute(roomId: RoomId, muted: boolean): void
	setPrivate(roomId: RoomId, value: boolean): void
	remove(roomId: RoomId): void
	homeFiles(): FileRef[]
	homeFolders(): string[]
	homeOp(op: FileOp): void
	onHomeRefused(listener: (op: FileOp, reason: string) => void): () => void
	close(): void
}

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
	let awaitingHello = false
	const unsentModels = new Map<string, AgentModelFrame>()

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
				if (e.t === "agent_removed") {
					setState("agentModels", produce((models) => { delete models[e.slug] }))
					unsentModels.delete(e.slug)
				}
				else if (e.t === "theme") setState("theme", e.theme)
				else if (e.t === "agent_model") {
					setState("agentModels", e.slug, { model: e.model, name: e.name, thinking: e.thinking, thinkingLevels: e.thinkingLevels })
					setState("pendingModels", e.slug, undefined!)
					unsentModels.delete(e.slug)
				}
			}
			const home = state.pendingHome.filter((p) => !applied.some((e) => roomConfirmedBy(p, e as never)))
			if (home.length !== state.pendingHome.length) setState("pendingHome", home)
		})
		for (const e of applied) {
			if (e.t === "chat") putChats(warm, [e.chat])
			else if (e.t === "chat_removed") removeChat(warm, e.roomId)
		}
		if (applied.some((e) => e.t === "agent" || e.t === "agent_removed")) putAgents(warm, unwrap(state.agents))
		if (applied.some((e) => e.t === "agent_model" || e.t === "agent_removed")) putAgentModels(warm, unwrap(state.agentModels))
		if (applied.some((e) => e.t === "file" || e.t === "file_removed" || e.t === "folders")) putHome(warm, unwrap(state.home))
		if (applied.length) setUserSeq(warm, state.seq)
	}

	function reset(snapshot: UserSnapshot) {
		const agents = [...(snapshot.agents ?? [])]
		const home = { files: [...snapshot.home.files], folders: [...snapshot.home.folders] }
		setState({ seq: snapshot.seq, chats: [...snapshot.chats], agents, home, lastChat: snapshot.lastChat ?? null })
		if (snapshot.theme !== undefined) setState("theme", snapshot.theme)
		const agentModels = { ...snapshot.agentModels }
		setState({ agentModels, pendingModels: Object.fromEntries(Object.entries(unwrap(state.pendingModels)).filter(([slug]) => unsentModels.has(slug))) })
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
			batch(() => {
				setState("refused", frame.roomId, frame.existing)
				setPatches((list) => list.filter((p) => p.op.roomId !== frame.roomId))
			})
		} else if (frame.t === "model_refused") {
			unsentModels.delete(frame.slug)
			setState("pendingModels", frame.slug, undefined!)
			options.onError?.({ code: "model", message: frame.message, action: "open_models" })
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
		const first = chats.length ? chats : [kikoPlaceholder(now())]
		setState({ chats: first, seq: home ? seq : 0, agents, agentModels, home: home ?? { files: [], folders: [] }, patches: [...pending, ...state.patches], loaded: true })
		socket = createSyncSocket<OwnerToClient>({
			url: options.url,
			connect: options.connect,
			backoff: options.backoff,
			hello: () => {
				awaitingHello = true
				return { t: "hello", lastSeq: state.seq }
			},
			onOpen: () => {
				for (const p of [...unwrap(state.patches)]) transmit(p)
				for (const frame of unsentModels.values()) socket?.send(frame)
				channel.opened()
			},
			onFrame: (frame) => {
				if (frame.t === "room") channel.deliver(frame)
				else onFrame(frame)
			},
			onStatus: (c) => {
				channel.status(c)
				setState(c === "open" ? { connection: c } : { connection: c, typing: {} })
			},
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
			const frame: AgentModelFrame = { ...unsentModels.get(slug), t: "agent_model", slug, ...(ref ? { ref } : {}), ...(thinking ? { thinking } : {}), ...(roomId ? { roomId } : {}) }
			unsentModels.set(slug, frame)
			socket?.send(frame)
		},
		createChat(title, agents) {
			const existing = agents?.length ? sameAgentChat(overlayChats(state.chats, state.patches), agents) : null
			if (existing) return existing.roomId
			const roomId = newRoomId()
			act({ op: "create", roomId, title, ...(agents?.length ? { agents } : {}) })
			return roomId
		},
		addAgentChat(agent, roomId) {
			const chat: Chat = { roomId, title: agent.name, pinned: false, muted: false, lastSeq: 0, lastPreview: "", unread: 0, updatedAt: now(), agents: [agent.id] }
			batch(() => {
				setState("agents", (list) => [...list, agent])
				setState("chats", (list) => [...list, chat])
			})
			return () =>
				batch(() => {
					setState("agents", (list) => list.filter((a) => a.id !== agent.id))
					setState("chats", (list) => list.filter((c) => c.roomId !== roomId))
				})
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
