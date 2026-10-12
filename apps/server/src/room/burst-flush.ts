import type { AgentSlug, Chat, Envelope, RoomId } from "@yuki/protocol"
import type { Alarms } from "@yuki/durable/alarm"
import { agentStub, userStub } from "../lib/names"
import { route } from "./deliver"
import { BURST_HELD_WAKEUP, deliverable, MAX_DELIVERY_ENVELOPES, type Burst, type Pending } from "./burst"
import { receive, type ReceiveDeps } from "./receive"
import { HELD_WAKEUP, type HeldWakes } from "./wake"
import type { RoomLog } from "./log"
import type { Members } from "./members"
import { DELIVERY_RETRY_MS } from "./wake-delivery"
type Home = { userId: string; roomId: RoomId }

export type BurstDeps = ReceiveDeps & {
	ctx: DurableObjectState
	members: Members
	burst: Burst
	outbox: HeldWakes
	alarms: Alarms
	home: () => Home | null
	chat: (home: Home) => Promise<Chat | null>
	seedMembers: (home: Home, chat: Chat) => Promise<void>
	drainMail: () => Promise<void>
	retryHeld: () => Promise<void>
}

export class BurstFlush {
	#warned = new Set<AgentSlug>()

	constructor(private readonly d: BurstDeps) {}

	async flush(): Promise<void> {
		const home = this.d.home()
		if (!home) return
		const pending = this.d.burst.envelopes(home.roomId, MAX_DELIVERY_ENVELOPES + 1)
		const batch = deliverable(pending)
		if (!batch.length) return
		let reached: Set<AgentSlug>
		try {
			const out = await this.deliverBurst(home, batch)
			// A held window set its own wakeup for the reset. A retry now would spin until then.
			if (out === "held") return
			if (out === "full") return await this.d.burst.retry(DELIVERY_RETRY_MS)
			reached = out
			if (batch.length < pending.length) return await this.d.burst.retry(0)
		} catch (error) {
			console.error(`burst delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			return await this.d.burst.retry(DELIVERY_RETRY_MS)
		}
		this.closeWarnings(home, reached)
		await this.d.drainMail()
		if (this.d.outbox.any()) {
			await this.d.retryHeld().catch(async (error: unknown) => {
				console.error(`held wakes failed: ${error instanceof Error ? error.message : String(error)}`)
				await this.d.alarms.setWakeup(HELD_WAKEUP, Date.now() + DELIVERY_RETRY_MS)
			})
		}
	}

	private replyAuthor(id: string): AgentSlug | undefined {
		const from = this.d.log.message(id)?.from
		return from?.kind === "agent" ? from.slug : undefined
	}

	private async deliverBurst(home: Home, batch: Pending[]): Promise<Set<AgentSlug> | "full" | "held"> {
		const first = batch[0]?.envelope
		if (!first) throw new Error("deliverBurst: empty burst")
		const burstId = first.id
		const takeTurn = () => userStub(this.d.env.USER, home.userId).takeTurn(burstId)
		const known = this.d.log.meta("title") !== null
		const [chat, turn] = known ? await Promise.all([this.d.chat(home), takeTurn()]) : await this.d.chat(home).then(async (c) => [c, c ? await takeTurn() : ({ ok: true } as const)] as const)
		if (!chat) {
			this.d.burst.clear()
			return new Set()
		}
		if (!turn.ok) {
			// Held, not dropped: the window waits for the reset, and the alarm for the reset delivers it. The notice's id is the reset, so a retry posts nothing twice.
			const at = new Date(turn.resetAt).toISOString().slice(11, 16)
			const event = this.d.deliveries.notice(`limit:${turn.resetAt}`, `you've used today's ${turn.limit} replies. your messages are held and answered at ${at} utc.`, "limit")
			if (event) this.d.publish([event])
			await this.d.alarms.setWakeup(BURST_HELD_WAKEUP, turn.resetAt)
			this.d.burst.hold(turn.resetAt)
			return "held"
		}
		await this.d.seedMembers(home, chat)
		const members = this.d.members.list()
		const routes = route(batch, members, (id) => this.replyAuthor(id))
		const results = await Promise.allSettled(
			[...routes].map(async ([slug, mine]) => {
				const member = members.find((m) => m.slug === slug)
				if (!member) throw new Error(`no member @${slug}`)
				return receive(this.d, home, member, members, chat.title, mine)
			}),
		)
		const failed = results.find((r) => r.status === "rejected")
		if (failed) throw failed.reason
		if (results.some((r) => r.status === "fulfilled" && r.value === "full")) return "full"
		const envelopes = batch.map((p) => p.envelope)
		this.d.burst.delivered(envelopes)
		if (this.d.log.meta("private") !== "1") await this.captureHuman(home, envelopes)
		return new Set(routes.keys())
	}

	private async captureHuman(home: Home, envelopes: Envelope[]): Promise<void> {
		const items = envelopes.flatMap((e) => {
			const message = e.from.kind === "human" ? this.d.log.message(e.rootId) : null
			return message ? [{ messageId: e.rootId, text: e.body, at: message.at }] : []
		})
		if (!items.length) return
		try {
			await userStub(this.d.env.USER, home.userId).captureHuman(home.roomId, items)
		} catch (error) {
			console.error(`capture failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	private closeWarnings(home: Home, reached: ReadonlySet<AgentSlug>): void {
		if (this.d.burst.pending()) return
		for (const slug of this.#warned) {
			if (reached.has(slug)) continue
			this.d.ctx.waitUntil(
				agentStub(this.d.env.AGENT, home.userId, home.roomId, slug)
					.humanGone()
					.catch((e: unknown) => console.error(`human gone failed: ${e instanceof Error ? e.message : String(e)}`)),
			)
		}
		this.#warned.clear()
	}

	/** Warns the busy agents the window's messages are addressed to. Routing reads the staged mentions, so the whole text counts. */
	async warnBusyAgents(): Promise<void> {
		const home = this.d.home()
		if (!home) return
		const members = this.d.members.list()
		const to = new Set(route(this.d.burst.envelopes(home.roomId), members, (id) => this.replyAuthor(id)).keys())
		const busy = members.filter((m) => to.has(m.slug) && m.status !== "idle")
		for (const m of busy) this.#warned.add(m.slug)
		await Promise.allSettled(busy.map((m) => agentStub(this.d.env.AGENT, home.userId, home.roomId, m.slug).humanComing()))
	}
}
