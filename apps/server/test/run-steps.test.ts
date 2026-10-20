import { ownerRoomFixture } from "./owner-room-fixture"
import { expect, test } from "bun:test"
import type { AgentSlug, RunStep } from "@kiko/protocol"
import { RoomLog } from "../src/room/log"
import { type HeardStep, HIGH_WATER, KEEP_STEPS, RunSteps } from "../src/room/steps"

const room = () => {
	const { sql, owner, roomId } = ownerRoomFixture()
	return { sql, steps: new RunSteps(owner, roomId, () => 9_000) }
}

const rows = (sql: SqlStorage) => (sql.exec("SELECT count(*) AS n FROM run_steps").toArray()[0] as { n: number }).n

const step = (over: Partial<HeardStep> = {}): HeardStep => ({
	id: "t1",
	runId: "r1",
	slug: "kiko" as RunStep["slug"],
	tool: "read",
	name: "read",
	label: "Read /a",
	status: "running",
	startedAt: 100,
	...over,
})
const ended = (over: Partial<HeardStep> = {}) => step({ status: "done", endedAt: 150, ...over })
const all = (steps: RunSteps) => steps.window("kiko", 0)

test("a running step is held in memory and writes no row; its end writes exactly one, in the window it began in", () => {
	const { sql, steps } = room()
	expect(steps.start(step(), 0)).toMatchObject({ status: "running", after: 0 })
	expect(steps.start(step(), 6)).toBeNull()
	expect(rows(sql)).toBe(0)
	expect(all(steps).map((s) => s.status)).toEqual(["running"])
	expect(steps.finish(ended({ output: "hi" }), 9)).toMatchObject({ step: { status: "done", output: "hi", endedAt: 150, after: 0 }, fresh: false })
	expect(rows(sql)).toBe(1)
	expect(all(steps).map((s) => [s.status, s.after])).toEqual([["done", 0]])
})

test("a replay writes nothing: a repeated end, a late start, and an end that conflicts", () => {
	const { sql, steps } = room()
	expect(steps.finish(ended(), 0)?.fresh).toBe(true)
	const written = rows(sql)
	expect(steps.finish(ended(), 0)).toBeNull()
	expect(steps.finish(ended({ status: "failed", output: "other" }), 0)).toBeNull()
	expect(steps.start(step(), 0)).toBeNull()
	expect(all(steps)).toHaveLength(1)
	expect(all(steps)[0]?.output).toBeUndefined()
	expect(rows(sql)).toBe(written)
})

test("an end that arrives alone is stored whole, and a cut-off run's running steps fail", () => {
	const { steps } = room()
	expect(steps.finish(ended({ label: "Used x", worker: { id: "w1", task: "t" }, app: "gmail", input: "{}" }), 0)?.step).toMatchObject({ label: "Used x" })
	expect(all(steps)[0]).toMatchObject({ worker: { id: "w1", task: "t" }, app: "gmail", input: "{}", name: "read" })
	steps.start(step({ id: "t2", startedAt: 120 }), 0)
	steps.start(step({ id: "w2", startedAt: 130, worker: { id: "w1", task: "t" } }), 0)
	expect(steps.abandon("r1")).toMatchObject([{ id: "t2", status: "failed", endedAt: 9_000 }])
	expect(steps.abandon("r1")).toEqual([])
	expect(all(steps).map((s) => [s.id, s.status])).toEqual([["t1", "done"], ["t2", "failed"], ["w2", "running"]])
})

test("a window holds one agent's steps after one of its messages, stored and running", () => {
	const { steps } = room()
	steps.finish(ended({ id: "a" }), 0)
	steps.finish(ended({ id: "b", startedAt: 101 }), 5)
	steps.start(step({ id: "c", startedAt: 102 }), 5)
	steps.finish(ended({ id: "x", slug: "ada" as RunStep["slug"] }), 5)
	expect(steps.window("kiko", 0).map((s) => s.id)).toEqual(["a"])
	expect(steps.window("kiko", 5).map((s) => s.id)).toEqual(["b", "c"])
	expect([steps.count("kiko", 0), steps.count("kiko", 5), steps.count("kiko", 8), steps.count("ada", 5)]).toEqual([1, 2, 0, 1])
	expect(steps.tails(new Map([["kiko", 5], ["ada", 0]])).map((s) => s.id)).toEqual(["b", "c"])
})

