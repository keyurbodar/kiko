import type { OwnerServices } from "../owner/services"
import type { AgentSlug } from "@kiko/protocol"
import type { RoomLog } from "./log"
import type { Members } from "./members"
import type { RoomMemory } from "./memory"
import type { Home } from "./home"

const NAPS_PER_PASS = 24
const NAPS_AT_ONCE = 4

export type MemoryNapsDeps = {
	services: OwnerServices
	log: RoomLog
	members: Members
	memory: RoomMemory
	home: () => Home | null
}

export class MemoryNaps {
	#napping = false

	constructor(private readonly d: MemoryNapsDeps) {}

	view(seqs: number[]): { text: string; count: number } {
		return { text: this.d.memory.view(Date.now(), new Set(seqs)), count: this.d.memory.count() }
	}

	since(slug: AgentSlug, pos: number, seqs: number[]) {
		return this.d.memory.since(slug, pos, Date.now(), new Set(seqs))
	}

	recall(query: string, seen?: number, skip: number[] = []): string[] {
		return this.d.memory.recall(query.slice(0, 200), Date.now(), 10, seen, new Set(skip))
	}

	zoom(id: string): string | null {
		return this.d.memory.zoom(id, Date.now())
	}

	async forget(): Promise<void> {
		const home = this.d.home()
		if (!home) return
		const changes = this.d.memory.changes()
		if (!changes) return
		const user = this.d.services.user()
		try {
			await user.forgetMessages(home.roomId, changes.deleted, this.d.log.meta("private") === "1" ? [] : changes.edited, changes.positions)
			this.d.memory.forwarded(changes.upto)
		} catch (error) {
			console.error(`forget failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	async naps(): Promise<void> {
		if (!this.d.home() || this.#napping) return
		this.#napping = true
		try {
			await this.forget()
			const user = this.d.services.user()
			for (let done = 0; done < NAPS_PER_PASS; done += NAPS_AT_ONCE) {
				if (this.d.members.list().some((m) => m.status !== "idle")) return
				const spans = this.d.memory.pending(NAPS_AT_ONCE)
				if (!spans.length) return
				const outs = await Promise.all(spans.map((span) => this.d.memory.nap(span, (prompt) => user.compress(prompt))))
				if (outs.some((o) => o.retryAt)) return
			}
		} finally {
			this.#napping = false
		}
	}
}
