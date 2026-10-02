import { expect, test } from "bun:test"
import type { ClientToUser, ExecutorResult } from "@kiko/protocol"
import { createExecutorClient } from "./integrations-client"
import type { SocketLike } from "../sync/socket"

function fake() {
	const sent: ClientToUser[] = []
	let sock!: SocketLike
	const connect = () => {
		sock = {
			send: (d: string) => void sent.push(JSON.parse(d)),
			close() {},
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
		}
		queueMicrotask(() => sock.onopen?.({}))
		return sock
	}
	const reply = (f: object) => sock.onmessage?.({ data: JSON.stringify(f) })
	return { connect, sent, reply }
}
const status = { connected: true, kind: "oauth" as const, pending: false, expiresAt: null, issuedAt: null, refreshable: true, rows: 2, organization: "acme" }

test("a reply with the same reqId answers the request, a push reaches listeners", async () => {
	const f = fake()
	const client = createExecutorClient({ url: "ws://x", connect: f.connect })
	const pushed: ExecutorResult[] = []
	client.onPush((r) => pushed.push(r))
	const p = client.request({ t: "executorStatus", tools: true })
	await new Promise((r) => setTimeout(r, 5))
	const asked = f.sent.find((s) => s.t === "executorStatus") as { reqId: string }
	f.reply({ t: "executor", reqId: "other", result: { ok: false, error: "no" } })
	f.reply({ t: "executor", reqId: asked.reqId, result: { ok: true, status, tools: ["a", "b"] } })
	expect(await p).toEqual({ ok: true, status, tools: ["a", "b"] })
	f.reply({ t: "executor", result: { ok: true, status } })
	expect(pushed).toHaveLength(1)
	client.close()
})

test("no answer is an error, not a hang", async () => {
	const f = fake()
	const client = createExecutorClient({ url: "ws://x", connect: f.connect, timeoutMs: 20 })
	expect(await client.request({ t: "disconnectExecutor" })).toEqual({ ok: false, error: "kiko did not answer" })
	client.close()
})
