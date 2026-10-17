import type { AgentSlug, RunStep, RunStepStatus, ToolKind } from "@kiko/protocol"

/** Architecture section 9.5. A room keeps the newest KEEP_STEPS finished steps. It deletes down to that only when the count passes HIGH_WATER. */
export const KEEP_STEPS = 2_000
export const HIGH_WATER = 2_200
/** A snapshot carries at most this many steps after the agents' last messages, none older than a day. */
const TAIL_LIMIT = 300
const TAIL_WINDOW_MS = 24 * 60 * 60 * 1000

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
	pos: number
}

const COLUMNS = "run_id, id, slug, tool, name, app, worker, label, input, status, started_at, ended_at, output, pos"

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
	pos: r.pos,
})

const keyOf = (runId: string, id: string) => `${runId}\u0000${id}`

const byStart = (a: RunStep, b: RunStep) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1)

/** What a report says of a step: all of it but where the room heard it. */
export type HeardStep = Omit<RunStep, "pos">

/**
 * The tool calls of agents, as the human sees them. A running step lives in memory only and is sent
 * on the wire. A step is written once, when it ends: one row, and a replay writes nothing.
 * Each step is stamped with the room's last seq when it is first heard, so it belongs to the agent's next message.
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

	/** A step began, heard at `pos`. Returns it when it is new: not a repeat, and not a step that already ended. */
	start(heard: HeardStep, pos: number): RunStep | null {
		const key = keyOf(heard.runId, heard.id)
		if (this.running.has(key) || this.isStored(heard.runId, heard.id)) return null
		const step = { ...heard, pos }
		this.running.set(key, step)
		return step
	}

	/**
	 * A step ended. Returns it when this write stored it, null when it was stored before. Needs the whole step:
	 * the room may have lost the start. `fresh` is true when the room had not heard of the step before.
	 */
	finish(heard: HeardStep, pos: number): { step: RunStep; fresh: boolean } | null {
		const key = keyOf(heard.runId, heard.id)
		const began = this.running.get(key)
		this.running.delete(key)
		const step: RunStep = { ...heard, endedAt: heard.endedAt ?? this.now(), pos: began?.pos ?? pos }
		const cursor = this.sql.exec(
			`INSERT INTO run_steps (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, id) DO NOTHING`,
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
			step.endedAt,
			step.output ?? null,
			step.pos,
		)
		cursor.toArray()
		if (cursor.rowsWritten === 0) return null
		this.prune()
		return { step, fresh: !began }
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
		return cut.flatMap((s) => this.finish({ ...s, status: "failed", endedAt: this.now() }, s.pos)?.step ?? [])
	}

	/** One agent's steps heard from `after` up to, not including, `upTo`, oldest first. Reads the whole table: no index costs a write per step. */
	window(slug: string, after: number, upTo = Number.MAX_SAFE_INTEGER): RunStep[] {
		const done = this.sql
			.exec<Row>(`SELECT ${COLUMNS} FROM run_steps WHERE slug = ? AND pos >= ? AND pos < ?`, slug, after, upTo)
			.toArray()
			.map(toStep)
		const own = [...this.running.values()].filter((s) => s.slug === slug && s.pos >= after && s.pos < upTo)
		return [...done, ...own].sort(byStart)
	}

	/** How many steps one agent made from `after` on that the room has heard of: stored, and running now. */
	count(slug: string, after: number): number {
		const done = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM run_steps WHERE slug = ? AND pos >= ?", slug, after).one().n
		return done + [...this.running.values()].filter((s) => s.slug === slug && s.pos >= after).length
	}

	/** Each agent's steps from its `after` on: the steps no message opens yet. At most TAIL_LIMIT, the newest, none older than a day. */
	tails(after: ReadonlyMap<string, number>): RunStep[] {
		if (!after.size) return []
		const from = Math.min(...after.values())
		const since = this.now() - TAIL_WINDOW_MS
		const done = this.sql
			.exec<Row>(`SELECT ${COLUMNS} FROM run_steps WHERE pos >= ? AND started_at > ? ORDER BY started_at DESC LIMIT ?`, from, since, TAIL_LIMIT)
			.toArray()
			.map(toStep)
		return [...done, ...this.running.values()].filter((s) => s.pos >= (after.get(s.slug) ?? Number.MAX_SAFE_INTEGER)).sort(byStart)
	}
}
