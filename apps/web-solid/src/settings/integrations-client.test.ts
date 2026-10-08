import { expect, test } from "bun:test"
import type { ClientToUser, ExecutorResult, UserToClient } from "@kiko/protocol"
import { createExecutorClient } from "./integrations-client"
import { createUserChannel } from "../sync/user-channel"

function fake() {
	const sent: ClientToUser[] = []
	const channel = createUserChannel()
	channel.attach((f) => (sent.push(f), true))
	const reply = (f: object) => channel.deliver(f as UserToClient)
	return { channel, sent, reply }
}
const status = { connected: true, kind: "oauth" as const, pending: false, expiresAt: null, issuedAt: null, refreshable: true, rows: 2, organization: "acme" }

test("a reply with the same reqId answers the request, a push reaches listeners", async () => {
	const f = fake()
	const client = createExecutorClient({ channel: f.channel })
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
	const client = createExecutorClient({ channel: f.channel, timeoutMs: 20 })
	expect(await client.request({ t: "disconnectExecutor" })).toEqual({ ok: false, error: "Kiko did not answer." })
	client.close()
})

test("a request made while the socket is down goes out on connect, and close stops listening", async () => {
	const channel = createUserChannel()
	const sent: ClientToUser[] = []
	const client = createExecutorClient({ channel })
	const p = client.request({ t: "executorStatus" })
	expect(sent).toHaveLength(0)
	channel.attach((f) => (sent.push(f), true))
	channel.opened()
	const asked = sent[0] as { reqId: string }
	channel.deliver({ t: "executor", reqId: asked.reqId, result: { ok: true, status } } as UserToClient)
	expect(await p).toEqual({ ok: true, status })
	const pushed: ExecutorResult[] = []
	client.onPush((r) => pushed.push(r))
	client.close()
	channel.deliver({ t: "executor", result: { ok: true, status } } as UserToClient)
	expect(pushed).toHaveLength(0)
})
