// One reconnecting socket. Architecture section 9.1 and 9.2.
//
// The client holds one for the user and one for each open room. On every
// connect the first frame is `hello` with the newest `seq` the client has
// applied, so the server replays what was missed. A lost connection retries
// with exponential backoff and jitter, and at once when the browser says it is
// back online. Frames are JSON. A frame that is not an object with a string `t`
// is dropped here, at the edge.
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

export const browserConnect: Connect = (url) => new WebSocket(url) as unknown as SocketLike

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
	const pingMs = options.pingMs ?? 25_000
	const pongMs = options.pongMs ?? 8_000
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
			attempt = 0
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
		probe = setInterval(() => check(), Math.min(5_000, pongMs))
		;(probe as { unref?: () => void }).unref?.()
	}

	function unwatch() {
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
			attempt = 0
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

	function retry() {
		unwatch()
		if (closed) return
		setStatus("closed")
		if (timer !== undefined) return
		const { baseMs, maxMs } = options.backoff ?? {}
		timer = setTimeout(open, backoffDelay(attempt++, baseMs, maxMs, random))
	}

	const onOnline = () => api.reconnect()
	const onVisible = () => {
		if (globalThis.document?.visibilityState === "visible") api.reconnect()
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
			if (socket) return check(true)
			if (timer !== undefined) clearTimeout(timer)
			attempt = 0
			open()
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
