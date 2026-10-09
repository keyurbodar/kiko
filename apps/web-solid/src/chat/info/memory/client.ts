// The memory request client. Architecture section 13. One `memory` frame goes out on the
// user socket with a `reqId`, and the `memory_result` with the same `reqId` answers it.
// A request made while the socket is down waits and goes out on connect. A request that
// gets no answer in `timeoutMs` fails, so a screen never waits for ever.

import type { MemoryOp, MemoryResult } from "@kiko/protocol"
import { type UserChannel, userChannel } from "../../../sync/user-channel"

export type MemoryClient = {
	request(op: MemoryOp): Promise<MemoryResult>
	close(): void
}

/** The user socket's channel: the app's one by default. */
export type MemoryClientOptions = { channel?: UserChannel; timeoutMs?: number }

type Pending = { op: MemoryOp; resolve: (r: MemoryResult) => void; timer: ReturnType<typeof setTimeout> }

export function createMemoryClient(options: MemoryClientOptions = {}): MemoryClient {
	const timeoutMs = options.timeoutMs ?? 15_000
	const channel = options.channel ?? userChannel
	const pending = new Map<string, Pending>()
	let n = 0


	const stopOpen = channel.onOpen(() => {
		for (const [reqId, p] of pending) channel.send({ t: "memory", reqId, op: p.op })
	})
	const stopFrames = channel.on("memory_result", (frame) => {
		const p = pending.get(frame.reqId)
		if (!p) return
		pending.delete(frame.reqId)
		clearTimeout(p.timer)
		p.resolve(frame.result)
	})

	return {
		request(op) {
			return new Promise((resolve) => {
				const reqId = `m${++n}`
				const timer = setTimeout(() => {
					pending.delete(reqId)
					resolve({ ok: false, error: "Yuki did not answer" })
				}, timeoutMs)
				const p: Pending = { op, resolve, timer }
				pending.set(reqId, p)
				channel.send({ t: "memory", reqId, op })
			})
		},
		close() {
			stopOpen()
			stopFrames()
			for (const p of pending.values()) {
				clearTimeout(p.timer)
				p.resolve({ ok: false, error: "Closed" })
			}
			pending.clear()
		},
	}
}
