import type { OwnerServices } from "../owner/services"
import type { AgentSlug, } from "@kiko/protocol"
import type { Alarms } from "@kiko/durable/alarm"
import type { Env } from "../index"
import type { RoomLog } from "./log"
import type { Members } from "./members"
import type { RoomMemory } from "./memory"
import type { Home } from "./home"

export const MEMORY_WAKEUP = "memory_naps"
const NAPS_PER_PASS = 24
const NAPS_AT_ONCE = 4


export type MemoryNapsDeps = {
	ctx: DurableObjectState
	env: Env
 services: OwnerServices
	alarms: Alarms
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

	async arm(): Promise<void> {
		if (this.d.memory.pending(1).length) await this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 2_000)
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
			await this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 30_000)
		}
	}

	async naps(): Promise<void> {
		const home = this.d.home()
		if (!home || this.#napping) return
		this.#napping = true
		await this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 120_000)
		await this.forget()
		const user = this.d.services.user()
		const pass = async () => {
			for (let done = 0; done < NAPS_PER_PASS; done += NAPS_AT_ONCE) {
				if (this.d.members.list().some((m) => m.status !== "idle")) return void (await this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 30_000))
				const spans = this.d.memory.pending(NAPS_AT_ONCE)
				if (!spans.length) return void (await (this.d.memory.changes() ? this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 30_000) : this.d.alarms.clearWakeup(MEMORY_WAKEUP)))
				const outs = await Promise.all(spans.map((span) => this.d.memory.nap(span, (prompt) => user.compress(prompt))))
				const retryAt = outs.find((o) => o.retryAt)?.retryAt
				if (retryAt) return void (await this.d.alarms.setWakeup(MEMORY_WAKEUP, retryAt))
			}
			await this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 1_000)
		}
		this.d.ctx.waitUntil(
			pass()
				.catch(async (error: unknown) => {
					console.error(`memory summary failed: ${error instanceof Error ? error.message : String(error)}`)
					await this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 60_000)
				})
				.finally(() => {
					this.#napping = false
				}),
		)
	}
}
