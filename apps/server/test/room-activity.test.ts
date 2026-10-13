import { afterAll, beforeAll, expect, test } from "bun:test"
import type { Activity, RoomEvent, RoomSnapshot, RoomToClient, WorkerRow } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./room-activity-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: { ROOM: { className: "RoomDO", useSQLite: true }, USER: { className: "UserDO", useSQLite: true }, AGENT: { className: "AgentDO", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

let n = 0
const fresh = () => `01JZ8Q4T6M${String(++n).padStart(16, "0")}`

async function open(room: string, lastSeq = 0) {
	const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
	const frames: RoomToClient[] = []
	ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
	await new Promise((resolve, reject) => {
		ws.onopen = resolve
		ws.onerror = reject
	})
	const take = async (match: (f: RoomToClient) => boolean) => {
		for (let i = 0; i < 3000; i++) {
			const at = frames.findIndex(match)
			if (at >= 0) return frames.splice(at, 1)[0]!
			await Bun.sleep(2)
		}
		throw new Error(`no frame. have ${JSON.stringify(frames)}`)
	}
	ws.send(JSON.stringify({ t: "hello", lastSeq }))
	const first = await take((f) => f.t === "events" || f.t === "reset")
	return { ws, frames, first, take, send: (frame: unknown) => ws.send(JSON.stringify(frame)), close: () => ws.close() }
}

type Client = Awaited<ReturnType<typeof open>>

const rpc = async (room: string, method: string, ...args: unknown[]) => {
	const res = await fetch(`${origin}/rpc/${room}/${method}`, { method: "POST", body: JSON.stringify(args) })
	return res.json() as Promise<unknown>
}

async function snapshot(room: string): Promise<RoomSnapshot> {
	const c = await open(room, 1_000_000)
	const reset = c.first
	c.close()
	if (!reset || reset.t !== "reset") throw new Error("no snapshot")
	return reset.snapshot
}

async function withAgent(room: string, slug = "ada"): Promise<Client> {
	const c = await open(room)
	await rpc(room, "memberOp", { op: "add", slug, name: slug })
	await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "member"))
	return c
}

const quiet = async (c: Client, ms = 300) => {
	const before = c.frames.length
	await Bun.sleep(ms)
	return c.frames.length - before
}

const statusOf = (activity?: Activity) => (f: RoomToClient) => f.t === "status" && JSON.stringify(f.activity) === JSON.stringify(activity)

test("a status frame carries the typed activity, and a reconnect snapshot shows who is busy", async () => {
	const room = fresh()
	const c = await withAgent(room)
	const read: Activity = { kind: "tool", tool: "read", caption: "reading /plan.md" }
	await rpc(room, "reportDoing", "ada", "reading /plan.md", read)
	const first = await c.take(statusOf(read))
	expect(first).toEqual({ t: "status", slug: "ada", state: "working", doing: "reading /plan.md", activity: read })

	await rpc(room, "setStatus", "ada", "typing")
	await c.take((f) => f.t === "status" && f.state === "typing" && f.activity?.kind === "tool")
	expect((await snapshot(room)).agents).toEqual([{ slug: "ada", state: "typing", doing: "reading /plan.md", activity: read }])

	const waiting: Activity = { kind: "waiting", on: "bob" as never }
	await rpc(room, "reportDoing", "ada", "waiting on @bob", waiting)
	await c.take(statusOf(waiting))
	expect((await snapshot(room)).agents?.[0]?.activity).toEqual(waiting)

	await rpc(room, "setStatus", "ada", "idle")
	const idle = await c.take((f) => f.t === "status" && f.state === "idle")
	expect(idle).toEqual({ t: "status", slug: "ada", state: "idle" })
	expect((await snapshot(room)).agents).toEqual([])
	c.close()
})

test("a typing member with nothing else to show is writing", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "setStatus", "ada", "typing")
	const frame = await c.take((f) => f.t === "status" && f.state === "typing")
	expect(frame).toMatchObject({ doing: "writing a reply", activity: { kind: "writing" } })
	c.close()
})

const row = (status: WorkerRow["status"], over: Partial<WorkerRow> = {}): WorkerRow => ({ id: "w1", task: "find the pricing pages", status, step: null, steps: 0, startedAt: 5, ...over })

test("workers show as a background activity, and each start and end is one private system line", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "setWorkers", "ada", [row("running")])
	const started = await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.event?.kind === "subagent"))
	const line = (started as Extract<RoomToClient, { t: "events" }>).events.find((e) => e.t === "message")
	expect(line).toMatchObject({ from: { kind: "system", reason: "work" }, text: "@ada started a worker: find the pricing pages", event: { kind: "subagent", agent: "ada", state: "started", private: true } })
	expect(await quiet(c)).toBe(0)

	await rpc(room, "setStatus", "ada", "working")
	const background = await c.take((f) => f.t === "status" && f.state === "working")
	expect(background).toMatchObject({ activity: { kind: "background", workers: [row("running")] } })
	expect((await snapshot(room)).agents).toEqual([{ slug: "ada", state: "working", activity: { kind: "background", workers: [row("running")] } }])

	await rpc(room, "setWorkers", "ada", [row("running")])
	expect(await quiet(c)).toBe(0)

	await rpc(room, "setWorkers", "ada", [row("done", { steps: 3 })])
	await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.event?.kind === "subagent" && e.event.state === "done"))
	const after = await c.take((f) => f.t === "status")
	expect(after).toEqual({ t: "status", slug: "ada", state: "working" })
	await rpc(room, "setWorkers", "ada", [row("done", { steps: 3 })])
	expect(await quiet(c)).toBe(0)
	c.close()
})

