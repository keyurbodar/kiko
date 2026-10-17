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
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
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

let calls = 0
const doing = (room: string, text: string, activity: Activity) =>
	rpc(room, "reportSteps", "ada", [{ step: { id: `t${calls++}`, runId: "r1", tool: "other", name: "x", label: "x", status: "running", startedAt: 1 }, doing: text, activity }])

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
	await rpc(room, "setStatus", "ada", "working")
	await c.take((f) => f.t === "status" && f.state === "working")
	await doing(room, "reading /plan.md", read)
	const first = await c.take(statusOf(read))
	expect(first).toEqual({ t: "status", slug: "ada", state: "working", doing: "reading /plan.md", activity: read })

	await rpc(room, "setStatus", "ada", "typing")
	await c.take((f) => f.t === "status" && f.state === "typing" && f.activity?.kind === "tool")
	expect((await snapshot(room)).agents).toEqual([{ slug: "ada", state: "typing", doing: "reading /plan.md", activity: read }])

	const messaging: Activity = { kind: "tool", tool: "other", caption: "messaging @bob" }
	await doing(room, "messaging @bob", messaging)
	await c.take(statusOf(messaging))
	expect((await snapshot(room)).agents?.[0]?.activity).toEqual(messaging)

	await rpc(room, "setStatus", "ada", "idle")
	const idle = await c.take((f) => f.t === "status" && f.state === "idle")
	expect(idle).toEqual({ t: "status", slug: "ada", state: "idle" })
	expect((await snapshot(room)).agents).toEqual([])
	c.close()
})

test("an idle member that reports doing is never shown as working", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await doing(room, "reading /plan.md", { kind: "tool", tool: "read", caption: "reading /plan.md" })
	const frame = await c.take((f) => f.t === "status")
	expect(frame).toEqual({ t: "status", slug: "ada", state: "idle" })
	expect((await snapshot(room)).agents).toEqual([])
	c.close()
})

const touches = async (room: string) => (await (await fetch(`${origin}/touches/${room}`)).json()) as { lastPreview: string; unread: number; mentions?: number }[]

test("a bubble that lands mid-run updates the chat row at once, without waiting for the run to end", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "setStatus", "ada", "typing")
	await rpc(room, "post", "ada", "run-1", 0, 0, "first bubble")
	await rpc(room, "post", "ada", "run-1", 0, 1, "second bubble")
	let seen: Awaited<ReturnType<typeof touches>> = []
	for (let i = 0; i < 200 && !seen.some((t) => t.lastPreview === "second bubble"); i++) {
		await Bun.sleep(10)
		seen = await touches(room)
	}
	const last = seen.find((t) => t.lastPreview === "second bubble")
	expect(last).toMatchObject({ unread: 2 })
	expect(last?.mentions).toBeUndefined()
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

const typingCalls = async (room: string) => (await (await fetch(`${origin}/typing/${room}`)).json()) as string[][]

test("the sidebar hears typing only while an agent writes, and each clear arrives in order", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "setStatus", "ada", "typing")
	await rpc(room, "setStatus", "ada", "working")
	await rpc(room, "setStatus", "ada", "typing")
	await rpc(room, "endRun", "ada", "run-1", [], false)
	expect((await typingCalls(room)).slice(-4)).toEqual([["ada"], [], ["ada"], []])
	c.close()
})

test("a background worker is working, not typing, in the sidebar", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "setStatus", "ada", "working")
	expect((await typingCalls(room)).at(-1)).toEqual([])
	c.close()
})

test("a socket that connects mid-run is told who is busy", async () => {
	const room = fresh()
	const first = await withAgent(room)
	await rpc(room, "setStatus", "ada", "typing")
	await first.take((f) => f.t === "status" && f.state === "typing")
	first.close()
	const again = await open(room, 1_000_000)
	await again.take((f) => f.t === "typing" && f.who.includes("ada" as never))
	await again.take((f) => f.t === "status" && f.slug === "ada" && f.state === "typing")
	again.close()
})

const row = (status: WorkerRow["status"], over: Partial<WorkerRow> = {}): WorkerRow => ({ id: "w1", task: "find the pricing pages", status, step: null, steps: 0, startedAt: 5, ...over })

test("workers show as a background activity and add no rows to the chat", async () => {
	const room = fresh()
	const c = await withAgent(room)
	const joined = (await snapshot(room)).messages.map((m) => m.event)
	expect(joined).toEqual([{ kind: "member_added", slug: "ada", name: "ada", private: true }])
	await rpc(room, "setWorkers", "ada", [row("running")])
	await rpc(room, "setWorkers", "ada", [row("running", { steps: 1 })])
	expect((await snapshot(room)).messages.map((m) => m.event)).toEqual(joined)

	await rpc(room, "setStatus", "ada", "working")
	const background = await c.take((f) => f.t === "status" && f.state === "working")
	expect(background).toMatchObject({ activity: { kind: "background", workers: [row("running", { steps: 1 })] } })

	await rpc(room, "setWorkers", "ada", [row("done", { steps: 3 })])
	const after = await c.take((f) => f.t === "status")
	expect(after).toEqual({ t: "status", slug: "ada", state: "working" })
	await rpc(room, "setWorkers", "ada", [row("done", { steps: 4 })])
	expect((await snapshot(room)).messages.map((m) => m.event)).toEqual(joined)
	c.close()
})

