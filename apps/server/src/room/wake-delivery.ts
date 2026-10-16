import type { AgentSlug, Chat, Envelope, RoomEvent, } from "@kiko/protocol"
import type { Alarms } from "@kiko/durable/alarm"
import type { Env } from "../index"
import { INITIATIVE_RUN } from "../initiative/engine"
import type { Burst } from "./burst"
import type { Mail } from "./mail"
import type { Members } from "./members"
import type { RoomLog } from "./log"
import type { RoomRoutines } from "./routines"
import type { RoomWorkspace } from "./workspace"
import { wakeBody } from "./workspace"
import { type Wake, type WakeResult, wakeStamp } from "./wake"
import { receive, type ReceiveDeps } from "./receive"
import type { Home } from "./home"
import type { Deliveries } from "./deliver"

export const DELIVERY_RETRY_MS = 2_000
export const WAKES_WAKEUP = "ws_wakes"
const HUMAN_HERE_MS = 120_000

export type WakeDeps = {
	env: Env
	log: RoomLog
	members: Members
	mail: Mail
	deliveries: Deliveries
	routines: RoomRoutines
	alarms: Alarms
	workspace: RoomWorkspace
	burst: Burst
	home: () => Home | null
	chat: (home: Home) => Promise<Chat | null>
	seedMembers: (home: Home, chat: Chat) => Promise<void>
	publish: (events: RoomEvent[]) => void
	receiver: ReceiveDeps
}

export class RoomWakes {
	private humanTypingAt = 0

	constructor(private readonly d: WakeDeps) {}

	humanTyped(): void {
		this.humanTypingAt = Date.now()
	}

	humanHere(now: number): boolean {
		return this.d.burst.pending() || now - this.humanTypingAt < HUMAN_HERE_MS
	}

	async initiativeWake(input: { id: string; to: AgentSlug | null; body: string; reason: string }): Promise<WakeResult | "busy"> {
		const home = this.d.home()
		if (!home) return "refused"
		const id = `initiative:${input.id}`
		if (this.d.deliveries.seen(id)) return "duplicate"
		if (this.humanHere(Date.now())) return "busy"
		const chat = await this.d.chat(home)
		if (!chat) return "gone"
		await this.d.seedMembers(home, chat)
		const members = this.d.members.list()
		const slug = input.to && members.some((m) => m.slug === input.to) ? input.to : (members.find((m) => m.lead) ?? members[0])?.slug
		if (!slug) return "gone"
		const run = { routineId: INITIATIVE_RUN, occurrence: input.id, slug, seq: this.d.log.lastSeq() }
		this.d.routines.follow(run)
		this.d.log.setMeta(`initiative:${id}`, input.reason)
		let out: WakeResult
		try {
			out = await this.wake({ id, to: slug, why: "initiative", body: input.body, chain: null })
		} catch (error) {
			this.d.routines.unfollow(run)
			throw error
		}
		if (out !== "delivered") this.d.routines.unfollow(run)
		return out
	}

	async deliverRoutine(deliveryId: string, input: { target: string; body: string }): Promise<WakeResult> {
		const id = `routine:${deliveryId}`
		if (!this.d.home()) return "refused"
		if (this.d.deliveries.seen(id)) return "duplicate"
		const slug = input.target as AgentSlug
		const seq = this.d.log.lastSeq()
		const cut = deliveryId.indexOf(":")
		const run = { routineId: deliveryId.slice(0, cut), occurrence: deliveryId.slice(cut + 1), slug, seq }
		this.d.routines.follow(run)
		let out: WakeResult
		try {
			out = await this.wake({ id, to: slug, why: "routine", body: input.body, chain: { rootId: id, hop: 0 }, seq })
		} catch (error) {
			this.d.routines.unfollow(run)
			throw error
		}
		if (out !== "delivered") this.d.routines.unfollow(run)
		return out
	}

	async wake(w: Wake): Promise<WakeResult> {
		const home = this.d.home()
		if (!home) return "refused"
		if (this.d.deliveries.seen(w.id)) return "duplicate"
		const chat = await this.d.chat(home)
		if (!chat) return "gone"
		await this.d.seedMembers(home, chat)
		const members = this.d.members.list()
		const member = members.find((m) => m.slug === w.to)
		if (!member) return "gone"
		const envelope: Envelope = { id: w.id, roomId: home.roomId, from: { kind: "system", reason: w.why }, body: w.body, seq: w.seq ?? this.d.log.lastSeq(), ...wakeStamp(w, (root) => this.d.mail.stopped(root)) }
		const receipt = await receive(this.d.receiver, home, member, members, chat.title, [envelope])
		if (receipt === "full") throw new Error(`${w.to}'s inbox is full`)
		this.d.deliveries.mark(w.id)
		return receipt === "admitted" ? "delivered" : "refused"
	}

	async deliverWakes(): Promise<void> {
		const home = this.d.home()
		const wakes = this.d.workspace.pendingWakes()
		const reports = this.d.workspace.pendingReports()
		if (!home || (!wakes.length && !reports.length)) return
		try {
			for (const report of reports) {
				await this.wake({ id: `task-report:${report.seq}`, to: report.recipient, why: "task_updated", body: report.body, chain: report.chain, seq: report.seq })
				this.d.workspace.markReported(report.seq)
			}
			for (const wake of wakes.slice(0, 8 - reports.length)) {
				await this.wake({ id: `unblocked:${wake.taskId}`, to: wake.owner, why: "task_unblocked", body: wakeBody(wake), chain: wake.chain, seq: wake.seq })
				this.d.workspace.markWoken(wake.taskId)
			}
			if (this.d.workspace.pendingReports().length || this.d.workspace.pendingWakes().length) await this.d.alarms.setWakeup(WAKES_WAKEUP, Date.now())
		} catch (error) {
			console.error(`task delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.d.alarms.setWakeup(WAKES_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
		}
	}
}
