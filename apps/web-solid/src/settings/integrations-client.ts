// The Executor request client. Architecture section 12.1. One frame goes out on the user
// socket with a `reqId`, and the `executor` frame with the same `reqId` answers it. A frame
// with no `reqId` is a push, for example when the sign-in finishes in another tab. A request
// made while the socket is down goes out on connect. No answer in `timeoutMs` is an error.

import type { ClientToUser, ComposioResult, ExecutorResult, ExecutorStatus } from "@yuki/protocol"
import { type UserChannel, userChannel } from "../sync/user-channel"

type AskOf<T extends string> = ClientToUser extends infer F ? (F extends { t: T } ? Omit<F, "reqId"> : never) : never
type Ask = AskOf<"connectExecutor" | "disconnectExecutor" | "executorStatus">
type ComposioAsk = AskOf<"connectComposio" | "disconnectComposio" | "composioStatus">

export type RequestClient<A, R> = {
	request(frame: A): Promise<R>
	/** Frames the server sends to every socket. Returns the stop function. */
	onPush(fn: (result: R) => void): () => void
	close(): void
}
export type ExecutorClient = RequestClient<Ask, ExecutorResult>
export type ComposioClient = RequestClient<ComposioAsk, ComposioResult>

/** The user socket's channel: the app's one by default. */
export type ExecutorClientOptions = { channel?: UserChannel; timeoutMs?: number }

type Pending<R> = { frame: ClientToUser; resolve: (r: R) => void; timer: ReturnType<typeof setTimeout> }

export function createExecutorClient(options: ExecutorClientOptions = {}): ExecutorClient {
	return createClient(options, "executor", "e")
}

/** The same request/answer rule for the Composio frames. */
export function createComposioClient(options: ExecutorClientOptions = {}): ComposioClient {
	return createClient(options, "composio", "c")
}

function createClient<A, R extends { ok: boolean }>(options: ExecutorClientOptions, name: "executor" | "composio", prefix: string): RequestClient<A, R> {
	const timeoutMs = options.timeoutMs ?? 30_000
	const socket = options.channel ?? userChannel
	const pending = new Map<string, Pending<R>>()
	const listeners = new Set<(r: R) => void>()
	let n = 0

	const stopOpen = socket.onOpen(() => {
		for (const p of pending.values()) socket.send(p.frame)
	})
	const stopFrames = (socket.on as unknown as (t: string, fn: (f: { reqId?: string; result: R }) => void) => () => void)(name, (frame) => {
		if (frame.reqId === undefined) return void listeners.forEach((fn) => fn(frame.result))
		const p = pending.get(frame.reqId)
		if (!p) return
		pending.delete(frame.reqId)
		clearTimeout(p.timer)
		p.resolve(frame.result)
	})

	return {
		request(ask: A) {
			return new Promise<R>((resolve) => {
				const reqId = `${prefix}${++n}`
				const frame = { ...ask, reqId } as unknown as ClientToUser
				const timer = setTimeout(() => {
					pending.delete(reqId)
					resolve({ ok: false, error: "Yuki did not answer." } as unknown as R)
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
				p.resolve({ ok: false, error: "The connection closed." } as unknown as R)
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
 * clears. `globalThis.__yukiExecutorPush(result)` sends a push frame, so a browser check can
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
	;(globalThis as { __yukiExecutorPush?: typeof push }).__yukiExecutorPush = push
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
