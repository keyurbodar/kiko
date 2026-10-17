import { expect, test } from "bun:test"
import type { RunStep } from "@kiko/protocol"
import { Outbox, type RoomPort } from "../src/agent/outbox"
import { AGENT_STEPS } from "../src/agent/schema"
import { ROOM_STEPS } from "../src/room/schema"
import { KEEP_STEPS, liveSteps, RunSteps, stepCounts } from "../src/room/steps"
import { sqlWith } from "./sql-shim"

const room = () => {
	const sql = sqlWith(ROOM_STEPS)
	return { sql, steps: new RunSteps({ sql } as unknown as DurableObjectStorage, () => 9_000) }
}

const step = (over: Partial<RunStep> = {}): RunStep => ({
	id: "t1",
	runId: "r1",
	slug: "kiko" as RunStep["slug"],
	tool: "read",
	label: "Read /a",
	status: "running",
	startedAt: 100,
	...over,
})

test("a step runs, then ends; a replayed start never undoes the end; an end keeps the start's label", () => {
	const { steps } = room()
	expect(steps.record(step())?.status).toBe("running")
	expect(steps.record(step())).toBeNull()
	expect(steps.record(step({ status: "done", endedAt: 150, output: "hi" }))).toMatchObject({ status: "done", endedAt: 150, output: "hi", label: "Read /a" })
	expect(steps.record(step())).toBeNull()
	expect(steps.record(step({ status: "failed", endedAt: 999 }))).toBeNull()
	expect(steps.of("r1")).toHaveLength(1)
	expect(steps.record(step({ id: "t2", label: "Used x", status: "failed", startedAt: 200, endedAt: 210 }))?.label).toBe("Used x")
	expect(steps.record(step({ id: "t2", label: "Other", status: "done", startedAt: 300, endedAt: 400 }))).toBeNull()
	expect(steps.of("r1").map((s) => [s.id, s.status])).toEqual([["t1", "done"], ["t2", "failed"]])
})

test("an end that arrives alone is stored, and a cut-off run's running steps fail", () => {
	const { steps } = room()
	expect(steps.record(step({ status: "done", endedAt: 150 }))?.status).toBe("done")
	steps.record(step({ id: "t2", startedAt: 120 }))
	expect(steps.abandon("r1")).toMatchObject([{ id: "t2", status: "failed", endedAt: 9_000 }])
	expect(steps.abandon("r1")).toEqual([])
})

test("counts come in one query, live steps skip ended runs, and storage stays bounded", () => {
	const { sql, steps } = room()
	steps.record(step())
	steps.record(step({ id: "t2", startedAt: 101 }))
	steps.record(step({ runId: "r2", startedAt: 102 }))
	expect(Object.fromEntries(stepCounts(sql, ["r1", "r2", "r3"]))).toEqual({ r1: 2, r2: 1 })
	expect(liveSteps(sql, 200).map((s) => s.runId)).toEqual(["r1", "r1", "r2"])
	sql.exec("INSERT INTO ended_runs (run_id, at) VALUES (?, ?)", "r1", 1)
	expect(liveSteps(sql, 200).map((s) => s.runId)).toEqual(["r2"])
	for (let i = 0; i < KEEP_STEPS + 300; i++) steps.record(step({ runId: "r9", id: `n${i}`, startedAt: 1_000 + i }))
	const left = (sql.exec("SELECT count(*) AS n FROM run_steps").toArray()[0] as { n: number }).n
	expect(left).toBeLessThanOrEqual(KEEP_STEPS + 100)
	expect(left).toBeGreaterThanOrEqual(KEEP_STEPS)
	expect(steps.of("r9").at(-1)?.id).toBe(`n${KEEP_STEPS + 299}`)
})

test("the outbox reports a tool call when it starts and when it ends, and skips internal tools", async () => {
	const seen: Omit<RunStep, "slug">[] = []
	const port = {
		post: async () => {},
		status: async () => {},
		draft: async () => {},
		workers: async () => {},
		endRun: async () => {},
		react: async () => {},
		runError: async () => {},
		step: async (s: Omit<RunStep, "slug">) => void seen.push(s),
	} satisfies RoomPort
	let now = 1_000
	const outbox = new Outbox({ sql: sqlWith(AGENT_STEPS) } as unknown as DurableObjectStorage, () => port, () => "run", () => now)
	const inner = outbox as unknown as { start(id: string, cursor: number): Promise<void>; apply(e: unknown): Promise<void> }
	await inner.start("run-1", 0)
	await inner.apply({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "bun test" } })
	now = 2_000
	await inner.apply({
		type: "tool_execution_end",
		toolCallId: "c1",
		toolName: "bash",
		entry: { id: 5, kind: "pi.tool", model: [{ role: "toolResult", isError: true, content: [{ type: "text", text: "boom" }] }] },
	})
	await inner.apply({ type: "tool_execution_start", toolCallId: "c2", toolName: "send_message", args: { to: "human", text: "hi" } })
	await inner.apply({ type: "tool_execution_end", toolCallId: "c2", toolName: "send_message" })
	expect(seen).toEqual([
		{ id: "c1", runId: "run-1", tool: "run", label: "Ran bun test", input: "bun test", status: "running", startedAt: 1_000 },
		{ id: "c1", runId: "run-1", tool: "run", label: "Ran bun test", input: "bun test", status: "failed", startedAt: 1_000, endedAt: 2_000, output: "boom" },
	])
})
