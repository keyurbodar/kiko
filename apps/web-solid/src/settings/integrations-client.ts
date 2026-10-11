// The integration request clients (Composio, Kernel). Architecture sections 12 and 27. One frame goes
// out on the user socket with a `reqId`, and the frame of the same type with the same `reqId`
// answers it. A frame with no `reqId` is a push, for example when another tab connects or
// disconnects. A request made while the socket is down goes out on connect. No answer in
// `timeoutMs` is an error.

import type { ClientToUser, ComposioResult, KernelResult, UserToClient } from "@yuki/protocol"
import { type UserChannel, userChannel } from "../sync/user-channel"

type AskOf<T extends string> = ClientToUser extends infer F ? (F extends { t: T } ? Omit<F, "reqId"> : never) : never
type ComposioAsk = AskOf<"connectComposio" | "disconnectComposio" | "composioStatus">
type KernelAsk = AskOf<"connectKernel" | "disconnectKernel" | "kernelStatus">

type Result = { ok: boolean }

export type RequestClient<Ask, R extends Result> = {
	request(frame: Ask): Promise<R>
	/** Frames the server sends to every socket. Returns the stop function. */
	onPush(fn: (result: R) => void): () => void
	close(): void
}

export type ComposioClient = RequestClient<ComposioAsk, ComposioResult>
export type KernelClient = RequestClient<KernelAsk, KernelResult>

/** The user socket's channel: the app's one by default. */
export type ComposioClientOptions = { channel?: UserChannel; timeoutMs?: number }

type Pending<R> = { frame: ClientToUser; resolve: (r: R) => void; timer: ReturnType<typeof setTimeout> }

function createRequestClient<Ask, R extends Result>(type: "composio" | "kernel", options: ComposioClientOptions): RequestClient<Ask, R> {
	const timeoutMs = options.timeoutMs ?? 30_000
	const socket = options.channel ?? userChannel
	const pending = new Map<string, Pending<R>>()
	const listeners = new Set<(r: R) => void>()
	let n = 0

	const stopOpen = socket.onOpen(() => {
		for (const p of pending.values()) socket.send(p.frame)
	})
	const stopFrames = socket.on(type, (frame: Extract<UserToClient, { t: typeof type }>) => {
		const result = frame.result as unknown as R
		if (frame.reqId === undefined) return void listeners.forEach((fn) => fn(result))
		const p = pending.get(frame.reqId)
		if (!p) return
		pending.delete(frame.reqId)
		clearTimeout(p.timer)
		p.resolve(result)
	})

	return {
		request(ask) {
			return new Promise((resolve) => {
				const reqId = `c${++n}`
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

export const createComposioClient = (options: ComposioClientOptions = {}): ComposioClient => createRequestClient("composio", options)
export const createKernelClient = (options: ComposioClientOptions = {}): KernelClient => createRequestClient("kernel", options)
