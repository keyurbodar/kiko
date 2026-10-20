import type { ClientToOwner, ClientToRoom, OwnerToClient, RoomId, RoomToClient, ClientToUser, UserToClient } from "@kiko/protocol"
import { socketProtocols } from "../lib/api"
//
// A socket can die without a close event (a laptop that slept, a network that
// changed), and the chat would sit stale. So the client sends a bare `ping`
// after `pingMs` of silence, and at once when the tab returns or the network
// comes back. The Durable Object answers `pong` through the runtime's
// auto-response, which never wakes it. Any frame counts as life. A socket silent
// for `pongMs` after a ping is dropped and reconnected at once.

/** The liveness probe, sent as is. Not JSON, so it never reaches a frame handler. */
export const PING = "ping"
export const PONG = "pong"

export type SocketLike = {
	send(data: string): void
	close(code?: number, reason?: string): void
	onopen: ((event: unknown) => void) | null
	onmessage: ((event: { data: unknown }) => void) | null
	onclose: ((event: unknown) => void) | null
	onerror: ((event: unknown) => void) | null
}

/** Opens one connection. The browser's `WebSocket` by default, the mock room in tests. */
export type Connect = (url: string) => SocketLike

export const browserConnect: Connect = (url) => new WebSocket(url, socketProtocols()) as unknown as SocketLike

export type SocketStatus = "connecting" | "open" | "closed"

export type Backoff = {
	/** The first retry waits about this long. Defaults to 250 ms. */
	baseMs?: number
	/** No retry waits longer. Defaults to 10 s. */
	maxMs?: number
}

export type SyncSocketOptions<In> = {
	url: string
	connect?: Connect
	/** The frame sent first on every connect. Read at connect time, so it carries the current `lastSeq`. */
	hello: () => { t: "hello"; lastSeq: number }
	/** Runs right after `hello` on every connect. Resends go here. */
	onOpen?: () => void
	onFrame: (frame: In) => void
	onStatus?: (status: SocketStatus) => void
	backoff?: Backoff
	random?: () => number
	/** Silence before a ping. Defaults to 25 s. */
	pingMs?: number
	/** How long a ping may go unanswered. Defaults to 8 s. */
	pongMs?: number
}

export type SyncSocket = {
	readonly status: SocketStatus
	/** False when the socket is not open. The caller keeps the frame and resends it from `onOpen`. */
	send<F extends { t: string }>(frame: F): boolean
	/** Connects now when waiting to retry, or checks an open socket is still alive. */
	reconnect(): void
	/** Closes for good. */
	close(): void
}

/** The wait before retry number `attempt`, starting at 0. Full doubling, half of it jittered. */
export function backoffDelay(attempt: number, baseMs = 250, maxMs = 10_000, random = Math.random): number {
	const ceiling = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30))
	return Math.round(ceiling / 2 + (ceiling / 2) * random())
}

/** Null unless the data is JSON for an object with a string `t`. */
export function parseFrame<In>(data: unknown): In | null {
	if (typeof data !== "string") return null
	try {
		const value: unknown = JSON.parse(data)
		if (typeof value !== "object" || value === null || typeof (value as { t?: unknown }).t !== "string") return null
		return value as In
	} catch {
		return null
	}
}

