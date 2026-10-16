import type { AgentSlug, RoomEvent, Sender } from "@kiko/protocol"
import { openTasks } from "./open-tasks"
import type { Members } from "./members"
import type { RoomLog } from "./log"
import type { PendingUploads } from "./pending"
import type { RoomMemory } from "./memory"

type DevDeps = {
	sql: SqlStorage
	log: RoomLog
	members: Members
	memory: RoomMemory
	pending: PendingUploads
	publish: (events: RoomEvent[]) => void
	armMemory: () => Promise<void>
	tasksChanged: () => Promise<void>
	sweepPending: () => Promise<number>
}

// The bodies never reach a production bundle: dev-guard loads this module only in a dev build.
export class RoomDev {
	constructor(private readonly d: DevDeps) {}

	async seed(turns: { from: string; text: string }[]): Promise<number> {
		const call = crypto.randomUUID()
		for (const [i, t] of turns.entries()) {
			const from: Sender = t.from === "human" ? { kind: "human" } : { kind: "agent", slug: t.from as AgentSlug }
			this.d.log.addMessage({ from, text: t.text, ...(from.kind === "agent" ? { run: { runId: `seed:${call}:${i}`, attempt: 0, index: 0 } } : {}) })
		}
		const count = this.d.memory.sync()
		await this.d.armMemory()
		return count
	}

	async memory(): Promise<{ turns: number; pending: number; view: string }> {
		const view = this.d.memory.view(Date.now())
		const pending = this.d.memory.pending(1_000).length
		if (pending) await this.d.armMemory()
		return { turns: this.d.memory.count(), pending, view }
	}

	async age(ms: number): Promise<number> {
		this.d.sql.exec("UPDATE ws_tasks SET updated_at = updated_at - ? WHERE status NOT IN ('done', 'cancelled')", ms)
		await this.d.tasksChanged()
		return openTasks(this.d.sql).length
	}

	async agePending(ms: number): Promise<number> {
		this.d.pending.age(ms)
		await this.d.sweepPending()
		return this.d.pending.count()
	}
}
