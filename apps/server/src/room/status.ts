import type { Activity, AgentSlug, AgentState, AgentStatus, WorkerRow } from "@kiko/protocol"

export const workersKey = (slug: AgentSlug) => `workers:${slug}`

type Row = { slug: string; status: string; doing: string | null; activity: string | null; workers: string | null }

export function activityOf(state: AgentState, stored: Activity | null, workers: readonly WorkerRow[]): Activity | undefined {
	if (state === "idle") return undefined
	if (stored) return stored
	const running = workers.filter((w) => w.status === "running")
	if (state === "working" && running.length) return { kind: "background", workers: running }
	return state === "typing" ? { kind: "writing" } : undefined
}

export function statusOf(sql: SqlStorage, slug: AgentSlug): AgentStatus | null {
	const row = sql
		.exec<Row>(
			`SELECT m.slug, m.status, t.doing, t.activity, (SELECT value FROM meta WHERE key = 'workers:' || m.slug) AS workers
			 FROM members m LEFT JOIN team_doing t ON t.slug = m.slug WHERE m.slug = ? AND m.removed_at IS NULL`,
			slug,
		)
		.toArray()[0]
	return row ? toStatus(row) : null
}

export function agentStatuses(sql: SqlStorage): AgentStatus[] {
	const exists = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'team_doing'").toArray().length > 0
	if (!exists) return []
	return sql
		.exec<Row>(
			`SELECT m.slug, m.status, t.doing, t.activity, (SELECT value FROM meta WHERE key = 'workers:' || m.slug) AS workers
			 FROM members m LEFT JOIN team_doing t ON t.slug = m.slug WHERE m.removed_at IS NULL AND m.status != 'idle' ORDER BY m.lead DESC, m.added_seq, m.slug`,
		)
		.toArray()
		.map(toStatus)
}

function toStatus(row: Row): AgentStatus {
	const state = row.status as AgentState
	const activity = activityOf(state, row.activity ? (JSON.parse(row.activity) as Activity) : null, row.workers ? (JSON.parse(row.workers) as WorkerRow[]) : [])
	return {
		slug: row.slug as AgentSlug,
		state,
		...(state !== "idle" && row.doing ? { doing: row.doing } : {}),
		...(activity ? { activity } : {}),
	}
}
