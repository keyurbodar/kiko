// The Executor request client. Architecture section 12.1. One frame goes out on the user
// socket with a `reqId`, and the `executor` frame with the same `reqId` answers it. A frame
// with no `reqId` is a push, for example when the sign-in finishes in another tab. A request
// made while the socket is down goes out on connect. No answer in `timeoutMs` is an error.

import type { ClientToUser, ExecutorResult, ExecutorStatus } from "@kiko/protocol"
import { type UserChannel, userChannel } from "../sync/user-channel"

type Ask = ClientToUser extends infer F ? (F extends { t: "connectExecutor" | "disconnectExecutor" | "executorStatus" } ? Omit<F, "reqId"> : never) : never

export type ExecutorClient = {
	request(frame: Ask): Promise<ExecutorResult>
	/** Frames the server sends to every socket. Returns the stop function. */
	onPush(fn: (result: ExecutorResult) => void): () => void
	close(): void
}

/** The user socket's channel: the app's one by default. */
export type ExecutorClientOptions = { channel?: UserChannel; timeoutMs?: number }

type Pending = { frame: ClientToUser; resolve: (r: ExecutorResult) => void; timer: ReturnType<typeof setTimeout> }

export function createExecutorClient(options: ExecutorClientOptions = {}): ExecutorClient {
	const timeoutMs = options.timeoutMs ?? 30_000
	const socket = options.channel ?? userChannel
	const pending = new Map<string, Pending>()
	const listeners = new Set<(r: ExecutorResult) => void>()
	let n = 0

	const stopOpen = socket.onOpen(() => {
		for (const p of pending.values()) socket.send(p.frame)
	})
	const stopFrames = socket.on("executor", (frame) => {
		if (frame.reqId === undefined) return void listeners.forEach((fn) => fn(frame.result))
		const p = pending.get(frame.reqId)
		if (!p) return
		pending.delete(frame.reqId)
		clearTimeout(p.timer)
		p.resolve(frame.result)
	})

	return {
		request(ask) {
			return new Promise((resolve) => {
				const reqId = `e${++n}`
				const frame = { ...ask, reqId } as ClientToUser
				const timer = setTimeout(() => {
					pending.delete(reqId)
					resolve({ ok: false, error: "Kiko did not answer." })
				}, timeoutMs)
				pending.set(reqId, { frame, resolve, timer })
				socket.send(frame)
			})
		},
		onPush(fn) {
			listeners.add(fn)
			return () => void listeners.delete(fn)
		},
		close() {
			stopOpen()
			stopFrames()
			for (const p of pending.values()) {
				clearTimeout(p.timer)
				p.resolve({ ok: false, error: "The connection closed." })
			}
			pending.clear()
			listeners.clear()
		},
	}
}

const EMPTY: ExecutorStatus = { connected: false, kind: null, pending: false, expiresAt: null, issuedAt: null, refreshable: false, rows: 0 }

/**
 * The dev mock, same rule as the chat data layer. It answers like the server for a user
 * with no account: a sign-in gives an authorize URL, a pasted key connects, disconnect
 * clears. `globalThis.__kikoExecutorPush(result)` sends a push frame, so a browser check can
 * show the connected state without an Executor account.
 */
export function createMockExecutor(): ExecutorClient {
	const listeners = new Set<(r: ExecutorResult) => void>()
	let status = EMPTY
	let tools: string[] = []
	const push = (result: ExecutorResult) => {
		if (result.ok) {
			status = result.status
			if (result.tools) tools = [...result.tools]
		}
		listeners.forEach((fn) => fn(result))
	}
	;(globalThis as { __kikoExecutorPush?: typeof push }).__kikoExecutorPush = push
	return {
		async request(ask) {
			if (ask.t === "disconnectExecutor") {
				status = EMPTY
				tools = []
				return { ok: true, status }
			}
			if (ask.t === "connectExecutor") {
				if (ask.apiKey === undefined) return { ok: true, status, authorizeUrl: "https://v2.executor.sh/api/auth/oauth2/authorize?mock=1" }
				status = { ...EMPTY, connected: true, kind: "api_key", rows: 1 }
				return { ok: true, status }
			}
			return { ok: true, status, ...(ask.tools ? { tools } : {}) }
		},
		onPush(fn) {
			listeners.add(fn)
			return () => void listeners.delete(fn)
		},
		close() {
			listeners.clear()
		},
	}
}
