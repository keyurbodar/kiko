import { seedArchiveHistory } from "../owner/history-dev"
import type { HistoryArchive } from "../owner/history-archive"
import type { AgentSlug, RoomEvent, Sender } from "@kiko/protocol"
import type { Members } from "./members"
import type { RoomLog } from "./log"
import type { PendingUploads } from "./pending"
import type { RoomMemory } from "./memory"

type DevDeps = {
  storage: DurableObjectStorage
  archive: () => HistoryArchive | undefined
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

  async archive() {
    const history = this.d.archive()
    if (!history) throw new Error("Archive binding is required")
    await seedArchiveHistory(this.d.storage, this.d.log.roomId, history, Date.now())
    return { hotMessages: this.d.log.snapshot().messages.length, search: await history.search("kumquat"), history: await history.around(Number.MAX_SAFE_INTEGER, 300, 0) }
  }

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
		return this.d.sql.exec<{n:number}>("SELECT count(*) AS n FROM ws_tasks WHERE status NOT IN ('done','cancelled')").one().n
	}

	async agePending(ms: number): Promise<number> {
		this.d.pending.age(ms)
		await this.d.sweepPending()
		return this.d.pending.count()
	}
}