export function createSyncSocket<In>(options: SyncSocketOptions<In>): SyncSocket {
	const connect = options.connect ?? browserConnect
	const random = options.random ?? Math.random
	let status: SocketStatus = "closed"
	let socket: SocketLike | null = null
	let attempt = 0
	let timer: ReturnType<typeof setTimeout> | undefined
	let closed = false
	let stable: ReturnType<typeof setTimeout> | undefined
	const pingMs = options.pingMs ?? 10_000
	const pongMs = options.pongMs ?? 5_000
	let heardAt = 0
	let pingedAt: number | undefined
	let probe: ReturnType<typeof setInterval> | undefined

	const setStatus = (next: SocketStatus) => {
		if (status === next) return
		status = next
		options.onStatus?.(next)
	}

	function open() {
		if (closed) return
		timer = undefined
		setStatus("connecting")
		let s: SocketLike
		try {
			s = connect(options.url)
		} catch {
			return retry()
		}
		socket = s
		s.onopen = () => {
			if (socket !== s) return
			stable = setTimeout(() => {
				if (socket === s) attempt = 0
			}, 10_000)
			heardAt = Date.now()
			pingedAt = undefined
			watch()
			setStatus("open")
			s.send(JSON.stringify(options.hello()))
			options.onOpen?.()
		}
		s.onmessage = (event) => {
			if (socket !== s) return
			heardAt = Date.now()
			pingedAt = undefined
			const frame = parseFrame<In>(event.data)
			if (frame) options.onFrame(frame)
		}
		s.onerror = () => {}
		s.onclose = () => {
			if (socket !== s) return
			socket = null
			retry()
		}
	}

	/** Probes while a socket is open. Unref'd where the runtime allows, so it never holds a process open. */
	function watch() {
		if (probe !== undefined) return
		probe = setInterval(() => check(), Math.min(2_000, pongMs))
		;(probe as { unref?: () => void }).unref?.()
	}

	function unwatch() {
		if (stable !== undefined) clearTimeout(stable)
		stable = undefined
		if (probe !== undefined) clearInterval(probe)
		probe = undefined
	}

	/** Sends a ping, or drops a socket whose ping went unanswered. `now` pings regardless of silence. */
	function check(now = false) {
		const s = socket
		if (!s || status !== "open") return
		const t = Date.now()
		if (pingedAt !== undefined) {
			if (t - pingedAt < pongMs) return
			// Dead without a close event. Forget it and connect again at once.
			socket = null
			pingedAt = undefined
			try {
				s.close(4000, "no pong")
			} catch {}
			unwatch()
			setStatus("closed")
			return open()
		}
		if (!now && t - heardAt < pingMs) return
		try {
			s.send(PING)
			pingedAt = t
		} catch {}
	}

	/** Drops the socket this client has and connects again at once, with no backoff. */
	function reopen() {
		if (closed) return
		const s = socket
		socket = null
		pingedAt = undefined
		unwatch()
		if (timer !== undefined) {
			clearTimeout(timer)
			timer = undefined
		}
		setStatus("closed")
		try {
			s?.close(4000, "reconnect")
		} catch {}
		open()
	}

	function retry() {
		unwatch()
		if (closed) return
		setStatus("closed")
		if (timer !== undefined) return
		const { baseMs, maxMs } = options.backoff ?? {}
		timer = setTimeout(open, backoffDelay(attempt++, baseMs, maxMs, random))
	}

	// The network came back: the socket on the old one is gone even when it never said so.
	const onOnline = () => reopen()
	// A tab that was hidden may have had its timers frozen for minutes. A socket silent longer than one
	// probe cycle is replaced rather than pinged: waiting for the pong is what made a returning tab sit
	// on stale content.
	const onVisible = () => {
		if (globalThis.document?.visibilityState !== "visible") return
		if (socket && Date.now() - heardAt > pingMs + pongMs) reopen()
		else if (socket) check(true)
		else reopen()
	}
	globalThis.addEventListener?.("online", onOnline)
	globalThis.document?.addEventListener?.("visibilitychange", onVisible)

	const api: SyncSocket = {
		get status() {
			return status
		},
		send(frame) {
			if (status !== "open" || !socket) return false
			try {
				socket.send(JSON.stringify(frame))
				return true
			} catch {
				return false
			}
		},
		reconnect() {
			if (closed) return
			if (!socket) return reopen()
			if (Date.now() - heardAt > pingMs) return reopen()
			check(true)
		},
		close() {
			closed = true
			if (timer !== undefined) clearTimeout(timer)
			globalThis.removeEventListener?.("online", onOnline)
			globalThis.document?.removeEventListener?.("visibilitychange", onVisible)
			unwatch()
			const s = socket
			socket = null
			s?.close(1000, "closed")
			setStatus("closed")
		},
	}

	open()
	return api
}

type FrameOf<T extends UserToClient["t"]> = Extract<UserToClient, { t: T }>

