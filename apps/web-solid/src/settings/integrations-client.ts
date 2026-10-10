// The Composio request client. Architecture section 12. One frame goes out on the user
// socket with a `reqId`, and the `composio` frame with the same `reqId` answers it. A frame
// with no `reqId` is a push, for example when another tab connects or disconnects. A request
// made while the socket is down goes out on connect. No answer in `timeoutMs` is an error.

import type { ClientToUser, ComposioResult } from "@yuki/protocol"
import { type UserChannel, userChannel } from "../sync/user-channel"

type AskOf<T extends string> = ClientToUser extends infer F ? (F extends { t: T } ? Omit<F, "reqId"> : never) : never
type ComposioAsk = AskOf<"connectComposio" | "disconnectComposio" | "composioStatus">

export type RequestClient<A, R> = {
	request(frame: A): Promise<R>
	/** Frames the server sends to every socket. Returns the stop function. */
	onPush(fn: (result: R) => void): () => void
	close(): void
}
export type ComposioClient = RequestClient<ComposioAsk, ComposioResult>

/** The user socket's channel: the app's one by default. */
export type ComposioClientOptions = { channel?: UserChannel; timeoutMs?: number }

type Pending<R> = { frame: ClientToUser; resolve: (r: R) => void; timer: ReturnType<typeof setTimeout> }

export function createComposioClient(options: ComposioClientOptions = {}): ComposioClient {
	return createClient(options, "composio", "c")
}

function createClient<A, R extends { ok: boolean }>(options: ComposioClientOptions, name: "composio", prefix: string): RequestClient<A, R> {
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
