import { expect, test } from "bun:test"
import type { ClientToUser, ComposioResult, UserToClient } from "@yuki/protocol"
import { createComposioClient } from "./integrations-client"
import { createUserChannel } from "../sync/user-channel"

function fake() {
	const sent: ClientToUser[] = []
	const channel = createUserChannel()
	channel.attach((f) => (sent.push(f), true))
	const reply = (f: object) => channel.deliver(f as UserToClient)
	return { channel, sent, reply }
}
const status = { connected: true, rows: 2 }

test("a reply with the same reqId answers the request, a push reaches listeners", async () => {
	const f = fake()
	const client = createComposioClient({ channel: f.channel })
	const pushed: ComposioResult[] = []
	client.onPush((r) => pushed.push(r))
	const p = client.request({ t: "composioStatus", tools: true })
	await new Promise((r) => setTimeout(r, 5))
	const asked = f.sent.find((s) => s.t === "composioStatus") as { reqId: string }
	f.reply({ t: "composio", reqId: "other", result: { ok: false, error: "no" } })
	f.reply({ t: "composio", reqId: asked.reqId, result: { ok: true, status, tools: ["a", "b"] } })
	expect(await p).toEqual({ ok: true, status, tools: ["a", "b"] })
	f.reply({ t: "composio", result: { ok: true, status } })
	expect(pushed).toHaveLength(1)
	client.close()
})

test("no answer is an error, not a hang", async () => {
	const f = fake()
	const client = createComposioClient({ channel: f.channel, timeoutMs: 20 })
	expect(await client.request({ t: "disconnectComposio" })).toEqual({ ok: false, error: "Yuki did not answer." })
	client.close()
})

test("a request made while the socket is down goes out on connect, and close stops listening", async () => {
	const channel = createUserChannel()
	const sent: ClientToUser[] = []
	const client = createComposioClient({ channel })
	const p = client.request({ t: "composioStatus" })
	expect(sent).toHaveLength(0)
	channel.attach((f) => (sent.push(f), true))
	channel.opened()
	const asked = sent[0] as { reqId: string }
	channel.deliver({ t: "composio", reqId: asked.reqId, result: { ok: true, status } } as UserToClient)
	expect(await p).toEqual({ ok: true, status })
	const pushed: ComposioResult[] = []
	client.onPush((r) => pushed.push(r))
	client.close()
	channel.deliver({ t: "composio", result: { ok: true, status } } as UserToClient)
	expect(pushed).toHaveLength(0)
})
