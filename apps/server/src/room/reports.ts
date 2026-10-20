import type { AgentSlug, RoomEvent } from "@kiko/protocol"
import type { ClockPort as Alarms } from "@kiko/durable/clock-port"
import type { OwnerServices } from "../owner/services"
import type { Inflight, RoomRoutines } from "./routines"
import { matches, type Signal, signalOf } from "./routine-events"
import type { RoomLog } from "./log"
import type { Members } from "./members"
import type { MessageChains } from "./messaging"
import type { Home } from "./home"

export type ReportsDeps = {
	ctx: DurableObjectState
	services: OwnerServices
	alarms: Alarms
	log: RoomLog
	members: Members
	mail: MessageChains
	routines: RoomRoutines
	home: () => Home | null
}

export class Reports {
	constructor(private readonly d: ReportsDeps) {}

	gather(events: readonly RoomEvent[]): void {
		const routines = this.d.routines.list()
		if (!routines.length) return
		const signals = this.signals(events)
		if (!signals.some((s) => routines.some((r) => matches(r, s)))) return
		// Only event-triggered routines need a window. The room event log already stores its contents.
		if (this.d.log.meta("routine_window") !== null) return
		this.d.log.setMeta("routine_window", JSON.stringify({ after: Math.min(...events.map((e) => e.seq)) - 1, at: Date.now() }))
		this.d.ctx.waitUntil(this.d.alarms.setWakeup("routine_events", Date.now() + 60_000))
	}

	private signals(events: readonly RoomEvent[]): Signal[] {
		const home = this.d.home()
		if (!home) return []
		return events.flatMap((event) => {
			if (event.t !== "message" || event.from.kind === "system") return []
			const from = event.from
			const by =
				from.kind === "human"
					? { kind: "human" as const }
					: {
							kind: "agent" as const,
							slug: from.slug,
							name: this.d.members.get(from.slug)?.name ?? from.slug,
							eventRun: /^routine:[^:]+:(event|hook|watch):/.test(this.d.mail.chainRoot(from.slug) ?? ""),
						}
			const signal = signalOf(event, { roomId: home.roomId, at: event.at, by })
			return signal ? [signal] : []
		})
	}

	async flush(): Promise<void> {
		const stored = this.d.log.meta("routine_window")
		const home = this.d.home()
		if (!stored || !home) return
		const { after, at } = JSON.parse(stored) as { after: number; at: number }
		const caught = this.d.log.catchUp(after)
		const events = caught.t === "events" ? caught.events : []
		await this.d.services.user().signals({ roomId: home.roomId, openedAt: at, signals: this.signals(events), more: 0 })
		this.d.ctx.storage.sql.exec("DELETE FROM owner_meta WHERE key = 'routine_window' AND owner_meta.scope = 'room:' || ?1", this.d.log.roomId)
	}

	run(runs: readonly Inflight[], status: "ended" | "stopped" | "failed"): void {
		const home = this.d.home()
		if (!home || !runs.length) return
		const now = Date.now()
		const signals = runs.map((r): Signal => {
			const posted = status === "ended" ? this.d.log.lastAgentMessage(r.slug, r.seq) : null
			const outcome = status === "ended" ? (posted ? "ok" : "quiet") : status === "stopped" ? "quiet" : status
			return { kind: "routine_result", roomId: home.roomId, at: now, routineId: r.routineId, occurrence: r.occurrence, outcome, seq: posted?.seq ?? null }
		})
		this.d.ctx.waitUntil(this.d.services.user().signals({ roomId: home.roomId, openedAt: now, signals, more: 0 }))
	}
	async sendResults(): Promise<void> {}
}
