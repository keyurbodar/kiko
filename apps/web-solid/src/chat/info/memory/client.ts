// The memory request client. Architecture section 13. One `memory` frame goes out on the
// user socket with a `reqId`, and the `memory_result` with the same `reqId` answers it.
// A request made while the socket is down waits and goes out on connect. A request that
// gets no answer in `timeoutMs` fails, so a screen never waits for ever.

import type { MemoryOp, MemoryResult, UserToClient } from "@kiko/protocol"
import { type Connect, createSyncSocket } from "../../../sync/socket"

export type MemoryClient = {
	request(op: MemoryOp): Promise<MemoryResult>
	close(): void
}

export type MemoryClientOptions = { url: string; connect?: Connect; timeoutMs?: number }

type Pending = { op: MemoryOp; resolve: (r: MemoryResult) => void; timer: ReturnType<typeof setTimeout> }

export function createMemoryClient(options: MemoryClientOptions): MemoryClient {
	const timeoutMs = options.timeoutMs ?? 15_000
	const pending = new Map<string, Pending>()
	let n = 0

	const socket = createSyncSocket<UserToClient>({
		url: options.url,
		connect: options.connect,
		// The memory screen reads no user events. A `lastSeq` past the end gets one small
		// snapshot back, which is ignored, instead of a replay.
		hello: () => ({ t: "hello", lastSeq: Number.MAX_SAFE_INTEGER }),
		onOpen: () => {
			for (const [reqId, p] of pending) socket.send({ t: "memory", reqId, op: p.op })
		},
		onFrame(frame) {
			if (frame.t !== "memory_result") return
			const p = pending.get(frame.reqId)
			if (!p) return
			pending.delete(frame.reqId)
			clearTimeout(p.timer)
			p.resolve(frame.result)
		},
	})

	return {
		request(op) {
			return new Promise((resolve) => {
				const reqId = `m${++n}`
				const timer = setTimeout(() => {
					pending.delete(reqId)
					resolve({ ok: false, error: "kiko did not answer" })
				}, timeoutMs)
				const p: Pending = { op, resolve, timer }
				pending.set(reqId, p)
				socket.send({ t: "memory", reqId, op })
			})
		},
		close() {
			socket.close()
			for (const p of pending.values()) {
				clearTimeout(p.timer)
				p.resolve({ ok: false, error: "closed" })
			}
			pending.clear()
		},
	}
}
