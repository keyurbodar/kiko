import type { AgentSlug, RoomEvent, } from "@kiko/protocol"
import type { Alarms } from "@kiko/durable/alarm"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import { DELIVERY_RETRY_MS } from "./wake-delivery"
import type { Inflight } from "./routines"
import type { RoomRoutines } from "./routines"
import { matches, type Signal, type SignalWindow, signalOf, SIGNALS_WAKEUP } from "./signals"
import type { RoomLog } from "./log"
import type { Members } from "./members"
import type { Mail } from "./mail"
import type { Home } from "./home"


const RESULT_TEXT_MAX = 500

export type ReportsDeps = {
	ctx: DurableObjectState
	env: Env
	alarms: Alarms
	log: RoomLog
	members: Members
	mail: Mail
	routines: RoomRoutines
	signals: SignalWindow
	home: () => Home | null
}

export class Reports {
	constructor(private readonly d: ReportsDeps) {}

	gather(events: readonly RoomEvent[]): void {
		const routines = this.d.routines.list()
		const roomId = this.d.log.meta("room_id")
		if (!roomId || !events.some((e) => e.t === "message" || e.t === "task" || e.t === "file")) return
		const seqs = events.map((e) => e.seq)
		let actors: Map<number, string> | null = null
		const actorOf = (seq: number) => {
			actors ??= new Map(this.d.ctx.storage.sql.exec<{ seq: number; actor: string }>("SELECT seq, actor FROM events WHERE seq IN (SELECT value FROM json_each(?))", JSON.stringify(seqs)).toArray().map((r) => [r.seq, r.actor]))
			return actors.get(seq) ?? null
		}
		const eventRun = (slug: AgentSlug) => /^routine:[^:]+:(event|hook|watch):/.test(this.d.mail.chainRoot(slug) ?? "")
		const now = Date.now()
		const signals: Signal[] = []
		for (const event of events) {
			const actor = event.t === "message" && event.from.kind === "human" ? "human" : actorOf(event.seq)
			const agent = actor?.startsWith("agent:") ? (actor.slice(6) as AgentSlug) : null
			const by = actor === "human" ? ({ kind: "human" } as const) : agent ? ({ kind: "agent", slug: agent, name: this.d.members.get(agent)?.name ?? agent, eventRun: eventRun(agent) } as const) : null
			const quoted = event.t === "message" && event.replyTo ? this.d.log.message(event.replyTo) : null
			const signal = signalOf(event, { roomId, at: now, by, ...(quoted?.initiative ? { answers: quoted.seq } : {}) })
			if (signal && (signal.kind === "burst" || routines.some((r) => matches(r, signal)))) signals.push(signal)
		}
		const closes = this.d.signals.add(signals, now)
		if (closes !== null) this.d.ctx.waitUntil(this.d.alarms.setWakeup(SIGNALS_WAKEUP, closes))
	}

	async flush(): Promise<void> {
		await this.sendResults()
		const home = this.d.home()
		const due = this.d.signals.due(Date.now())
		if (home && due) {
			await userStub(this.d.env.USER, home.userId).signals(due.batch)
			this.d.signals.sent(due.upto, due.batch.more)
		}
		const next = this.d.signals.nextClose()
		if (next !== null) await this.d.alarms.setWakeup(SIGNALS_WAKEUP, next)
	}

	run(runs: readonly Inflight[], status: "ended" | "stopped" | "failed"): void {
		const home = this.d.home()
		if (!home || !runs.length) return
		const now = Date.now()
		const signals = runs.map((r): Signal => {
			const posted = status === "ended" ? this.d.log.lastAgentMessage(r.slug, r.seq) : null
			const outcome = status === "ended" ? (posted !== null ? "ok" : "quiet") : status === "stopped" ? "quiet" : status
			return { kind: "routine_result", roomId: home.roomId, at: now, routineId: r.routineId, occurrence: r.occurrence, outcome, seq: posted?.seq ?? null, ...(posted ? { text: posted.text.slice(0, RESULT_TEXT_MAX) } : {}) }
		})
		this.d.signals.hold(signals)
		this.d.ctx.waitUntil(
			this.sendResults().catch(async (e: unknown) => {
				console.error(`routine report failed: ${e instanceof Error ? e.message : String(e)}`)
				await this.d.alarms.setWakeup(SIGNALS_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
			}),
		)
	}

	async sendResults(): Promise<void> {
		const home = this.d.home()
		if (!home) return
		for (let held = this.d.signals.held(); held; held = this.d.signals.held()) {
			await userStub(this.d.env.USER, home.userId).signals({ roomId: home.roomId, openedAt: held.signals[0]?.at ?? 0, signals: held.signals, more: 0 })
			this.d.signals.released(held.upto)
		}
	}
}
