import type { AgentSlug, RunStep, RunStepStatus, ToolKind } from "@kiko/protocol"

/** Architecture section 9.5. A room keeps the newest KEEP_STEPS finished steps. It deletes down to that only when the count passes HIGH_WATER. */
export const KEEP_STEPS = 2_000
export const HIGH_WATER = 2_200
/** A snapshot carries the finished steps of runs still going, at most this many, none older than a day. */
const LIVE_LIMIT = 300
const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000

type Row = {
	run_id: string
	id: string
	slug: string
	tool: string
	name: string
	app: string | null
	worker: string | null
	label: string
	input: string | null
	status: string
	started_at: number
	ended_at: number
	output: string | null
}

const COLUMNS = "run_id, id, slug, tool, name, app, worker, label, input, status, started_at, ended_at, output"

const toStep = (r: Row): RunStep => ({
	id: r.id,
	runId: r.run_id,
	slug: r.slug as AgentSlug,
	tool: r.tool as ToolKind,
	name: r.name,
	...(r.app !== null ? { app: r.app } : {}),
	...(r.worker !== null ? { worker: JSON.parse(r.worker) as NonNullable<RunStep["worker"]> } : {}),
	label: r.label,
	...(r.input !== null ? { input: r.input } : {}),
	status: r.status as RunStepStatus,
	startedAt: r.started_at,
	endedAt: r.ended_at,
	...(r.output !== null ? { output: r.output } : {}),
})

const keyOf = (runId: string, id: string) => `${runId}\u0000${id}`

/**
 * The tool calls of runs, as the human sees them. A running step lives in memory only and is sent
 * on the wire. A step is written once, when it ends: one row, and a replay writes nothing.
 */
export class RunSteps {
	private readonly sql: SqlStorage
	private readonly running = new Map<string, RunStep>()
	private stored: number | null = null

	constructor(
		storage: DurableObjectStorage,
		private readonly now: () => number = Date.now,
	) {
		this.sql = storage.sql
	}

	private isStored(runId: string, id: string): boolean {
		return this.sql.exec("SELECT 1 FROM run_steps WHERE run_id = ? AND id = ?", runId, id).toArray().length > 0
	}

	/** A step began. Returns it when the panel should hear of it: not a repeat, and not a step that already ended. */
	start(step: RunStep): RunStep | null {
		const key = keyOf(step.runId, step.id)
		if (this.running.has(key) || this.isStored(step.runId, step.id)) return null
		this.running.set(key, step)
		return step
	}

	/** A step ended. Returns it when this write stored it, null when it was stored before. Needs the whole step: the room may have lost the start. */
	finish(step: RunStep): RunStep | null {
		this.running.delete(keyOf(step.runId, step.id))
		const cursor = this.sql.exec(
			`INSERT INTO run_steps (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, id) DO NOTHING`,
			step.runId,
			step.id,
			step.slug,
			step.tool,
			step.name,
			step.app ?? null,
			step.worker ? JSON.stringify(step.worker) : null,
			step.label,
			step.input ?? null,
			step.status,
			step.startedAt,
			step.endedAt ?? this.now(),
			step.output ?? null,
		)
		cursor.toArray()
		if (cursor.rowsWritten === 0) return null
		this.prune()
		return { ...step, endedAt: step.endedAt ?? this.now() }
	}

	private prune(): void {
		this.stored = this.stored === null ? this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM run_steps").one().n : this.stored + 1
		if (this.stored <= HIGH_WATER) return
		this.sql.exec(
			"DELETE FROM run_steps WHERE (started_at, run_id, id) <= (SELECT started_at, run_id, id FROM run_steps ORDER BY started_at DESC, run_id DESC, id DESC LIMIT 1 OFFSET ?)",
			KEEP_STEPS,
		)
		this.stored = KEEP_STEPS
	}

	/** The talker's steps still running when their run ends were cut off. Marks them failed, stores them, and returns them. A worker's steps outlive the run. */
	abandon(runId: string): RunStep[] {
		const cut = [...this.running.values()].filter((s) => s.runId === runId && !s.worker)
		return cut.flatMap((s) => this.finish({ ...s, status: "failed", endedAt: this.now() }) ?? [])
	}

	private finished(where: string, ...args: unknown[]): RunStep[] {
		return this.sql
			.exec<Row>(`SELECT ${COLUMNS} FROM run_steps WHERE ${where}`, ...args)
			.toArray()
			.map(toStep)
	}

	/** Every step of a run, oldest first. */
	of(runId: string): RunStep[] {
		const own = [...this.running.values()].filter((s) => s.runId === runId)
		return [...this.finished("run_id = ?", runId), ...own].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1))
	}

	/** The steps of runs that have not ended, oldest first: those running now, and those finished. */
	live(): RunStep[] {
		const done = this.finished(
			"started_at > ? AND run_id NOT IN (SELECT run_id FROM ended_runs) ORDER BY started_at DESC LIMIT ?",
			this.now() - LIVE_WINDOW_MS,
			LIVE_LIMIT,
		)
		return [...done, ...this.running.values()].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1))
	}

	/** How many steps each run has made, finished and running, from one query for the whole batch. */
	counts(runIds: readonly string[]): Map<string, number> {
		const out = new Map<string, number>()
		if (!runIds.length) return out
		for (const r of this.sql
			.exec<{ run_id: string; n: number }>(
				"SELECT run_id, count(*) AS n FROM run_steps WHERE run_id IN (SELECT value FROM json_each(?)) GROUP BY run_id",
				JSON.stringify(runIds),
			)
			.toArray())
			out.set(r.run_id, r.n)
		for (const s of this.running.values()) if (runIds.includes(s.runId)) out.set(s.runId, (out.get(s.runId) ?? 0) + 1)
		return out
	}
}
