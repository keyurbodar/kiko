import type { AgentSlug, Envelope, SystemReason } from "@kiko/protocol"
import type { Chain } from "./messaging"

export type Wake = {
	id: string
	to: AgentSlug
	why: SystemReason
	body: string
	chain: Chain | null
	seq?: number
}

export type WakeResult = "delivered" | "refused" | "gone" | "duplicate"

function wakeStamp(w: Pick<Wake, "id" | "chain">, stopped: (rootId: string) => boolean): Pick<Envelope, "rootId" | "hop"> {
	const chain = w.chain
	if (!chain || stopped(chain.rootId)) return { rootId: w.id, hop: 0 }
	return { rootId: chain.rootId, hop: chain.hop }
}

import type { OwnerServices } from "../owner/services"
import type { Chat } from "@kiko/protocol"
import type { Members } from "./members"
import type { RoomLog } from "./log"
import type { RoomRoutines } from "./routines"
import { INITIATIVE_RUN } from "../initiative/engine"
import { receive, type ReceiveDeps } from "./receive"
import type { Home } from "./home"
import type { RoomWorkspace } from "./workspace"
import { wakeBody } from "./workspace"
import type { Burst } from "./burst"

export class RoomDelivery {
	private humanTypingAt = 0
	constructor(
		private readonly d: {
			services: OwnerServices
			log: RoomLog
			members: Members
			routines: RoomRoutines
			workspace: RoomWorkspace
			burst: Burst
			home: () => Home | null
			chat: (home: Home) => Promise<Chat | null>
			seedMembers: (home: Home, chat: Chat) => Promise<void>
			receiver: ReceiveDeps
		},
	) {}
	humanTyped(): void {
		this.humanTypingAt = Date.now()
	}
	async initiativeWake(input: { id: string; to: AgentSlug | null; body: string; reason: string }): Promise<WakeResult | "busy"> {
		if (this.d.burst.pending() || Date.now() - this.humanTypingAt < 120000) return "busy"
		const home = this.d.home()
		const chat = home ? await this.d.chat(home) : null
		if (!home || !chat) return "gone"
		await this.d.seedMembers(home, chat)
		const members = this.d.members.list()
		const slug = members.find((m) => m.slug === input.to)?.slug ?? members.find((m) => m.lead)?.slug ?? members[0]?.slug
		if (!slug) return "gone"
		const run = { routineId: INITIATIVE_RUN, occurrence: input.id, slug, seq: this.d.log.lastSeq() }
		this.d.log.setMeta(`initiative:initiative:${input.id}`, input.reason)
		this.d.routines.follow(run)
		const result = await this.wake({ id: `initiative:${input.id}`, to: slug, why: "initiative", body: input.body, chain: null })
		if (result !== "delivered") this.d.routines.unfollow(run)
		return result
	}
	async deliverRoutine(deliveryId: string, input: { target: string; body: string }): Promise<WakeResult> {
		const cut = deliveryId.indexOf(":")
		const slug = input.target as AgentSlug
		const run = { routineId: deliveryId.slice(0, cut), occurrence: deliveryId.slice(cut + 1), slug, seq: this.d.log.lastSeq() }
		this.d.routines.follow(run)
		const result = await this.wake({ id: `routine:${deliveryId}`, to: slug, why: "routine", body: input.body, chain: { rootId: `routine:${deliveryId}`, hop: 0 } })
		if (result !== "delivered") this.d.routines.unfollow(run)
		return result
	}
	async wake(w: Wake): Promise<WakeResult> {
		const home = this.d.home()
		if (!home) return "refused"
		const chat = await this.d.chat(home)
		if (!chat) return "gone"
		await this.d.seedMembers(home, chat)
		const members = this.d.members.list()
		const member = members.find((m) => m.slug === w.to)
		if (!member) return "gone"
		const envelope: Envelope = {
			id: w.id,
			roomId: home.roomId,
			from: { kind: "system", reason: w.why },
			body: w.body,
			seq: w.seq ?? this.d.log.lastSeq(),
			...wakeStamp(w, (root) => this.d.receiver.mail.stopped(root)),
		}
		return (await receive(this.d.receiver, home, member, members, chat.title, [envelope])) === "admitted" ? "delivered" : "refused"
	}
	async deliverWakes(): Promise<void> {
		for (const report of this.d.workspace.pendingReports()) {
			await this.wake({ id: `task-report:${report.seq}`, to: report.recipient, why: "task_updated", body: report.body, chain: report.chain, seq: report.seq })
			this.d.workspace.markReported(report.seq)
		}
		for (const wake of this.d.workspace.pendingWakes()) {
			await this.wake({ id: `unblocked:${wake.taskId}`, to: wake.owner, why: "task_unblocked", body: wakeBody(wake), chain: wake.chain, seq: wake.seq })
			this.d.workspace.markWoken(wake.taskId)
		}
	}
}
