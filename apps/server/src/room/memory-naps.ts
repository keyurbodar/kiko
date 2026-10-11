import type { AgentSlug, RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import type { RoomLog } from "./log"
import type { Members } from "./members"
import type { RoomMemory } from "./memory"

export const MEMORY_WAKEUP = "memory_naps"
export const QUIET_WAKEUP = "memory_quiet"
const QUIET_MS = 6 * 3_600_000
const NAPS_PER_PASS = 24
const NAPS_AT_ONCE = 4

type Home = { userId: string; roomId: RoomId }

export type MemoryNapsDeps = {
	ctx: DurableObjectState
	env: Env
	alarms: Alarms
	log: RoomLog
	members: Members
	memory: RoomMemory
	home: () => Home | null
	isWiped: () => Promise<boolean>
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
		if (this.d.log.meta("private") !== "1") await this.d.alarms.setWakeup(QUIET_WAKEUP, Date.now() + QUIET_MS)
	}

	async forget(): Promise<void> {
		const home = this.d.home()
		if (!home || (await this.d.isWiped())) return
		const changes = this.d.memory.changes()
		if (!changes) return
		const user = userStub(this.d.env.USER, home.userId)
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
		const user = userStub(this.d.env.USER, home.userId)
		const rollup = this.d.log.meta("private") === "1" ? null : (text: string, at: number, span: { lo: number; hi: number }) => user.lifeRollup(home.roomId, text, at, span)
		const pass = async () => {
			for (let done = 0; done < NAPS_PER_PASS; done += NAPS_AT_ONCE) {
				if (this.d.members.list().some((m) => m.status !== "idle")) return void (await this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 30_000))
				const spans = this.d.memory.pending(NAPS_AT_ONCE)
				if (!spans.length) return void (await (this.d.memory.changes() ? this.d.alarms.setWakeup(MEMORY_WAKEUP, Date.now() + 30_000) : this.d.alarms.clearWakeup(MEMORY_WAKEUP)))
				const outs = await Promise.all(spans.map((span) => this.d.memory.nap(span, (prompt, page) => user.compress(prompt, rollup && page ? { roomId: home.roomId, at: page.at, span: page.span } : undefined), rollup)))
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

	async rollupQuiet(): Promise<void> {
		const home = this.d.home()
		if (!home || this.d.log.meta("private") === "1") return
		const user = userStub(this.d.env.USER, home.userId)
		const out = await this.d.memory.rollupQuiet((prompt, page) => user.compress(prompt, page ? { roomId: home.roomId, at: page.at, span: page.span } : undefined), (text, at, span) => user.lifeRollup(home.roomId, text, at, span))
		if (out.retryAt) await this.d.alarms.setWakeup(QUIET_WAKEUP, out.retryAt)
	}
}
