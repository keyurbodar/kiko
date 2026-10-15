// The user's own data: for now, the chat list. Architecture section 9.1.
//
// Same shape as the room store, smaller. It paints the chat list from
// IndexedDB, connects with `hello {lastSeq}`, applies events in `seq` order,
// and lays pending chat edits over the server's list. Pending edits go out
// again after a reconnect.
//
// ASSUMPTION: chat edits are not written to the outbox, which holds sends
// only. A chat edit made offline is lost on reload.

import type { Agent, Chat, ChatOp, ExtensionInfo, ExtensionOp, ExtensionProposal, ExtensionResult, FileOp, FileRef, RoomId, UserEvent, UserSnapshot, UserToClient } from "@kiko/protocol"
import { batch } from "solid-js"
import { createStore, produce, unwrap } from "solid-js/store"
import { allAgents, allChats, getExtensions, getUserSeq, putAgents, putChats, putExtensions, removeChat, replaceChats, setUserSeq } from "../warm/chats"
import type { Warm } from "../warm/db"
import { expire, overlayChats, overlayFiles, overlayFolders, PATCH_TTL_MS, type RoomPatch, roomConfirmedBy, settleUser, type UserPatch } from "./patches"
import { type Backoff, type Connect, createSyncSocket, type SocketStatus, type SyncSocket } from "./socket"
import { type UserChannelHost, userChannel } from "./user-channel"

/** The user's drive, /home (architecture section 18.3). */
export type Home = { files: FileRef[]; folders: string[] }
export type UserData = { seq: number; chats: Chat[]; agents: Agent[]; home: Home; extensions: ExtensionInfo[]; proposals: ExtensionProposal[] }

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
	// Extensions (architecture section 24): installed ones by name, waiting installs by id.
	if (e.t === "extension") {
		const at = data.extensions.findIndex((x) => x.name === e.extension.name)
		if (at === -1) data.extensions.push(e.extension)
		else data.extensions[at] = e.extension
		data.extensions.sort((a, b) => a.name.localeCompare(b.name))
		return true
	}
	if (e.t === "extension_removed") {
		data.extensions = data.extensions.filter((x) => x.name !== e.name)
		return true
	}
	if (e.t === "extension_proposal") {
		data.proposals = [...data.proposals.filter((p) => p.id !== e.proposal.id), e.proposal]
		return true
	}
	if (e.t === "extension_proposal_removed") {
		data.proposals = data.proposals.filter((p) => p.id !== e.id)
		return true
	}
	const i = data.chats.findIndex((c) => c.roomId === (e.t === "chat" ? e.chat.roomId : e.roomId))
	if (e.t === "chat") {
		if (i === -1) data.chats.push(e.chat)
		else data.chats[i] = e.chat
	} else if (i !== -1) data.chats.splice(i, 1)
	return true
}

import { KIKO, newRoomId } from "@kiko/protocol"
export { newRoomId }

/** An extension change the server has not answered yet, laid over the server's lists. */
export type ExtensionPatch = { reqId: string; op: ExtensionOp }

/**
 * The extensions and waiting installs with the unanswered changes applied, so a switch flips, an
 * install moves, and an uninstall disappears the moment the human acts. Pure, for tests.
 */
