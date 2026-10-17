import type { Alarms } from "@kiko/durable/alarm"
import type { AgentSlug } from "@kiko/protocol"

export const START_WAKEUP = "start-check"
/** How long an idle agent may take to start on a delivered message before the human is told. */
export const START_WITHIN_MS = 60_000

const PREFIX = "start-check:"

type Pending = { due: number; inputs: readonly string[] }

/**
 * Notices an agent that was idle when a message reached it and never started on it, so the human is
 * not left waiting on a chat where nothing happens. Armed before the delivery, so a run that starts
 * at once always clears it. One check per agent: a later delivery replaces it.
 */
export class StartCheck {
	constructor(
		private readonly d: {
			sql: SqlStorage
			alarms: Alarms
			idle: (slug: AgentSlug) => boolean
			/** `key` is stable for one check, so an alarm delivered twice reports once. */
			report: (slug: AgentSlug, inputs: readonly string[], key: string) => void
		},
	) {}

	async arm(slug: AgentSlug, inputs: readonly string[], now = Date.now()): Promise<void> {
		this.d.sql.exec(
			"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			PREFIX + slug,
			JSON.stringify({ due: now + START_WITHIN_MS, inputs } satisfies Pending),
		)
		await this.schedule()
	}

	/** The agent started, or the room already told the human why it cannot. */
	started(slug: AgentSlug): void {
		this.d.sql.exec("DELETE FROM meta WHERE key = ?", PREFIX + slug)
	}

	async due(now = Date.now()): Promise<void> {
		for (const [slug, check] of this.pending()) {
			if (check.due > now) continue
			this.started(slug)
			// A busy agent did start; its own guards end a run that hangs.
			if (this.d.idle(slug)) this.d.report(slug, check.inputs, `not-started:${slug}:${check.due}`)
		}
		await this.schedule()
	}

	private pending(): [AgentSlug, Pending][] {
		return this.d.sql
			.exec<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key LIKE ?", `${PREFIX}%`)
			.toArray()
			.map((row) => [row.key.slice(PREFIX.length) as AgentSlug, JSON.parse(row.value) as Pending])
	}

	private async schedule(): Promise<void> {
		const next = Math.min(...this.pending().map(([, check]) => check.due))
		if (Number.isFinite(next)) await this.d.alarms.setWakeup(START_WAKEUP, next)
		else await this.d.alarms.clearWakeup(START_WAKEUP)
	}
}