test("a reply to a divider line is stored as a plain message", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "compacted", "ada", "1")
	const frame = await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.event?.kind === "compacted"))
	const line = (frame as Extract<RoomToClient, { t: "events" }>).events.find((e): e is Extract<RoomEvent, { t: "message" }> => e.t === "message")!
	expect(line).toMatchObject({ from: { kind: "system", reason: "divider" }, event: { kind: "compacted", agent: "ada", private: true } })
	c.send({ t: "send", clientId: "c1", text: "how is it going?", replyTo: line.id })
	const stored = await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "message" && e.from.kind === "human"))
	const human = (stored as Extract<RoomToClient, { t: "events" }>).events.find((e): e is Extract<RoomEvent, { t: "message" }> => e.t === "message")!
	expect(human.replyTo).toBeUndefined()
	c.close()
})

test("a routine and a repeated compaction each store one divider", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "routineCreated", "ada", "r1", "morning summary")
	await rpc(room, "routineCreated", "ada", "r1", "morning summary")
	await rpc(room, "routineCreated", "ada", "r2", "weekly review", true)
	await rpc(room, "compacted", "ada", "1")
	await rpc(room, "compacted", "ada", "1")
	await rpc(room, "compacted", "ada", "2")
	const kinds = (await snapshot(room)).messages.map((m) => m.event)
	expect(kinds).toEqual([
		{ kind: "member_added", slug: "ada", name: "ada", private: true },
		{ kind: "routine_created", agent: "ada", title: "morning summary", private: true },
		{ kind: "routine_created", agent: "ada", title: "weekly review", byAgent: true, private: true },
		{ kind: "compacted", agent: "ada", private: true },
		{ kind: "compacted", agent: "ada", private: true },
	])
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

test("a refused human task change is reported to its socket and leaves the board intact", async () => {
  const room = fresh()
  const c = await withAgent(room)
  c.send({ t: "task", op: { op: "create", id: "plan", title: "Compare places", owner: "ada" } })
  await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "task" && e.task.id === "plan"))
  c.send({ t: "task", op: { op: "update", id: "plan", owner: "unknown" } })
  const refused = await c.take((f) => f.t === "task_refused")
  expect(refused).toMatchObject({ t: "task_refused", op: { op: "update", id: "plan", owner: "unknown" } })
  expect((await snapshot(room)).tasks[0]?.owner).toBe("ada")
  c.close()
})

test("batched human questions persist choices, reject incomplete answers, and resolve once", async () => {
  const room = fresh()
  const c = await withAgent(room)
  const questions = [
    { id: "where", header: "Place", question: "Where?", options: [{ label: "Café", description: "A quiet place", value: "cafe" }] },
    { id: "food", header: "Food", question: "What should they serve?", multiSelect: true, allowCustomAnswer: false, options: [{ label: "Tea" }, { label: "Cake" }] },
  ]
  expect(await rpc(room, "askHuman", "ada", { id: "batch", questions })).toEqual({ ok: true })
  expect((await snapshot(room)).asks?.[0]?.questions).toEqual(questions)
  await rpc(room, "answerAsk", "batch", { where: "cafe" })
  expect((await snapshot(room)).asks).toHaveLength(1)
  await rpc(room, "answerAsk", "batch", { where: "cafe", food: ["missing"] })
  expect((await snapshot(room)).asks).toHaveLength(1)
  await rpc(room, "answerAsk", "batch", { where: "a park instead", food: ["Tea", "Cake"] })
  await rpc(room, "answerAsk", "batch", { where: "cafe", food: ["Cake"] })
  const saved = await snapshot(room)
  expect(saved.asks).toEqual([])
  expect(saved.messages.filter((m) => m.from.kind === "human").map((m) => m.text)).toEqual(["Place: a park instead\nFood: Tea, Cake"])
  expect(await rpc(room, "humanAskState", "batch")).toEqual({ state: "answered", answer: "Place: a park instead\nFood: Tea, Cake" })
  expect(await rpc(room, "askHuman", "ada", { id: "skip-batch", questions })).toEqual({ ok: true })
  await rpc(room, "skipAsk", "skip-batch")
  expect((await snapshot(room)).asks).toEqual([])
  expect(await rpc(room, "humanAskState", "skip-batch")).toEqual({ state: "skipped", answer: null })
  c.close()
})

type RunErrorLine = Extract<RoomEvent, { t: "message" }> & { event: { kind: "run_error"; slug: string; reason: string; actions: string[]; private: true } }
const runErrors = async (room: string) => (await snapshot(room)).messages.filter((m): m is RunErrorLine => (m.event as { kind?: string } | undefined)?.kind === "run_error") as unknown as RunErrorLine[]
const notices = async () => (await (await fetch(`${origin}/errors/x/x`)).json()) as { error: { code: string; message: string; action?: string }; roomId: string }[]

