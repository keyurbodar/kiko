import type { AgentSlug, Chat, Envelope, RoomId } from "@kiko/protocol"
import type { Asks } from "./asks"
import type { Home } from "./home"
import type { Members } from "./members"
import { receive, type ReceiveDeps } from "./receive"
import { parseRichText } from "@kiko/protocol/markdown"

export type PairIn = { askId: string; origin: RoomId; from: AgentSlug; to: AgentSlug; text: string; rootId: string; hop: number }

type PairDeps = ReceiveDeps & {
	ctx: DurableObjectState
	members: Members
	asks: Asks
	adopt: (userId: string) => Home | null
	chat: (home: Home) => Promise<Chat | null>
	seedMembers: (home: Home, chat: Chat) => Promise<void>
}

export class RoomPair {
	constructor(private readonly d: PairDeps) {}

	async receive(userId: string, input: PairIn): Promise<"ok" | "full" | "refused"> {
		const home = this.d.adopt(userId)
		const chat = home ? await this.d.chat(home) : null
		if (!home || !chat?.pair) return "refused"
		await this.d.seedMembers(home, chat)
		const members = this.d.members.list()
		const member = members.find((m) => m.slug === input.to)
		if (!member || !members.some((m) => m.slug === input.from)) return "refused"
		const shown = `@${input.to} ${input.text}`
		const stored = this.d.ctx.storage.transactionSync(() => {
			const message = this.d.log.addMessage({ from: { kind: "agent", slug: input.from }, text: shown, rich: parseRichText(shown), to: input.to, clientId: `pair:${input.askId}` })
			this.d.asks.expect(input.askId, input.from, input.to, message.id, Date.now(), input.origin)
			return message
		})
		this.d.publish(stored.event ? [stored.event] : [])
		const envelope: Envelope = {
			id: `agent:${stored.id}:${input.to}`,
			roomId: home.roomId,
			from: { kind: "agent", slug: input.from },
			body: input.text,
			hop: input.hop,
			rootId: input.rootId,
			seq: stored.seq,
		}
		const receipt = await receive(this.d, home, member, members, chat.title, [envelope])
		return receipt === "admitted" ? "ok" : receipt
	}
}
