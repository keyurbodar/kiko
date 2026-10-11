import type { AgentSlug, Chat, Envelope, RoomEvent, RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import type { Env } from "../index"
import { INITIATIVE_RUN, REMINDER_RUN } from "../initiative/engine"
import { userStub } from "../lib/names"
import type { Burst } from "./burst"
import type { Mail } from "./mail"
import { BUDGET_LINE, nextReset, utcDay } from "./limits"
import type { MemberRow, Members } from "./members"
import type { RoomLog } from "./log"
import type { RoomRoutines } from "./routines"
import type { RoomWorkspace } from "./workspace"
import { wakeBody } from "./workspace"
import { type HeldWakes, HELD_PER_PASS, HELD_WAKEUP, type Wake, type WakeResult, wakeStamp } from "./wake"
import { type Deliveries, type ReminderDelivery, reminderChain } from "./deliver"

export const DELIVERY_RETRY_MS = 2_000
export const WAKES_WAKEUP = "ws_wakes"
const HUMAN_HERE_MS = 120_000

export type Home = { userId: string; roomId: RoomId }

export type WakeDeps = {
	env: Env
	log: RoomLog
	members: Members
	mail: Mail
	deliveries: Deliveries
	routines: RoomRoutines
	outbox: HeldWakes
	alarms: Alarms
	workspace: RoomWorkspace
	burst: Burst
	home: () => Home | null
	chat: (home: Home) => Promise<Chat | null>
	seedMembers: (home: Home, chat: Chat) => Promise<void>
	publish: (events: RoomEvent[]) => void
	deliver: (home: Home, member: MemberRow, members: readonly MemberRow[], chatTitle: string, envelope: Envelope) => Promise<{ refused: string | null | undefined; envelopes: Envelope[]; reactionsUpTo: number; deliveredTo: AgentSlug }>
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

	async deliverReminder(id: string, reminder: ReminderDelivery): Promise<WakeResult | "posted"> {
		const event = this.d.deliveries.reminder(id, reminder)
		if (event) this.d.publish([event])
		if (reminder.target === "human") return "posted"
		const own = `reminder:${id}`
		const run = { routineId: REMINDER_RUN, occurrence: id, slug: reminder.target as AgentSlug, seq: event?.seq ?? this.d.log.lastSeq() }
		if (!this.d.deliveries.seen(own)) this.d.routines.follow(run)
		const out = await this.wake({
			id: own,
			to: reminder.target as AgentSlug,
			why: "reminder",
			body: reminder.createdBy === reminder.target ? `reminder: ${reminder.text}\nyou set this to come back now. the time has come: do it and post the result here.` : `reminder: ${reminder.text}`,
			chain: reminderChain(own, reminder),
			budget: reminder.createdBy === "human" ? "user" : "room",
			retry: true,
			...(event ? { seq: event.seq } : {}),
		})
		if (out !== "delivered" && out !== "duplicate") this.d.routines.unfollow(run)
		return out
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
			out = await this.wake({ id, to: slug, why: "initiative", body: input.body, chain: null, budget: "room", retry: false })
		} catch (error) {
			this.d.routines.unfollow(run)
			throw error
		}
		if (out !== "delivered") this.d.routines.unfollow(run)
		return out
	}

	async deliverRoutine(deliveryId: string, input: { target: string; body: string; budget: Wake["budget"] }): Promise<WakeResult> {
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
			out = await this.wake({ id, to: slug, why: "routine", body: input.body, chain: { rootId: id, hop: 0, origin: "routine" }, budget: input.budget, retry: false, seq })
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
		if (this.d.outbox.has(w.id)) return "held"
		const out = await this.deliverWake(home, w)
		if (out === "held" && w.retry) {
			this.d.outbox.hold(w, Date.now())
			await this.d.alarms.setWakeup(HELD_WAKEUP, nextReset(Date.now()))
		}
		return out
	}

	private async deliverWake(home: Home, w: Wake): Promise<WakeResult> {
		const chat = await this.d.chat(home)
		if (!chat) return "gone"
		await this.d.seedMembers(home, chat)
		const members = this.d.members.list()
		const member = members.find((m) => m.slug === w.to)
		if (!member) return "gone"
		const now = Date.now()
		if (w.budget === "room" && this.d.mail.reserve(now, w.id) === "full") return this.budgetHeld(now, "this chat")
		if (w.budget !== "paid") {
			const user = await userStub(this.d.env.USER, home.userId).takeAutonomous(w.id)
			if (!user.ok) {
				this.d.mail.refund(w.id)
				return user.reason === "away" ? "held" : this.budgetHeld(now, "your account")
			}
		}
		const envelope: Envelope = { id: w.id, roomId: home.roomId, from: { kind: "system", reason: w.why }, body: w.body, seq: w.seq ?? this.d.log.lastSeq(), ...wakeStamp(w, (root) => this.d.mail.stopped(root)) }
		const { refused } = await this.d.deliver(home, member, members, chat.title, envelope)
		if (refused === "full") {
			this.d.mail.refund(w.id)
			if (w.budget !== "paid") await userStub(this.d.env.USER, home.userId).refundAutonomous(w.id)
			throw new Error(`${w.to}'s inbox is full`)
		}
		if (refused) {
			console.error(`${w.why} delivery to ${w.to} refused: ${refused}`)
			this.d.mail.refund(w.id)
			if (w.budget !== "paid") await userStub(this.d.env.USER, home.userId).refundAutonomous(w.id)
			this.d.deliveries.mark(w.id)
			return "refused"
		}
		this.d.deliveries.mark(w.id)
		return "delivered"
	}

	async retryHeld(): Promise<void> {
		const home = this.d.home()
		if (!home) return
		const due = this.d.outbox.due(Date.now())
		let stuck = false
		let failed = false
		for (const w of due) {
			if (this.d.deliveries.seen(w.id)) {
				this.d.outbox.drop(w.id)
				continue
			}
			const run = w.id.startsWith("reminder:") ? { routineId: REMINDER_RUN, occurrence: w.id.slice("reminder:".length), slug: w.to, seq: this.d.log.lastSeq() } : null
			if (run) this.d.routines.follow(run)
			let out: WakeResult
			try {
				out = await this.deliverWake(home, w)
			} catch (error) {
				if (run) this.d.routines.unfollow(run)
				console.error(`held wake not delivered, kept for a retry: ${w.id}: ${error instanceof Error ? error.message : String(error)}`)
				failed = true
				continue
			}
			if (run && out !== "delivered") this.d.routines.unfollow(run)
			if (out === "held") {
				stuck = true
				break
			}
			this.d.outbox.drop(w.id)
		}
		if (!this.d.outbox.any()) return await this.d.alarms.clearWakeup(HELD_WAKEUP)
		const now = Date.now()
		await this.d.alarms.setWakeup(HELD_WAKEUP, stuck ? nextReset(now) : failed ? now + DELIVERY_RETRY_MS : due.length < HELD_PER_PASS ? nextReset(now) : now + 1_000)
	}

	private budgetHeld(now: number, whose: string): "held" {
		const event = this.d.deliveries.notice(`budget:${utcDay(now)}`, BUDGET_LINE(whose))
		if (event) this.d.publish([event])
		return "held"
	}

	async deliverWakes(): Promise<void> {
		const home = this.d.home()
		const wakes = this.d.workspace.pendingWakes()
		if (!home || !wakes.length) return
		try {
			for (const wake of wakes) {
				await this.wake({ id: `unblocked:${wake.taskId}`, to: wake.owner, why: "task_unblocked", body: wakeBody(wake), chain: wake.chain, budget: "room", retry: true, seq: wake.seq })
				this.d.workspace.markWoken(wake.taskId)
			}
		} catch (error) {
			console.error(`task_unblocked delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			await this.d.alarms.setWakeup(WAKES_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
		}
	}
}
