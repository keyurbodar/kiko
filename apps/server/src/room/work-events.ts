import { oneLine } from "@kiko/protocol"
import type { AgentSlug, WorkerRow } from "@kiko/protocol"
import type { NewMessage } from "./log"

const TITLE_CHARS = 100

const VERB = {
	started: "started a worker",
	done: "finished a worker",
	failed: "had a worker fail",
	stopped: "stopped a worker",
} as const

export function workerMessages(slug: AgentSlug, before: readonly WorkerRow[], after: readonly WorkerRow[]): NewMessage[] {
	const known = new Map(before.map((w) => [w.id, w]))
	return after.flatMap((w): NewMessage[] => {
		const was = known.get(w.id)
		const state = was ? (was.status === w.status || w.status === "running" ? null : w.status) : w.status === "running" ? "started" : null
		if (!state) return []
		const title = oneLine(w.task, TITLE_CHARS)
		return [
			{
				from: { kind: "system", reason: "work" },
				text: `@${slug} ${VERB[state]}: ${title}`,
				clientId: `work:${slug}:${w.id}:${w.startedAt}:${state}`,
				event: { kind: "subagent", agent: slug, state, title, private: true },
			},
		]
	})
}