export function overlayExtensions(data: Pick<UserData, "extensions" | "proposals">, patches: readonly ExtensionPatch[], now: number): Pick<UserData, "extensions" | "proposals"> {
	let extensions = data.extensions
	let proposals = data.proposals
	for (const { op } of patches) {
		if (op.op === "enable") extensions = extensions.map((x) => (x.name === op.name ? { ...x, enabled: op.enabled } : x))
		else if (op.op === "agents") extensions = extensions.map((x) => (x.name === op.name ? { ...x, agents: op.agents } : x))
		else if (op.op === "secret") extensions = extensions.map((x) => (x.name === op.name ? { ...x, secrets: x.secrets.map((s) => (s.name === op.secret ? { ...s, set: op.value !== null } : s)) } : x))
		else if (op.op === "uninstall") extensions = extensions.filter((x) => x.name !== op.name)
		else if (op.op === "decline") proposals = proposals.filter((p) => p.id !== op.id)
		else if (op.op === "install") {
			const p = proposals.find((x) => x.id === op.id)
			if (!p) continue
			proposals = proposals.filter((x) => x.id !== op.id)
			const before = extensions.find((x) => x.name === p.name)
			const m = p.bundle.manifest
			const next: ExtensionInfo = {
				name: p.name,
				version: p.version,
				description: m.description,
				hash: p.hash,
				enabled: before?.enabled ?? true,
				agents: before?.agents ?? null,
				source: p.source,
				...(p.by ? { by: p.by } : {}),
				...(p.room ? { room: p.room } : before?.room ? { room: before.room } : {}),
				manifest: m,
				secrets: Object.keys(m.secrets ?? {}).map((name) => ({ name, set: before?.secrets.some((s) => s.name === name && s.set) ?? false })),
				installedAt: before?.installedAt ?? now,
				updatedAt: now,
			}
			extensions = [...extensions.filter((x) => x.name !== p.name), next].sort((a, b) => a.name.localeCompare(b.name))
		}
	}
	return { extensions, proposals }
}

export type UserState = UserData & {
	loaded: boolean
	/** Extension changes sent and not answered yet. */
	extensionPatches: ExtensionPatch[]
	connection: SocketStatus
	patches: UserPatch[]
	/** Agents made here that the server has not confirmed yet. Sent again after a reconnect. */
	pendingAgents: Agent[]
	/** Drive changes the server has not confirmed yet, laid over `home`. */
	pendingHome: RoomPatch[]
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
	/** Installed extensions and waiting installs, with unanswered changes applied. */
	extensions(): ExtensionInfo[]
	proposals(): ExtensionProposal[]
	/** Sends one extension change or read. The change shows at once; an error rolls it back. */
	extensionOp(op: ExtensionOp): Promise<ExtensionResult>
	close(): void
}

