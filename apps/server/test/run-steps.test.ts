import { expect, test } from "bun:test"
import type { RunStep } from "@kiko/protocol"
import { StepBatch } from "../src/agent/step-batch"
import { ROOM_STEPS } from "../src/room/schema"
import { HIGH_WATER, KEEP_STEPS, RunSteps } from "../src/room/steps"
import { sqlWith } from "./sql-shim"

const room = () => {
	const sql = sqlWith(ROOM_STEPS)
	return { sql, steps: new RunSteps({ sql } as unknown as DurableObjectStorage, () => 9_000) }
}

const rows = (sql: SqlStorage) => (sql.exec("SELECT count(*) AS n FROM run_steps").toArray()[0] as { n: number }).n

const step = (over: Partial<RunStep> = {}): RunStep => ({
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
const ended = (over: Partial<RunStep> = {}) => step({ status: "done", endedAt: 150, ...over })

test("a running step is held in memory and writes no row; its end writes exactly one", () => {
	const { sql, steps } = room()
	expect(steps.start(step())?.status).toBe("running")
	expect(steps.start(step())).toBeNull()
	expect(rows(sql)).toBe(0)
	expect(steps.of("r1").map((s) => s.status)).toEqual(["running"])
	expect(steps.finish(ended({ output: "hi" }))).toMatchObject({ status: "done", output: "hi", endedAt: 150 })
	expect(rows(sql)).toBe(1)
	expect(steps.of("r1").map((s) => s.status)).toEqual(["done"])
})

test("a replay writes nothing: a repeated end, a late start, and an end that conflicts", () => {
	const { sql, steps } = room()
	steps.finish(ended())
	const written = (sql.exec("SELECT count(*) AS n FROM run_steps").toArray()[0] as { n: number }).n
	expect(steps.finish(ended())).toBeNull()
	expect(steps.finish(ended({ status: "failed", output: "other" }))).toBeNull()
	expect(steps.start(step())).toBeNull()
	expect(steps.of("r1")).toHaveLength(1)
	expect(steps.of("r1")[0]?.output).toBeUndefined()
	expect(rows(sql)).toBe(written)
})

test("an end that arrives alone is stored whole, and a cut-off run's running steps fail", () => {
	const { steps } = room()
	expect(steps.finish(ended({ label: "Used x", worker: { id: "w1", task: "t" }, app: "gmail", input: "{}" }))).toMatchObject({ label: "Used x" })
	expect(steps.of("r1")[0]).toMatchObject({ worker: { id: "w1", task: "t" }, app: "gmail", input: "{}", name: "read" })
	steps.start(step({ id: "t2", startedAt: 120 }))
	steps.start(step({ id: "w2", startedAt: 130, worker: { id: "w1", task: "t" } }))
	expect(steps.abandon("r1")).toMatchObject([{ id: "t2", status: "failed", endedAt: 9_000 }])
	expect(steps.abandon("r1")).toEqual([])
	expect(steps.of("r1").map((s) => [s.id, s.status])).toEqual([["t1", "done"], ["t2", "failed"], ["w2", "running"]])
})

test("a bubble counts the steps its run had started when it was posted, running ones too, and live skips ended runs", () => {
	const { sql, steps } = room()
	steps.finish(ended())
	steps.start(step({ id: "t2", startedAt: 101 }))
	steps.finish(ended({ runId: "r2", startedAt: 102 }))
	const bubbles = [
		{ id: "m0", runId: "r1", at: 99 },
		{ id: "m1", runId: "r1", at: 100 },
		{ id: "m2", runId: "r1", at: 200 },
		{ id: "m3", runId: "r2", at: 200 },
		{ id: "m4", runId: "r3", at: 200 },
	]
	expect(Object.fromEntries(steps.before(bubbles))).toEqual({ m1: 1, m2: 2, m3: 1 })
	expect(steps.live().map((s) => [s.runId, s.status])).toEqual([["r1", "done"], ["r1", "running"], ["r2", "done"]])
	sql.exec("INSERT INTO ended_runs (run_id, at) VALUES (?, ?)", "r1", 1)
	expect(steps.live().filter((s) => s.status === "done").map((s) => s.runId)).toEqual(["r2"])
})

test("storage is cut down in one statement only past the high-water mark", () => {
	const { sql, steps } = room()
	for (let i = 0; i < HIGH_WATER; i++) steps.finish(ended({ runId: "r9", id: `n${i}`, startedAt: 1_000 + i }))
	expect(rows(sql)).toBe(HIGH_WATER)
	steps.finish(ended({ runId: "r9", id: "last", startedAt: 99_999 }))
	expect(rows(sql)).toBe(KEEP_STEPS)
	expect(steps.of("r9").at(-1)?.id).toBe("last")
	expect(steps.of("r9")[0]?.id).toBe(`n${HIGH_WATER - KEEP_STEPS + 1}`)
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