test("an agent that cannot run for want of a key leaves one line in the transcript for each request, and no raw frame", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "noProvider", "ada", "opencode-go", "inbox:r1", [], ["h1"])
	const line = await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "message" && (e.event as { kind?: string } | undefined)?.kind === "run_error"))
	expect(JSON.stringify(line)).toContain("OpenCode Go: not connected")
	await rpc(room, "noProvider", "ada", "opencode-go", "inbox:r1", [])
	expect(await runErrors(room)).toHaveLength(1)
	await rpc(room, "noProvider", "ada", "opencode-go", "inbox:r2", [])
	const [first, second] = await runErrors(room)
	expect(first!.event).toMatchObject({ slug: "ada", reason: "no_key", private: true })
	expect(first!.text).toBe("OpenCode Go: not connected")
	expect(second).toBeDefined()
	c.close()
})

test("a provider error becomes a fixed sentence with actions, never the provider's words, and a toast for another chat", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "runError", "ada", "run-1", { kind: "invalid_key", provider: "opencode-go", inputs: [] })
	const [line] = await runErrors(room)
	expect(line!.text).toBe("OpenCode Go: key or sign-in not accepted")
	expect(line!.event.actions).toEqual(["open_settings"])
	await rpc(room, "runError", "ada", "run-1", { kind: "invalid_key", provider: "opencode-go", inputs: [] })
	expect(await runErrors(room)).toHaveLength(1)
	const sent = (await notices()).filter((n) => n.error.message.endsWith(line!.text))
	expect(sent).toEqual([{ error: { code: "model", message: `ada could not answer. ${line!.text}`, action: "open_models" }, roomId: room }])
	c.close()
})

test("retry is offered only when the failed run answered a human message that is still there", async () => {
	const room = fresh()
	const c = await withAgent(room)
	c.send({ t: "send", clientId: "c1", text: "plan my trip" })
	const ack = (await c.take((f) => f.t === "ack")) as Extract<RoomToClient, { t: "ack" }>
	await rpc(room, "runError", "ada", "run-a", { kind: "timeout", provider: "opencode-go", inputs: [ack.id] })
	await rpc(room, "runError", "ada", "run-b", { kind: "timeout", provider: "opencode-go", inputs: [] })
	const [withInput, without] = await runErrors(room)
	expect(withInput!.event.actions).toEqual(["retry", "change_model"])
	expect(without!.event.actions).toEqual(["change_model"])
	c.close()
})

test("an error line is private to the owner: it is not unread, and a chat row never previews it", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "runError", "ada", "run-1", { kind: "overloaded", provider: "opencode-go", inputs: [] })
	await Bun.sleep(100)
	expect((await touches(room)).filter((t) => t.lastPreview.includes("overloaded"))).toEqual([])
	c.close()
})

test("a run that failed on a key, a sign-in or the credit tells the user object, and a limit does not", async () => {
	const room = fresh()
	const c = await withAgent(room)
	const problems = async () => (await (await fetch(`${origin}/problems/x/x`)).json()) as string[][]
	const before = (await problems()).length
	await rpc(room, "runError", "ada", "p-1", { kind: "invalid_key", provider: "opencode-go", inputs: [] })
	await rpc(room, "runError", "ada", "p-2", { kind: "quota", provider: "opencode-go", inputs: [] })
	await rpc(room, "runError", "ada", "p-3", { kind: "signed_out", provider: "anthropic", inputs: [] })
	await rpc(room, "runError", "ada", "p-4", { kind: "rate_limit", provider: "opencode-go", inputs: [] })
	await Bun.sleep(100)
	expect((await problems()).slice(before)).toEqual([["opencode-go", "invalid_key"], ["opencode-go", "quota"], ["anthropic", "signed_out"]])
	const lines = await runErrors(room)
	expect(lines.map((l) => l.event.reason)).toEqual(["invalid_key", "quota", "signed_out", "rate_limit"])
	expect(lines[2]).toMatchObject({ text: "Anthropic: sign-in expired", event: { provider: "anthropic", actions: ["open_settings"] } })
	c.close()
})

test("an agent whose sign-in expired, or whose provider could not be reached, says so instead of not connected", async () => {
	const room = fresh()
	const c = await withAgent(room)
	await rpc(room, "noProvider", "ada", "anthropic", "inbox:s1", [], ["h1"], "signed_out")
	await rpc(room, "noProvider", "ada", "anthropic", "inbox:s2", [], ["h1"], "network")
	const [expired, offline] = await runErrors(room)
	expect(expired!.event).toMatchObject({ reason: "signed_out", provider: "anthropic", actions: ["open_settings"] })
	expect(expired!.text).toBe("Anthropic: sign-in expired")
	expect(offline!.event.reason).toBe("network")
	expect(offline!.text).toBe("Anthropic: could not reach it")
	c.close()
})