/** How long an extension request waits for its answer. */
const EXTENSION_TIMEOUT_MS = 15_000

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
		extensions: [],
		proposals: [],
		extensionPatches: [],
		loaded: false,
		connection: "closed",
		patches: [],
		pendingAgents: [],
		pendingHome: [],
		synced: false,
		lastChat: null,
		refused: {},
		typing: {},
	})
	const homeRefusals = new Set<(op: FileOp, reason: string) => void>()
	const answers = new Map<string, (result: ExtensionResult) => void>()
	let opening: ReturnType<typeof setTimeout> | undefined
	let socket: SyncSocket | null = null
	let closed = false
	let detach = () => {}
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
			for (const e of applied) if (e.t === "theme") setState("theme", e.theme)
			const home = state.pendingHome.filter((p) => !applied.some((e) => roomConfirmedBy(p, e as never)))
			if (home.length !== state.pendingHome.length) setState("pendingHome", home)
		})
		for (const e of applied) {
			if (e.t === "chat") putChats(warm, [e.chat])
			else if (e.t === "chat_removed") removeChat(warm, e.roomId)
		}
		if (applied.some((e) => e.t === "agent")) putAgents(warm, unwrap(state.agents))
		if (applied.some((e) => e.t.startsWith("extension"))) putExtensions(warm, unwrap(state.extensions), unwrap(state.proposals))
		if (applied.length) setUserSeq(warm, state.seq)
	}

	function reset(snapshot: UserSnapshot) {
		const agents = [...(snapshot.agents ?? [])]
		setState({ seq: snapshot.seq, chats: [...snapshot.chats], agents, home: { files: [...snapshot.home.files], folders: [...snapshot.home.folders] }, lastChat: snapshot.lastChat ?? null, extensions: [...(snapshot.extensions ?? [])], proposals: [...(snapshot.proposals ?? [])] })
		putExtensions(warm, snapshot.extensions ?? [], snapshot.proposals ?? [])
		if (snapshot.theme !== undefined) setState("theme", snapshot.theme)
		setState("pendingAgents", (list) => list.filter((a) => !agents.some((x) => x.id === a.id)))
		replaceChats(warm, snapshot.chats, snapshot.seq)
		putAgents(warm, agents)
	}

	function onFrame(frame: UserToClient) {
		channel.deliver(frame)
		if (frame.t === "events" || frame.t === "reset") {
			if (frame.t === "events") applyEvents(frame.events)
			else reset(frame.snapshot)
			if (!state.synced) setState("synced", true)
		} else if (frame.t === "chat_refused") {
			// Nothing was made. The create is dropped, and a reader in it is sent to the agent's one chat.
			batch(() => {
				setState("refused", frame.roomId, frame.existing)
				setState("patches", (list) => list.filter((p) => p.op.roomId !== frame.roomId))
			})
		} else if (frame.t === "extension_result") {
			setState("extensionPatches", (list) => list.filter((p) => p.reqId !== frame.reqId))
			answers.get(frame.reqId)?.(frame.result)
			answers.delete(frame.reqId)
		} else if (frame.t === "typing") setState("typing", frame.roomId, frame.names.length ? [...frame.names] : undefined!)
		else if (frame.t === "home_refused") {
			const same = JSON.stringify(frame.op)
			setState("pendingHome", (list) => list.filter((p) => p.frame.t !== "files" || JSON.stringify(p.frame.op) !== same))
			for (const listener of homeRefusals) listener(frame.op, frame.reason)
		}
	}

	async function boot() {
		const [chats, seq, agents, ext] = await Promise.all([allChats(warm), getUserSeq(warm), allAgents(warm), getExtensions(warm)])
		if (closed) return
		setState({ chats, seq, agents, extensions: ext.extensions, proposals: ext.proposals, loaded: true })
		socket = createSyncSocket<UserToClient>({
			url: options.url,
			connect: options.connect,
			backoff: options.backoff,
			hello: () => ({ t: "hello", lastSeq: state.seq }),
			onOpen: () => {
				for (const p of [...unwrap(state.patches)]) transmit(p)
				for (const agent of [...unwrap(state.pendingAgents)]) socket?.send({ t: "agent", op: { op: "create", agent } })
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
		agents: () => [...state.agents, ...state.pendingAgents.filter((p) => !state.agents.some((a) => a.id === p.id))],
		createAgent(agent) {
			setState("pendingAgents", (list) => [...list, agent])
			socket?.send({ t: "agent", op: { op: "create", agent } })
		},
		createChat(title, agents) {
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
		extensions: () => overlayExtensions(state, state.extensionPatches, now()).extensions,
		proposals: () => overlayExtensions(state, state.extensionPatches, now()).proposals,
		async extensionOp(op) {
			const reqId = newId()
			// A page that just opened may ask before the socket is up: wait for the next open, once.
			if (!socket?.send({ t: "extension", reqId, op })) {
				await new Promise<void>((resolve) => {
					const off = channel.onOpen(() => {
						off()
						clearTimeout(timer)
						resolve()
					})
					const timer = setTimeout(() => {
						off()
						resolve()
					}, EXTENSION_TIMEOUT_MS / 3)
				})
				if (!socket?.send({ t: "extension", reqId, op })) return { ok: false, error: "You are offline. Try again when Kiko reconnects." }
			}
			setState("extensionPatches", (list) => [...list, { reqId, op }])
			return new Promise<ExtensionResult>((resolve) => {
				const timer = setTimeout(() => {
					answers.delete(reqId)
					setState("extensionPatches", (list) => list.filter((p) => p.reqId !== reqId))
					resolve({ ok: false, error: "Kiko did not answer. Try again." })
				}, EXTENSION_TIMEOUT_MS)
				answers.set(reqId, (result) => {
					clearTimeout(timer)
					resolve(result)
				})
			})
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
