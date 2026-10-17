import type { AgentSlug, RunStep, ToolKind } from "@kiko/protocol"

/** Architecture section 9.5. The newest steps a room keeps, and how often a write checks for older ones. */
export const KEEP_STEPS = 2_000
const PRUNE_EVERY = 100
/** A snapshot carries the steps of runs still going, at most this many, none older than a day. */
const LIVE_LIMIT = 300
const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000
const COUNT = "steps_written"

type Row = {
	run_id: string
	id: string
	slug: string
	tool: string
	label: string
	input: string | null
	status: string
	started_at: number
	ended_at: number | null
	output: string | null
}

const toStep = (r: Row): RunStep => ({
	id: r.id,
	runId: r.run_id,
	slug: r.slug as AgentSlug,
	tool: r.tool as ToolKind,
	label: r.label,
	...(r.input !== null ? { input: r.input } : {}),
	status: r.status as RunStep["status"],
	startedAt: r.started_at,
	...(r.ended_at !== null ? { endedAt: r.ended_at } : {}),
	...(r.output !== null ? { output: r.output } : {}),
})

const COLUMNS = "run_id, id, slug, tool, label, input, status, started_at, ended_at, output"

/** How many steps each run has made, one query for the whole batch. */
export function stepCounts(sql: SqlStorage, runIds: readonly string[]): Map<string, number> {
	const out = new Map<string, number>()
	if (!runIds.length) return out
	for (const r of sql
		.exec<{ run_id: string; n: number }>(
			"SELECT run_id, count(*) AS n FROM run_steps WHERE run_id IN (SELECT value FROM json_each(?)) GROUP BY run_id",
			JSON.stringify(runIds),
		)
		.toArray())
		out.set(r.run_id, r.n)
	return out
}

/** The steps of runs that have not ended, oldest first. */
export function liveSteps(sql: SqlStorage, now: number): RunStep[] {
	return sql
		.exec<Row>(
			`SELECT ${COLUMNS} FROM (
				SELECT ${COLUMNS} FROM run_steps
				WHERE started_at > ? AND run_id NOT IN (SELECT run_id FROM ended_runs)
				ORDER BY started_at DESC LIMIT ?
			) ORDER BY started_at, id`,
			now - LIVE_WINDOW_MS,
			LIVE_LIMIT,
		)
		.toArray()
		.map(toStep)
}

/** The tool calls of runs, as the human sees them. */
export class RunSteps {
	private readonly sql: SqlStorage

	constructor(
		storage: DurableObjectStorage,
		private readonly now: () => number = Date.now,
	) {
		this.sql = storage.sql
	}

	private one(runId: string, id: string): RunStep | null {
		const row = this.sql.exec<Row>(`SELECT ${COLUMNS} FROM run_steps WHERE run_id = ? AND id = ?`, runId, id).toArray()[0]
		return row ? toStep(row) : null
	}

	/**
	 * Stores a step and returns it as stored when that changed anything, else null. Safe to run twice:
	 * a step that has ended never goes back to running, and an end keeps the label the start gave.
	 */
	record(step: RunStep): RunStep | null {
		const before = this.one(step.runId, step.id)
		this.sql.exec(
			`INSERT INTO run_steps (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (run_id, id) DO UPDATE SET status = excluded.status, ended_at = excluded.ended_at, output = excluded.output
			 WHERE run_steps.status = 'running' AND excluded.status != 'running'`,
			step.runId,
			step.id,
			step.slug,
			step.tool,
			step.label,
			step.input ?? null,
			step.status,
			step.startedAt,
			step.endedAt ?? null,
			step.output ?? null,
		)
		const after = this.one(step.runId, step.id)
		if (!after || JSON.stringify(after) === JSON.stringify(before)) return null
		if (!before) this.prune()
		return after
	}

	private prune(): void {
		const written =
			Number(this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", COUNT).toArray()[0]?.value ?? 0) + 1
		this.sql.exec(
			"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			COUNT,
			String(written),
		)
		if (written % PRUNE_EVERY !== 0) return
		this.sql.exec(
			"DELETE FROM run_steps WHERE started_at < (SELECT started_at FROM run_steps ORDER BY started_at DESC LIMIT 1 OFFSET ?)",
			KEEP_STEPS - 1,
		)
	}

	/** Steps still running when their run ends were cut off. Marks them failed and returns them. */
	abandon(runId: string): RunStep[] {
		return this.sql
			.exec<Row>(
				`UPDATE run_steps SET status = 'failed', ended_at = ? WHERE run_id = ? AND status = 'running' RETURNING ${COLUMNS}`,
				this.now(),
				runId,
			)
			.toArray()
			.map(toStep)
	}

	of(runId: string): RunStep[] {
		return this.sql
			.exec<Row>(`SELECT ${COLUMNS} FROM run_steps WHERE run_id = ? ORDER BY started_at, id`, runId)
			.toArray()
			.map(toStep)
	}
}