export type UserChannel = {
	/** False when the socket is not open. The caller keeps the frame and resends it from `onOpen`. */
	send(frame: ClientToUser): boolean
	/** Calls `fn` with every frame of type `t`. Returns the unsubscribe. */
	on<T extends UserToClient["t"]>(t: T, fn: (frame: FrameOf<T>) => void): () => void
	/** Runs after `hello` on every connect. Returns the unsubscribe. */
	onOpen(fn: () => void): () => void
	onStatus(fn: (status: SocketStatus) => void): () => void
	room(options: RoomChannelOptions): RoomChannel
}

/** The socket owner's side. */
export type UserChannelHost = UserChannel & {
	/** Makes `send` the channel's socket. Returns the detach, which does nothing once another socket attached. */
	attach(send: (frame: ClientToOwner) => boolean): () => void
	deliver(frame: OwnerToClient): void
	opened(): void
	status(status: SocketStatus): void
}

export function createUserChannel(): UserChannelHost {
	const listeners = new Map<string, Set<(frame: never) => void>>()
	const openers = new Set<() => void>()
	const statuses = new Set<(status: SocketStatus) => void>()
	let sender: ((frame: ClientToOwner) => boolean) | null = null
	let status: SocketStatus = "closed"
	const rooms = new Map<RoomId, Set<RoomChannelOptions>>()
	const subscribe = (roomId: RoomId, room: RoomChannelOptions) => {
		sender?.({ t: "subscribe", roomId, lastSeq: room.lastSeq() })
		room.onStatus("open")
		room.onOpen()
	}
	return {
		send: (frame) => sender?.(frame) ?? false,
		on(t, fn) {
			let set = listeners.get(t)
			if (!set) listeners.set(t, (set = new Set()))
			set.add(fn as (frame: never) => void)
			return () => {
				set.delete(fn as (frame: never) => void)
				if (set.size === 0) listeners.delete(t)
			}
		},
		onOpen(fn) {
			openers.add(fn)
			return () => void openers.delete(fn)
		},
		onStatus(fn) {
			statuses.add(fn)
			return () => void statuses.delete(fn)
		},
		attach(send) {
			sender = send
			return () => {
				if (sender === send) {
					sender = null
					status = "closed"
					for (const fn of [...statuses]) fn(status)
					for (const set of rooms.values()) for (const room of set) room.onStatus(status)
				}
			}
		},
		room(options) {
			const { roomId } = options
			let set = rooms.get(roomId)
			if (!set) rooms.set(roomId, (set = new Set()))
			set.add(options)
			if (status === "open") queueMicrotask(() => {
				if (!set.has(options)) return
				if (status === "open") subscribe(roomId, options)
				else options.onStatus(status)
			})
			else options.onStatus(status)
			return {
				send: (frame) => set.has(options) && status === "open" && (sender?.({ t: "room", roomId, frame }) ?? false),
				close() {
					if (!set.delete(options)) return
					if (!set.size) {
						rooms.delete(roomId)
						sender?.({ t: "unsubscribe", roomId })
					}
					options.onStatus("closed")
				},
			}
		},
		status(next) {
			if (next === "open") return
			status = next
			for (const fn of [...statuses]) fn(next)
			for (const set of rooms.values()) for (const room of set) room.onStatus(next)
		},
		deliver(frame) {
			if (frame.t === "room") {
				for (const room of rooms.get(frame.roomId) ?? []) room.onFrame(frame.frame)
				return
			}
			for (const fn of listeners.get(frame.t) ?? []) (fn as (f: UserToClient) => void)(frame)
		},
		opened() {
			status = "open"
			for (const fn of [...statuses]) fn(status)
			for (const [roomId, set] of rooms) for (const room of set) subscribe(roomId, room)
			for (const fn of [...openers]) fn()
		},
	}
}

export type RoomChannelOptions = {
	roomId: RoomId
	lastSeq(): number
	onFrame(frame: RoomToClient): void
	onOpen(): void
	onStatus(status: SocketStatus): void
}

export type RoomChannel = {
	send(frame: ClientToRoom): boolean
	close(): void
}

/** The app's channel. The user store attaches its socket to it. */
export const userChannel = createUserChannel()
