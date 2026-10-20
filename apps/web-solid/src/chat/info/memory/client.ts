import type { MemoryOp, MemoryResult } from "@kiko/protocol"
import { type UserChannel, userChannel } from "../../../sync/socket"

export type MemoryClient = {
	request(op: MemoryOp): Promise<MemoryResult>
	close(): void
}

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
					resolve({ ok: false, error: "Kiko did not answer" })
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
