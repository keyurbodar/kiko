import { expect, test } from "bun:test"
import type { AgentSlug, RunStep } from "@kiko/protocol"
import { StepBatch } from "../src/agent/step-batch"
import { ROOM_STEPS } from "../src/room/schema"
import { RoomLog } from "../src/room/log"
import { type HeardStep, HIGH_WATER, KEEP_STEPS, RunSteps } from "../src/room/steps"
import { sqlWith } from "./sql-shim"

const room = () => {
	const sql = sqlWith(ROOM_STEPS)
	return { sql, steps: new RunSteps({ sql } as unknown as DurableObjectStorage, () => 9_000) }
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

test("a running step is held in memory and writes no row; its end writes exactly one, where it was first heard", () => {
	const { sql, steps } = room()
	expect(steps.start(step(), 4)).toMatchObject({ status: "running", pos: 4 })
	expect(steps.start(step(), 6)).toBeNull()
	expect(rows(sql)).toBe(0)
	expect(all(steps).map((s) => s.status)).toEqual(["running"])
	expect(steps.finish(ended({ output: "hi" }), 9)).toMatchObject({ step: { status: "done", output: "hi", endedAt: 150, pos: 4 }, fresh: false })
	expect(rows(sql)).toBe(1)
	expect(all(steps).map((s) => [s.status, s.pos])).toEqual([["done", 4]])
})

test("a replay writes nothing: a repeated end, a late start, and an end that conflicts", () => {
	const { sql, steps } = room()
	expect(steps.finish(ended(), 2)?.fresh).toBe(true)
	const written = rows(sql)
	expect(steps.finish(ended(), 3)).toBeNull()
	expect(steps.finish(ended({ status: "failed", output: "other" }), 3)).toBeNull()
	expect(steps.start(step(), 3)).toBeNull()
	expect(all(steps)).toHaveLength(1)
	expect(all(steps)[0]?.output).toBeUndefined()
	expect(rows(sql)).toBe(written)
})

test("an end that arrives alone is stored whole, and a cut-off run's running steps fail", () => {
	const { steps } = room()
	expect(steps.finish(ended({ label: "Used x", worker: { id: "w1", task: "t" }, app: "gmail", input: "{}" }), 1)?.step).toMatchObject({ label: "Used x" })
	expect(all(steps)[0]).toMatchObject({ worker: { id: "w1", task: "t" }, app: "gmail", input: "{}", name: "read" })
	steps.start(step({ id: "t2", startedAt: 120 }), 1)
	steps.start(step({ id: "w2", startedAt: 130, worker: { id: "w1", task: "t" } }), 1)
	expect(steps.abandon("r1")).toMatchObject([{ id: "t2", status: "failed", endedAt: 9_000 }])
	expect(steps.abandon("r1")).toEqual([])
	expect(all(steps).map((s) => [s.id, s.status])).toEqual([["t1", "done"], ["t2", "failed"], ["w2", "running"]])
})

test("a window holds one agent's steps from its start up to its end, stored and running", () => {
	const { steps } = room()
	steps.finish(ended({ id: "a" }), 2)
	steps.finish(ended({ id: "b", startedAt: 101 }), 5)
	steps.start(step({ id: "c", startedAt: 102 }), 7)
	steps.finish(ended({ id: "x", slug: "ada" as RunStep["slug"] }), 5)
	expect(steps.window("kiko", 0, 5).map((s) => s.id)).toEqual(["a"])
	expect(steps.window("kiko", 5).map((s) => s.id)).toEqual(["b", "c"])
	expect([steps.count("kiko", 0), steps.count("kiko", 5), steps.count("kiko", 8), steps.count("ada", 0)]).toEqual([3, 2, 0, 1])
	expect(steps.tails(new Map([["kiko", 7], ["ada", 0]])).map((s) => s.id)).toEqual(["x", "c"])
})

test("storage is cut down in one statement only past the high-water mark", () => {
	const { sql, steps } = room()
	for (let i = 0; i < HIGH_WATER; i++) steps.finish(ended({ runId: "r9", id: `n${i}`, startedAt: 1_000 + i }), 1)
	expect(rows(sql)).toBe(HIGH_WATER)
	steps.finish(ended({ runId: "r9", id: "last", startedAt: 99_999 }), 1)
	expect(rows(sql)).toBe(KEEP_STEPS)
	expect(all(steps).at(-1)?.id).toBe("last")
	expect(all(steps)[0]?.id).toBe(`n${HIGH_WATER - KEEP_STEPS + 1}`)
})

const log = () => {
	const sql = sqlWith(ROOM_STEPS)
	for (const slug of ["kiko", "ada"]) sql.exec("INSERT INTO members (slug, name, role, model, lead, status, added_seq) VALUES (?, ?, '', '', 0, 'idle', 1)", slug, slug)
	return new RoomLog({ sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage, () => 9_000)
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
	const second = room.addMessage({ from: kiko, text: "two" })
	const third = room.addMessage({ from: kiko, text: "three" })
	const shown = (id: string) => {
		const m = room.message(id)
		return [m?.steps, m?.stepAfter]
	}
	expect([shown(first.id), shown(quiet.id), shown(second.id), shown(third.id)]).toEqual([[1, 0], [1, 0], [2, first.seq], [undefined, undefined]])
	expect(room.steps.window("kiko", first.seq, second.seq).map((s) => s.id)).toEqual(["w", "b"])
	expect(room.snapshot().steps).toBeUndefined()
	room.hearStep(ended({ id: "b", runId: "r2" }))
	room.hearStep(step({ id: "c", runId: "r2" }))
	expect(room.snapshot().steps?.map((s) => s.id)).toEqual(["c"])
})

test("a window read after a wake counts what was heard before it, once", () => {
	const sql = sqlWith(ROOM_STEPS)
	const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
	const before = new RoomLog(storage, () => 9_000)
	before.addMessage({ from: kiko, text: "zero" })
	before.hearStep(ended({ id: "a" }))
	const woken = new RoomLog(storage, () => 9_000)
	woken.hearStep(ended({ id: "b" }))
	woken.hearStep(ended({ id: "b" }))
	const next = woken.addMessage({ from: kiko, text: "one" })
	expect(woken.message(next.id)?.steps).toBe(2)
})

test("parallel reports go out as one request, in order, and nothing waits on a timer", async () => {
	const sent: number[][] = []
	let release: () => void = () => {}
	const batch = new StepBatch<number>((items) => {
		sent.push([...items])
		return new Promise<void>((resolve) => (release = resolve))
	})
	batch.push(1)
	batch.push(2)
	batch.push(3)
	await Promise.resolve()
	expect(sent).toEqual([[1, 2, 3]])
	batch.push(4)
	batch.push(5)
	release()
	await new Promise((r) => setTimeout(r, 0))
	expect(sent).toEqual([[1, 2, 3], [4, 5]])
	release()
})
