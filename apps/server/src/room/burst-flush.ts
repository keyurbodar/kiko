import type { AgentSlug, Chat, Envelope, } from "@kiko/protocol"
import { agentStub, userStub } from "../lib/names"
import { route } from "./deliver"
import { replyAddressees } from "./recipients"
import { deliverable, envelopeId, MAX_DELIVERY_ENVELOPES, type Burst, type Pending } from "./burst"
import { receive, type ReceiveDeps } from "./receive"
import type { Members } from "./members"
import { DELIVERY_RETRY_MS } from "./wake-delivery"
import type { Home } from "./home"

export type BurstDeps = ReceiveDeps & {
	ctx: DurableObjectState
	members: Members
	burst: Burst
	home: () => Home | null
	chat: (home: Home) => Promise<Chat | null>
	seedMembers: (home: Home, chat: Chat) => Promise<void>
	drainMail: () => Promise<void>
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
			if (out === "full") return await this.d.burst.retry(DELIVERY_RETRY_MS)
			reached = out
			if (batch.length < pending.length) return await this.d.burst.retry(0)
		} catch (error) {
			console.error(`burst delivery failed: ${error instanceof Error ? error.message : String(error)}`)
			return await this.d.burst.retry(DELIVERY_RETRY_MS)
		}
		this.closeWarnings(home, reached)
		await this.d.drainMail()
	}

	private addressees = (id: string) => replyAddressees((at) => this.d.log.message(at), id)

	/**
	 * Gives `slug` the human messages of a failed run again, to run them again. Each is a new delivery
	 * (named for the error line, so a second click changes nothing). No message is stored or sent.
	 */
	async redeliver(slug: AgentSlug, ids: readonly string[], errorId: string): Promise<void> {
		const home = this.d.home()
		const members = this.d.members.list()
		const member = members.find((m) => m.slug === slug)
		const chat = home ? await this.d.chat(home) : null
		if (!home || !member || !chat) return
		const envelopes = ids.flatMap((id): Envelope[] => {
			const m = this.d.log.message(id)
			if (!m) return []
			return [{ id: `${envelopeId(id)}#${errorId}`, roomId: home.roomId, from: { kind: "human" }, body: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}), hop: 0, rootId: id, seq: m.seq }]
		})
		if (envelopes.length) await receive(this.d, home, member, members, chat.title, envelopes)
	}

	private async deliverBurst(home: Home, batch: Pending[]): Promise<Set<AgentSlug> | "full"> {
		const first = batch[0]?.envelope
		if (!first) throw new Error("deliverBurst: empty burst")
		const chat = await this.d.chat(home)
		if (!chat) {
			this.d.burst.clear()
			return new Set()
		}
		await this.d.seedMembers(home, chat)
		const members = this.d.members.list()
		const routes = route(batch, members, this.addressees)
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
		const to = new Set(route(this.d.burst.envelopes(home.roomId), members, this.addressees).keys())
		const busy = members.filter((m) => to.has(m.slug) && m.status !== "idle")
		for (const m of busy) this.#warned.add(m.slug)
		await Promise.allSettled(busy.map((m) => agentStub(this.d.env.AGENT, home.userId, home.roomId, m.slug).humanComing()))
	}
}