test("a reply to a private worker line is stored as a plain message", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "setWorkers", "ada", [row("running")])
	const frame = await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.event?.kind === "subagent"))
	const id = (frame as Extract<RoomToClient, { t: "events" }>).events.find((e): e is Extract<RoomEvent, { t: "message" }> => e.t === "message")!.id
	c.send({ t: "send", clientId: "c1", text: "how is it going?", replyTo: id })
	const stored = await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.from.kind === "human"))
	const human = (stored as Extract<RoomToClient, { t: "events" }>).events.find((e): e is Extract<RoomEvent, { t: "message" }> => e.t === "message")!
	expect(human.replyTo).toBeUndefined()
	c.close()
})

const events = (f: RoomToClient) => (f.t === "events" ? f.events : [])

test("a question is a message and a stored ask, an answer closes it and says what the human chose", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "askHuman", "ada", { id: "a1", question: "which colour?", options: ["red", "blue", "red", ""] })
	const asked = await c.take((f) => events(f).some((e) => e.t === "ask"))
	const [message, ask] = events(asked)
	expect(message).toMatchObject({ t: "message", from: { kind: "agent", slug: "ada" }, text: "which colour?" })
	expect(ask).toMatchObject({ t: "ask", id: "a1", from: "ada", text: "which colour?", options: ["red", "blue"] })
	const messageId = (message as Extract<RoomEvent, { t: "message" }>).id

	await rpc(room, "askHuman", "ada", { id: "a1", question: "which colour?" })
	expect(await quiet(c)).toBe(0)
	expect((await snapshot(room)).asks).toEqual([{ id: "a1", from: "ada", text: "which colour?", options: ["red", "blue"], messageId }])

	c.send({ t: "answer", id: "a1", value: "blue" })
	const closed = await c.take((f) => events(f).some((e) => e.t === "ask_resolved"))
	expect(events(closed)[0]).toMatchObject({ t: "ask_resolved", id: "a1", how: "answered" })
	const reply = await c.take((f) => events(f).some((e) => e.t === "message" && e.from.kind === "human"))
	expect(events(reply)[0]).toMatchObject({ t: "message", text: "blue", replyTo: messageId })
	expect(await rpc(room, "humanAskState", "a1")).toEqual({ state: "answered", answer: "blue" })
	expect((await snapshot(room)).asks).toEqual([])
	const agent = await fetch(`${origin}/agent/${room}/ada/answers`).then((r) => r.json())
	expect(agent).toEqual(["a1=blue"])

	c.send({ t: "answer", id: "a1", value: "red" })
	c.send({ t: "skip", id: "a1" })
	c.send({ t: "answer", id: "nope", value: "x" })
	expect(await quiet(c)).toBe(0)
	expect(await rpc(room, "humanAskState", "a1")).toEqual({ state: "answered", answer: "blue" })
	c.close()
})

test("an answer a waiting tool took is not delivered again, and a late one is", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await fetch(`${origin}/agent/${room}/ada/1`, { method: "POST" })
	await rpc(room, "askHuman", "ada", { id: "w", question: "now?" })
	await c.take((f) => events(f).some((e) => e.t === "ask"))
	c.send({ t: "answer", id: "w", value: "yes" })
	await c.take((f) => events(f).some((e) => e.t === "message" && e.from.kind === "human"))
	expect(await rpc(room, "pendingRows")).toBe(0)

	await fetch(`${origin}/agent/${room}/ada/0`, { method: "POST" })
	await rpc(room, "askHuman", "ada", { id: "l", question: "later?" })
	await c.take((f) => events(f).some((e) => e.t === "ask" && e.id === "l"))
	c.send({ t: "answer", id: "l", value: "ok" })
	await c.take((f) => events(f).some((e) => e.t === "message" && e.text === "ok"))
	expect(await rpc(room, "pendingRows")).toBe(1)
	c.close()
})

test("a skip closes the question, tells the agent, and posts nothing as the human", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "askHuman", "ada", { id: "s1", question: "color?" })
	await c.take((f) => events(f).some((e) => e.t === "ask"))
	c.send({ t: "skip", id: "s1" })
	const closed = await c.take((f) => events(f).some((e) => e.t === "ask_resolved"))
	expect(events(closed)[0]).toMatchObject({ id: "s1", how: "skipped" })
	expect(await quiet(c)).toBe(0)
	expect(await rpc(room, "humanAskState", "s1")).toEqual({ state: "skipped", answer: null })
	expect(await fetch(`${origin}/agent/${room}/ada/answers`).then((r) => r.json())).toEqual(["s1="])
	c.send({ t: "answer", id: "s1", value: "late" })
	expect(await quiet(c)).toBe(0)
	c.close()
})