test("storage is cut down in one statement only past the high-water mark", () => {
	const { sql, steps } = room()
	for (let i = 0; i < HIGH_WATER; i++) steps.finish(ended({ runId: "r9", id: `n${i}`, startedAt: 1_000 + i }), 0)
	expect(rows(sql)).toBe(HIGH_WATER)
	steps.finish(ended({ runId: "r9", id: "last", startedAt: 99_999 }), 0)
	expect(rows(sql)).toBe(KEEP_STEPS)
	expect(all(steps).at(-1)?.id).toBe("last")
	expect(all(steps)[0]?.id).toBe(`n${HIGH_WATER - KEEP_STEPS + 1}`)
})

const log = () => {
	const { sql, log } = ownerRoomFixture({ now: () => 9_000 })
	for (const slug of ["kiko", "ada"]) sql.exec("INSERT INTO members (room_id, slug, name, role, model, lead, status, added_seq) VALUES ('test-room', ?, ?, '', '', 0, 'idle', 1)", slug, slug)
	return log
}
const kiko = { kind: "agent", slug: "kiko" as AgentSlug } as const
const ada = { kind: "agent", slug: "ada" as AgentSlug } as const

test("each message opens its agent's steps since that agent's previous message, kept as posted", () => {
	const room = log()
	room.addMessage({ from: { kind: "human" }, text: "go" })
	room.hearStep(step({ id: "a" }))
	room.hearStep(ended({ id: "a" }))
	room.hearStep(ended({ id: "x", slug: "ada" as AgentSlug }))
	const first = room.addMessage({ from: kiko, text: "one" })
	// A worker's step comes after the run's bubble: it waits for the agent's next message.
	room.hearStep(ended({ id: "w", runId: "r1", startedAt: 101, worker: { id: "w1", task: "t" } }))
	room.hearStep(step({ id: "b", runId: "r2", startedAt: 102 }))
	const quiet = room.addMessage({ from: ada, text: "ada" })
	// Mail to a teammate is read behind a divider: the steps wait for the message to the human.
	const mail = room.addMessage({ from: kiko, text: "@ada go", to: "ada" as AgentSlug })
	const second = room.addMessage({ from: kiko, text: "two" })
	const third = room.addMessage({ from: kiko, text: "three" })
	const shown = (id: string) => {
		const m = room.message(id)
		return [m?.steps, m?.stepAfter]
	}
	expect([shown(first.id), shown(quiet.id), shown(mail.id), shown(second.id), shown(third.id)]).toEqual([[1, 0], [1, 0], [undefined, undefined], [2, first.seq], [undefined, undefined]])
	expect(room.steps.window("kiko", first.seq).map((s) => s.id)).toEqual(["w", "b"])
	expect(room.snapshot().steps).toBeUndefined()
	room.hearStep(ended({ id: "b", runId: "r2" }))
	room.hearStep(step({ id: "c", runId: "r2" }))
	expect(room.snapshot().steps?.map((s) => s.id)).toEqual(["c"])
})

test("a window read after a wake counts what was heard before it, once", () => {
	const { owner, storage, roomId, log: before } = ownerRoomFixture({ now: () => 9_000 })
	before.addMessage({ from: kiko, text: "zero" })
	before.hearStep(ended({ id: "a" }))
	const woken = new RoomLog(owner, roomId, () => 9_000, storage)
	woken.hearStep(ended({ id: "b" }))
	woken.hearStep(ended({ id: "b" }))
	const next = woken.addMessage({ from: kiko, text: "one" })
	expect(woken.message(next.id)?.steps).toBe(2)
})


test("rooms sharing owner storage keep messages, replay ids, steps and search separate", () => {
	const first = ownerRoomFixture({ roomId: "first", now: () => 9_000 })
	const second = ownerRoomFixture({ db: first.db, roomId: "second", now: () => 9_000 })
	const run = { runId: "shared-run", attempt: 0, index: 0 }
	const one = first.log.addMessage({ from: kiko, text: "first zebra", run })
	const two = second.log.addMessage({ from: kiko, text: "second zebra", run })
	expect(one.seq).toBe(two.seq)
	expect(first.log.snapshot().messages.map((m) => m.text)).toEqual(["first zebra"])
	expect(second.log.snapshot().messages.map((m) => m.text)).toEqual(["second zebra"])
	first.log.hearStep(ended({ output: "first output" }))
	second.log.hearStep(ended({ output: "second output" }))
	expect(first.log.steps.window("kiko", one.seq)[0]?.output).toBe("first output")
	expect(second.log.steps.window("kiko", two.seq)[0]?.output).toBe("second output")
	first.log.deleteMessages([one.id], { kind: "human" })
	expect(first.search("zebra").results).toEqual([])
	expect(second.search("zebra").results.map((hit) => hit.id)).toEqual([two.id])
})
